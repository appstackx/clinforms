/**
 * Kysely dialect for Cloudflare D1 through the ClinForms data gateway Worker (workers/data-gateway).
 *
 * SqliteAdapter + SqliteIntrospector + SqliteQueryCompiler + a driver that POSTs each compiled query to
 * `<gateway>/v1/query`, signed with HMAC-SHA256 (docs/production-architecture.md §2):
 *   x-clinforms-ts  = unix ms
 *   x-clinforms-sig = hex HMAC-SHA256(GATEWAY_SECRET, ts + "\n" + method + "\n" + path + "\n" + sha256hex(body))
 *
 * D1 has NO interactive transactions: `db.transaction()` throws TRANSACTIONS_UNSUPPORTED. Multi-statement
 * atomic writes use `runBatch(db, queries)` (src/server/db/batch.ts), which sends the compiled queries as
 * one `batch` request → `env.DB.batch()` (atomic: all or nothing).
 *
 * The Next app never imports the Worker's code: the protocol is duplicated on purpose (tests cross-check).
 */
import { createHash, createHmac } from "node:crypto";
import {
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type DatabaseIntrospector,
  type Dialect,
  type DialectAdapter,
  type Driver,
  type Kysely,
  type QueryCompiler,
  type QueryResult,
} from "kysely";
import { DbError, type DbErrorCode } from "../errors";

export const GATEWAY_TS_HEADER = "x-clinforms-ts";
export const GATEWAY_SIG_HEADER = "x-clinforms-sig";
export const GATEWAY_QUERY_PATH = "/v1/query";
/** Mirrors the gateway's limits so the client fails fast with a clear message. */
export const GATEWAY_MAX_BODY_BYTES = 8 * 1024 * 1024;
export const GATEWAY_MAX_STATEMENTS = 100;

export type GatewayValue = null | string | number | boolean;
export interface GatewayStatement {
  sql: string;
  params: GatewayValue[];
}
export interface GatewayResult {
  rows: Record<string, unknown>[];
  changes: number;
  lastRowId: number | null;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** The request signature (hex). `path` is the URL pathname, e.g. "/v1/query". */
export function signGatewayRequest(
  secret: string,
  ts: string,
  method: string,
  path: string,
  body: string | Uint8Array,
): string {
  return createHmac("sha256", secret)
    .update(`${ts}\n${method.toUpperCase()}\n${path}\n${sha256Hex(body)}`)
    .digest("hex");
}

export function toGatewayValue(value: unknown): GatewayValue {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      if (!Number.isFinite(value)) throw new DbError("BAD_PARAMETER", "SQL parameter is not a finite number.");
      return value;
    case "bigint":
      if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
        throw new DbError("BAD_PARAMETER", "SQL parameter bigint is outside the safe integer range.");
      }
      return Number(value);
    case "object":
      if (value instanceof Date) return value.toISOString();
      break;
    default:
      break;
  }
  throw new DbError(
    "BAD_PARAMETER",
    `Unsupported SQL parameter type for the data gateway: ${value === undefined ? "undefined" : typeof value}.`,
  );
}

export interface D1HttpConfig {
  /** Gateway base URL, e.g. https://clinforms-data.example.workers.dev */
  url: string;
  /** GATEWAY_SECRET shared with the Worker (≥ 32 characters). */
  secret: string;
  /** Override fetch (tests call the Worker's handler in-process). */
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  /** Per-request timeout, default 20 s. */
  timeoutMs?: number;
  /** Clock override for tests. */
  now?: () => number;
}

