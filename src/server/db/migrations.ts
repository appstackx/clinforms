/**
 * Migration runners for the two migration sets (kept in step, checked by db/parity.test.ts):
 * - SQLite / D1: db/migrations/sqlite/NNNN_name.sql (wrangler format). Locally applied in-process
 *   (table `_migrations`); on D1 by `wrangler d1 migrations apply` (scripts/db/migrate.ts).
 * - Postgres / Supabase: supabase/migrations/YYYYMMDDHHMMSS_name.sql (Supabase CLI format), applied in
 *   order inside one transaction each, recorded in `public.schema_migrations` (idempotent, advisory lock).
 */
import fs from "node:fs";
import path from "node:path";
import type { SqliteDatabaseLike } from "./dialects/sqlite-local";

export const SQLITE_MIGRATIONS_DIR = "db/migrations/sqlite";
export const POSTGRES_MIGRATIONS_DIR = "supabase/migrations";

export interface MigrationFile {
  name: string;
  sql: string;
}

const SQLITE_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;
const POSTGRES_FILE = /^\d{14}_[a-z0-9_]+\.sql$/;

/** Resolves a repository-relative directory (the app and scripts run from the repository root). */
export function repoPath(relative: string): string {
  return path.resolve(process.cwd(), relative);
}

export function readMigrations(dir: string, kind: "sqlite" | "postgres"): MigrationFile[] {
  const pattern = kind === "sqlite" ? SQLITE_FILE : POSTGRES_FILE;
  if (!fs.existsSync(dir)) throw new Error(`Migrations folder not found: ${dir}`);
  return fs
    .readdirSync(dir)
    .filter((name) => pattern.test(name))
    .sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), "utf8") }));
}

/** Applies pending SQLite migrations in-process. Returns the names applied now. */
export function applySqliteMigrations(db: SqliteDatabaseLike, dir = repoPath(SQLITE_MIGRATIONS_DIR)): string[] {
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT NOT NULL PRIMARY KEY, applied_at TEXT NOT NULL)");
  const done = new Set(
    db
      .prepare("SELECT name FROM _migrations")
      .all()
      .map((row) => String((row as { name: unknown }).name)),
  );
  const applied: string[] = [];
  for (const file of readMigrations(dir, "sqlite")) {
    if (done.has(file.name)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(file.sql);
      db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(file.name, new Date().toISOString());
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`SQLite migration ${file.name} failed: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err,
      });
    }
    applied.push(file.name);
  }
  return applied;
}

/** Minimal client surface: `pg.Client` (via an adapter) or PGlite. */
export interface PgMigrationClient {
  /** Runs one or more statements without parameters (simple query protocol). */
  exec(sql: string): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

const MIGRATION_LOCK_KEY = 72_740_011; // pg_advisory_lock key for ClinForms migrations

/** Applies pending Postgres migrations, one transaction per file. Returns the names applied now. */
export async function applyPostgresMigrations(
  client: PgMigrationClient,
  dir = repoPath(POSTGRES_MIGRATIONS_DIR),
): Promise<string[]> {
  const files = readMigrations(dir, "postgres");
  await client.exec(`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`);
  try {
    await client.exec(
      "create table if not exists public.schema_migrations (version text not null primary key, name text not null, " +
        "applied_at timestamptz not null default now()); " +
        "alter table public.schema_migrations enable row level security;",
    );
    const { rows } = await client.query("select version from public.schema_migrations");
    const done = new Set(rows.map((r) => String(r.version)));
    const applied: string[] = [];
    for (const file of files) {
      const version = file.name.slice(0, 14);
      if (done.has(version)) continue;
      await client.exec("begin");
      try {
        await client.exec(file.sql);
        await client.query("insert into public.schema_migrations (version, name) values ($1, $2)", [version, file.name]);
        await client.exec("commit");
      } catch (err) {
        await client.exec("rollback");
        throw new Error(`Postgres migration ${file.name} failed: ${err instanceof Error ? err.message : String(err)}`, {
          cause: err,
        });
      }
      applied.push(file.name);
    }
    return applied;
  } finally {
    await client.exec(`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`);
  }
}
