/**
 * getDb(): the one Kysely<Database> for this process, chosen by CLINFORMS_DB:
 *   d1       – Cloudflare D1 through the data gateway Worker (CLINFORMS_D1_GATEWAY_URL + _SECRET)
 *   postgres – Supabase Postgres (DATABASE_URL, DATABASE_SSL, DATABASE_CA_CERT)
 *   sqlite   – local file CLINFORMS_SQLITE_PATH (default .data/clinforms.db), migrated automatically
 * Default: sqlite locally. On Vercel CLINFORMS_DB is required (and sqlite is refused).
 * See docs/database.md.
 */
import "server-only";
import { Kysely } from "kysely";
import { D1HttpDialect } from "./dialects/d1-http";
import { postgresConfigFromEnv, postgresDialect } from "./dialects/postgres";
import { NodeSqliteDialect, openSqliteDatabase } from "./dialects/sqlite-local";
import { DbError } from "./errors";
import { applySqliteMigrations } from "./migrations";
import type { Database } from "./schema";

export type { Database } from "./schema";
export { runBatch, isD1Database, type BatchQuery } from "./batch";
export { DbError, classifyDbError, isUniqueViolation, type DbErrorCode } from "./errors";

export type DbKind = "d1" | "postgres" | "sqlite";
export const DEFAULT_SQLITE_PATH = ".data/clinforms.db";

export function resolveDbKind(env: Readonly<Record<string, string | undefined>> = process.env): DbKind {
  const raw = (env.CLINFORMS_DB ?? "").trim().toLowerCase();
  const onVercel = Boolean(env.VERCEL);
  if (!raw) {
    if (onVercel) throw new DbError("NOT_CONFIGURED", "CLINFORMS_DB must be set on Vercel (d1 or postgres).");
    return "sqlite";
  }
  if (raw !== "d1" && raw !== "postgres" && raw !== "sqlite") {
    throw new DbError("NOT_CONFIGURED", `CLINFORMS_DB must be d1, postgres or sqlite (got "${raw}").`);
  }
  if (raw === "sqlite" && onVercel) {
    throw new DbError("NOT_CONFIGURED", "CLINFORMS_DB=sqlite is for local development only, not Vercel.");
  }
  return raw;
}

/** Builds a new Kysely instance for the given kind (scripts and tests; the app uses getDb()). */
export function createDb(kind: DbKind, env: Readonly<Record<string, string | undefined>> = process.env): Kysely<Database> {
  switch (kind) {
    case "d1":
      return new Kysely<Database>({
        dialect: new D1HttpDialect({
          url: env.CLINFORMS_D1_GATEWAY_URL ?? "",
          secret: env.CLINFORMS_D1_GATEWAY_SECRET ?? "",
        }),
      });
    case "postgres":
      return new Kysely<Database>({ dialect: postgresDialect(postgresConfigFromEnv(env)) });
    case "sqlite": {
      const file = env.CLINFORMS_SQLITE_PATH || DEFAULT_SQLITE_PATH;
      return new Kysely<Database>({
        dialect: new NodeSqliteDialect({
          database: () => {
            const database = openSqliteDatabase(file);
            applySqliteMigrations(database);
            return database;
          },
        }),
      });
    }
  }
}

interface DbGlobal {
  __clinformsDb?: { kind: DbKind; db: Kysely<Database> };
}
const holder = globalThis as unknown as DbGlobal;

/** The process-wide database (cached on globalThis so Next dev reloads reuse it). */
export function getDb(): Kysely<Database> {
  const kind = resolveDbKind();
  const cached = holder.__clinformsDb;
  if (cached && cached.kind === kind) return cached.db;
  const db = createDb(kind);
  holder.__clinformsDb = { kind, db };
  return db;
}

export function getDbKind(): DbKind {
  return resolveDbKind();
}

/** Closes the process-wide database (scripts and tests). */
export async function closeDb(): Promise<void> {
  const cached = holder.__clinformsDb;
  holder.__clinformsDb = undefined;
  if (cached) await cached.db.destroy();
}