const GATEWAY_CODE_MAP: Record<string, DbErrorCode> = {
  UNAUTHORIZED: "GATEWAY_AUTH",
  PAYLOAD_TOO_LARGE: "GATEWAY_LIMIT",
  TOO_MANY_STATEMENTS: "GATEWAY_LIMIT",
  UNAVAILABLE: "GATEWAY_UNAVAILABLE",
  BAD_REQUEST: "GATEWAY_PROTOCOL",
  NOT_FOUND: "GATEWAY_PROTOCOL",
  METHOD_NOT_ALLOWED: "GATEWAY_PROTOCOL",
  NOT_CONFIGURED: "NOT_CONFIGURED",
  SQL_DENIED: "SQL_DENIED",
  SQL_ERROR: "SQL_ERROR",
  APPEND_ONLY: "APPEND_ONLY",
  CONSTRAINT_UNIQUE: "CONSTRAINT_UNIQUE",
  CONSTRAINT_FOREIGN_KEY: "CONSTRAINT_FOREIGN_KEY",
  CONSTRAINT_CHECK: "CONSTRAINT_CHECK",
  CONSTRAINT_NOT_NULL: "CONSTRAINT_NOT_NULL",
};

function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
}

/** Low-level client: one signed POST per call. */
export class D1GatewayClient {
  readonly endpoint: string;
  private readonly _path: string;
  private readonly _secret: string;
  private readonly _fetch: (input: string, init: RequestInit) => Promise<Response>;
  private readonly _timeoutMs: number;
  private readonly _now: () => number;

  constructor(config: D1HttpConfig) {
    let base: URL;
    try {
      base = new URL(config.url);
    } catch {
      throw new DbError("NOT_CONFIGURED", "CLINFORMS_D1_GATEWAY_URL is not a valid URL.");
    }
    if (base.protocol !== "https:" && !(base.protocol === "http:" && isLocalHost(base.hostname))) {
      throw new DbError("NOT_CONFIGURED", "CLINFORMS_D1_GATEWAY_URL must use https (http only for localhost).");
    }
    if (!config.secret || config.secret.length < 32) {
      throw new DbError("NOT_CONFIGURED", "CLINFORMS_D1_GATEWAY_SECRET must be set (32+ characters).");
    }
    const endpoint = new URL(GATEWAY_QUERY_PATH, base);
    this.endpoint = endpoint.toString();
    this._path = endpoint.pathname;
    this._secret = config.secret;
    this._fetch = config.fetch ?? ((input, init) => fetch(input, init));
    this._timeoutMs = config.timeoutMs ?? 20_000;
    this._now = config.now ?? Date.now;
  }

  async query(statements: GatewayStatement[], mode: "single" | "batch"): Promise<GatewayResult[]> {
    if (statements.length === 0) return [];
    if (statements.length > GATEWAY_MAX_STATEMENTS) {
      throw new DbError("GATEWAY_LIMIT", `A gateway batch holds at most ${GATEWAY_MAX_STATEMENTS} statements.`);
    }
    const body = JSON.stringify({ statements, mode });
    if (Buffer.byteLength(body, "utf8") > GATEWAY_MAX_BODY_BYTES) {
      throw new DbError("GATEWAY_LIMIT", "The query is larger than the data gateway's 8 MiB request limit.");
    }
    const ts = String(this._now());
    const sig = signGatewayRequest(this._secret, ts, "POST", this._path, body);
    let res: Response;
    try {
      res = await this._fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", [GATEWAY_TS_HEADER]: ts, [GATEWAY_SIG_HEADER]: sig },
        body,
        signal: AbortSignal.timeout(this._timeoutMs),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "Error";
      throw new DbError("GATEWAY_UNAVAILABLE", `The data gateway could not be reached (${name}).`, { cause: err });
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new DbError(res.ok ? "GATEWAY_PROTOCOL" : "GATEWAY_UNAVAILABLE", `The data gateway answered ${res.status} without JSON.`, {
        status: res.status,
      });
    }
    if (!res.ok) {
      const error = (json as { error?: { code?: unknown; message?: unknown } }).error;
      const code = typeof error?.code === "string" ? error.code : "";
      const message = typeof error?.message === "string" ? error.message : `HTTP ${res.status}`;
      const mapped = GATEWAY_CODE_MAP[code] ?? (res.status >= 500 ? "GATEWAY_UNAVAILABLE" : "SQL_ERROR");
      throw new DbError(mapped, `Data gateway: ${message}`, { status: res.status });
    }
    const results = (json as { results?: unknown }).results;
    if (!Array.isArray(results) || results.length !== statements.length) {
      throw new DbError("GATEWAY_PROTOCOL", "The data gateway returned an unexpected result shape.", { status: res.status });
    }
    return results as GatewayResult[];
  }
}

