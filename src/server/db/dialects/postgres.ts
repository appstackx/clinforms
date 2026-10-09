/**
 * Kysely PostgresDialect over a `pg` Pool (Supabase Postgres, London, through the pooler).
 *
 * Type parsers make Postgres rows look exactly like SQLite/D1 rows to the repositories:
 *   timestamptz / timestamp → ISO-8601 UTC string ("2026-10-09T12:00:00.000Z")
 *   int8 (bigint, count(*)) → number (throws past Number.MAX_SAFE_INTEGER)
 *   json / jsonb            → the raw JSON text (code parses)
 * The parsers are per pool (`types` option), never pg's global registry.
 *
 * TLS: DATABASE_SSL = "verify-full" (default when DATABASE_CA_CERT holds the PEM of the server CA),
 * "require" (encrypted, certificate not verified – the default otherwise) or "disable" (local only).
 * sslmode parameters in DATABASE_URL are removed so they cannot override this choice.
 */
import pg from "pg";
import { PostgresDialect, type Dialect } from "kysely";
import { DbError } from "../errors";

export const PG_OID = {
  int8: 20,
  json: 114,
  timestamp: 1114,
  timestamptz: 1184,
  jsonb: 3802,
} as const;

const PG_TIMESTAMP =
  /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)(?:\.(\d+))?(?:(Z)|([+-])(\d\d)(?::?(\d\d))?(?::?(\d\d))?)?$/;

/**
 * Postgres timestamp text → ISO-8601 UTC with milliseconds. timestamptz text looks like
 * "2026-10-09 12:00:00.123456+00" (offset in the session time zone); `timestamp` has no zone and is
 * read as UTC. Values it cannot read (infinity, BC dates) are returned unchanged.
 */
export function pgTimestampToIso(value: string): string {
  const m = PG_TIMESTAMP.exec(value);
  if (!m) return value;
  const [, y, mo, d, h, mi, s, frac, z, sign, oh, om, os] = m;
  const ms = frac ? Number(frac.slice(0, 3).padEnd(3, "0")) : 0;
  let utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms);
  if (!z && sign) {
    const offsetSeconds = Number(oh) * 3600 + Number(om ?? 0) * 60 + Number(os ?? 0);
    utc -= (sign === "+" ? 1 : -1) * offsetSeconds * 1000;
  }
  const date = new Date(utc);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export function pgInt8ToNumber(value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new DbError("SQL_ERROR", "A bigint value is outside JavaScript's safe integer range.");
  return n;
}

/** Text-format parsers by type OID (shared with the PGlite test dialect). */
export const PG_TEXT_PARSERS: Record<number, (value: string) => unknown> = {
  [PG_OID.int8]: pgInt8ToNumber,
  [PG_OID.json]: (v) => v,
  [PG_OID.jsonb]: (v) => v,
  [PG_OID.timestamp]: pgTimestampToIso,
  [PG_OID.timestamptz]: pgTimestampToIso,
};

const customTypes = {
  getTypeParser(oid: number, format?: "text" | "binary") {
    if (format !== "binary" && PG_TEXT_PARSERS[oid]) return PG_TEXT_PARSERS[oid];
    return (pg.types.getTypeParser as (oid: number, format?: "text" | "binary") => (value: string) => unknown)(oid, format);
  },
};

export type PgSslMode = "verify-full" | "require" | "disable";

export interface PostgresConfig {
  connectionString: string;
  ssl?: PgSslMode;
  /** PEM of the server's CA (Supabase: Database settings → SSL configuration). */
  caCert?: string;
  /** Pool size. Serverless: keep it small and use the transaction pooler (port 6543). */
  max?: number;
}

function stripSslParams(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    for (const key of ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) url.searchParams.delete(key);
    return url.toString();
  } catch {
    throw new DbError("NOT_CONFIGURED", "DATABASE_URL is not a valid postgres:// URL.");
  }
}

export function createPgPool(config: PostgresConfig): pg.Pool {
  const mode: PgSslMode = config.ssl ?? (config.caCert ? "verify-full" : "require");
  const ssl =
    mode === "disable"
      ? false
      : mode === "verify-full"
        ? { rejectUnauthorized: true, ...(config.caCert ? { ca: config.caCert } : {}) }
        : { rejectUnauthorized: false };
  return new pg.Pool({
    connectionString: stripSslParams(config.connectionString),
    ssl,
    max: config.max ?? 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    types: customTypes,
  });
}

export function postgresDialect(config: PostgresConfig): Dialect {
  return new PostgresDialect({ pool: createPgPool(config) });
}

export function postgresConfigFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): PostgresConfig {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) throw new DbError("NOT_CONFIGURED", "CLINFORMS_DB=postgres needs DATABASE_URL.");
  const ssl = env.DATABASE_SSL;
  if (ssl !== undefined && ssl !== "" && ssl !== "verify-full" && ssl !== "require" && ssl !== "disable") {
    throw new DbError("NOT_CONFIGURED", "DATABASE_SSL must be verify-full, require or disable.");
  }
  return {
    connectionString,
    ssl: ssl ? (ssl as PgSslMode) : undefined,
    caCert: env.DATABASE_CA_CERT || undefined,
    max: env.DATABASE_POOL_MAX ? Math.max(1, Number(env.DATABASE_POOL_MAX) || 3) : undefined,
  };
}
