/**
 * Request validation and the SQL rules. The gateway only runs what the app's query builder sends: one
 * SELECT / INSERT / UPDATE / DELETE / WITH statement per entry (allowlist on the first keyword), bound
 * parameters, no comments, no schema changes (migrations go through wrangler), no transaction control (use
 * mode "batch"), no REPLACE conflict resolution, and none of ATTACH / DETACH / PRAGMA / VACUUM or writes to
 * SQLite's / D1's own tables.
 */
export const LIMITS = {
  maxBodyBytes: 8 * 1024 * 1024,
  maxStatements: 100,
  /** D1's own limit of bound parameters per query. */
  maxParams: 100,
  /** D1's own limit of SQL statement length. */
  maxSqlLength: 100_000,
} as const;

export type Param = null | string | number | boolean;
export interface Statement {
  sql: string;
  params: Param[];
}
export interface QueryBody {
  statements: Statement[];
  mode: "single" | "batch";
}

export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

const DENIED_KEYWORDS = /\b(ATTACH|DETACH|PRAGMA|VACUUM)\b|\bload_extension\b/i;
const INTERNAL_TABLES = /\b(sqlite_master|sqlite_schema|sqlite_temp_master|sqlite_temp_schema|sqlite_sequence|d1_migrations|_cf_[a-z0-9_]*)\b/i;
/** The query builder never writes comments; a comment could hide the statement's real first keyword. */
const COMMENT = /--|\/\*/;
/** Allowlist: the statement kinds the app's query builder emits. Everything else (DDL, transaction control…) is refused. */
const ALLOWED_START = /^\s*(select|insert|update|delete|with)\b/i;
const DDL_START = /^\s*(create|drop|alter|reindex|analyze)\b/i;
const TX_START = /^\s*(begin|commit|end|rollback|savepoint|release)\b/i;
/** Any statement that can write, whatever it starts with (WITH … DELETE, INSERT … SELECT …). */
const WRITE_KEYWORD = /\b(insert|update|delete|replace)\b/i;
/**
 * REPLACE conflict resolution (REPLACE INTO, INSERT OR REPLACE, UPDATE OR REPLACE) deletes the conflicting row
 * WITHOUT firing DELETE triggers (recursive_triggers is off on D1), so it would overwrite append-only rows.
 * The app uses ON CONFLICT … DO UPDATE instead.
 */
const REPLACE_CONFLICT = /^\s*replace\b|\bor\s+replace\b/i;

/** Throws RequestError(400, "SQL_DENIED") for SQL the gateway never runs. */
export function checkSql(sql: string): void {
  const deny = (why: string): never => {
    throw new RequestError(400, "SQL_DENIED", why);
  };
  if (COMMENT.test(sql)) deny("SQL comments are not allowed through the gateway.");
  const keyword = DENIED_KEYWORDS.exec(sql);
  if (keyword) deny(`${keyword[0].toUpperCase()} is not allowed through the gateway.`);
  if (DDL_START.test(sql)) deny("Schema changes are not allowed through the gateway: use migrations.");
  if (TX_START.test(sql)) deny('Transaction statements are not allowed: send the statements with mode "batch".');
  if (!ALLOWED_START.test(sql)) deny("Only SELECT, INSERT, UPDATE, DELETE and WITH statements are allowed.");
  if (REPLACE_CONFLICT.test(sql)) deny("REPLACE conflict resolution is not allowed: use ON CONFLICT … DO UPDATE.");
  if (INTERNAL_TABLES.test(sql) && WRITE_KEYWORD.test(sql)) deny("Writes to internal tables are not allowed.");
  if (sql.replace(/;\s*$/, "").includes(";")) deny("One SQL statement per entry.");
}

function isParam(value: unknown): value is Param {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

/** Parses and validates a /v1/query body. */
export function parseQueryBody(bytes: Uint8Array): QueryBody {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RequestError(400, "BAD_REQUEST", "Body is not valid JSON.");
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new RequestError(400, "BAD_REQUEST", "Body must be an object.");
  const { statements, mode } = json as { statements?: unknown; mode?: unknown };
  if (mode !== "single" && mode !== "batch") throw new RequestError(400, "BAD_REQUEST", 'mode must be "single" or "batch".');
  if (!Array.isArray(statements) || statements.length === 0) {
    throw new RequestError(400, "BAD_REQUEST", "statements must be a non-empty array.");
  }
  if (statements.length > LIMITS.maxStatements) {
    throw new RequestError(400, "TOO_MANY_STATEMENTS", `At most ${LIMITS.maxStatements} statements per request.`);
  }
  if (mode === "single" && statements.length !== 1) throw new RequestError(400, "BAD_REQUEST", 'mode "single" takes exactly one statement.');
  const out: Statement[] = statements.map((entry, i) => {
    if (!entry || typeof entry !== "object") throw new RequestError(400, "BAD_REQUEST", `Statement ${i} must be an object.`);
    const { sql, params } = entry as { sql?: unknown; params?: unknown };
    if (typeof sql !== "string" || sql.trim() === "") throw new RequestError(400, "BAD_REQUEST", `Statement ${i}: sql must be a non-empty string.`);
    if (sql.length > LIMITS.maxSqlLength) throw new RequestError(400, "BAD_REQUEST", `Statement ${i}: SQL is longer than ${LIMITS.maxSqlLength} characters.`);
    const list = params === undefined ? [] : params;
    if (!Array.isArray(list)) throw new RequestError(400, "BAD_REQUEST", `Statement ${i}: params must be an array.`);
    if (list.length > LIMITS.maxParams) throw new RequestError(400, "BAD_REQUEST", `Statement ${i}: at most ${LIMITS.maxParams} parameters.`);
    if (!list.every(isParam)) {
      throw new RequestError(400, "BAD_REQUEST", `Statement ${i}: parameters must be null, strings, finite numbers or booleans.`);
    }
    checkSql(sql);
    return { sql, params: list as Param[] };
  });
  return { statements: out, mode };
}

/** D1 binds booleans as integers anyway; normalise so every runtime agrees. */
export function bindValue(value: Param): null | string | number {
  return typeof value === "boolean" ? (value ? 1 : 0) : value;
}