function toStatement(compiled: CompiledQuery): GatewayStatement {
  return { sql: compiled.sql, params: compiled.parameters.map(toGatewayValue) };
}

function toQueryResult<R>(result: GatewayResult): QueryResult<R> {
  const changes = typeof result.changes === "number" ? result.changes : 0;
  return {
    rows: (Array.isArray(result.rows) ? result.rows : []) as R[],
    numAffectedRows: BigInt(changes),
    insertId: typeof result.lastRowId === "number" && changes > 0 ? BigInt(result.lastRowId) : undefined,
  };
}

/** Marks the D1 adapter and connection: runBatch() sends their queries as one atomic batch. */
export const D1_BATCH_MARKER: unique symbol = Symbol.for("clinforms.db.d1-http.batch") as never;

/** A connection is stateless (one HTTP request per query), so any number may run at once. */
export class D1HttpConnection implements DatabaseConnection {
  readonly [D1_BATCH_MARKER] = true;
  constructor(private readonly client: D1GatewayClient) {}

  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    const [result] = await this.client.query([toStatement(compiled)], "single");
    return toQueryResult<R>(result);
  }

  /** All statements in ONE request → env.DB.batch(): atomic. */
  async executeBatch(compiled: readonly CompiledQuery[]): Promise<QueryResult<Record<string, unknown>>[]> {
    const results = await this.client.query(compiled.map(toStatement), "batch");
    return results.map((r) => toQueryResult<Record<string, unknown>>(r));
  }

  streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new DbError("SQL_ERROR", "Streaming is not supported by the D1 gateway driver.");
  }
}

const NO_TRANSACTIONS =
  "D1 has no interactive transactions: use runBatch(db, queries) from src/server/db for atomic multi-statement writes.";

class D1HttpDriver implements Driver {
  private readonly _client: D1GatewayClient;
  constructor(config: D1HttpConfig) {
    this._client = new D1GatewayClient(config);
  }
  async init(): Promise<void> {}
  async acquireConnection(): Promise<DatabaseConnection> {
    return new D1HttpConnection(this._client);
  }
  async beginTransaction(): Promise<void> {
    throw new DbError("TRANSACTIONS_UNSUPPORTED", NO_TRANSACTIONS);
  }
  async commitTransaction(): Promise<void> {
    throw new DbError("TRANSACTIONS_UNSUPPORTED", NO_TRANSACTIONS);
  }
  async rollbackTransaction(): Promise<void> {
    throw new DbError("TRANSACTIONS_UNSUPPORTED", NO_TRANSACTIONS);
  }
  async releaseConnection(): Promise<void> {}
  async destroy(): Promise<void> {}
}

/**
 * SQLite semantics, but many concurrent connections (each query is its own HTTP request). runBatch()
 * recognises a D1 database by this adapter.
 */
export class D1HttpAdapter extends SqliteAdapter {
  /** Marker read by runBatch() (a Symbol.for key, so it survives duplicate module instances). */
  readonly [D1_BATCH_MARKER] = true;
  override get supportsMultipleConnections(): boolean {
    return true;
  }
}

export class D1HttpDialect implements Dialect {
  constructor(private readonly config: D1HttpConfig) {}
  createAdapter(): DialectAdapter {
    return new D1HttpAdapter();
  }
  createDriver(): Driver {
    return new D1HttpDriver(this.config);
  }
  createIntrospector(db: Kysely<unknown>): DatabaseIntrospector {
    return new SqliteIntrospector(db);
  }
  createQueryCompiler(): QueryCompiler {
    return new SqliteQueryCompiler();
  }
}
