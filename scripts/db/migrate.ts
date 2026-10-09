/**
 * Applies the database migrations for CLINFORMS_DB (docs/database.md):
 *
 *   npm run db:migrate                                   # sqlite (default): .data/clinforms.db, in-process
 *   CLINFORMS_DB=d1 npm run db:migrate -- --d1-env preview          # wrangler d1 migrations apply --remote
 *   CLINFORMS_DB=d1 npm run db:migrate -- --d1-env production --yes # production D1 (orchestrator only)
 *   CLINFORMS_DB=postgres DATABASE_URL=… npm run db:migrate         # supabase/migrations via pg, idempotent
 *
 * Postgres: needs the SESSION pooler (port 5432) or the direct connection – the advisory lock needs one session.
 * DATABASE_URL_SESSION wins over DATABASE_URL; the transaction pooler (port 6543) is refused. Nothing secret is printed.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { pgConnectionConfig, sessionPostgresConfigFromEnv } from "../../src/server/db/dialects/postgres";
import { openSqliteDatabase } from "../../src/server/db/dialects/sqlite-local";
import { DEFAULT_SQLITE_PATH, resolveDbKind } from "../../src/server/db/index";
import { applyPostgresMigrations, applySqliteMigrations, type PgMigrationClient } from "../../src/server/db/migrations";

export const CLOUDFLARE_ACCOUNT_ID = "a04ab546d0f1be2aa339bafebcdb3ffa";
export const D1_DATABASES = { preview: "clinforms-preview", production: "clinforms-prod" } as const;
const WORKER_DIR = path.resolve("workers/data-gateway");
const WRANGLER_VERSION = "4.139.0";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function pgMigrationClient(client: pg.Client): PgMigrationClient {
  return {
    exec: async (sql) => {
      await client.query(sql);
    },
    query: async (sql, params) => {
      const result = await client.query(sql, params);
      return { rows: result.rows as Record<string, unknown>[] };
    },
  };
}

function wranglerCommand(): { cmd: string; prefix: string[] } {
  const local = path.join(WORKER_DIR, "node_modules", ".bin", "wrangler");
  return fs.existsSync(local) ? { cmd: local, prefix: [] } : { cmd: "npx", prefix: ["--yes", `wrangler@${WRANGLER_VERSION}`] };
}

async function migrateSqlite(): Promise<void> {
  const file = process.env.CLINFORMS_SQLITE_PATH || DEFAULT_SQLITE_PATH;
  const db = openSqliteDatabase(file);
  try {
    const applied = applySqliteMigrations(db);
    console.log(applied.length ? `SQLite ${file}: applied ${applied.join(", ")}` : `SQLite ${file}: up to date`);
  } finally {
    db.close();
  }
}

function migrateD1(): void {
  const target = (arg("--d1-env") ?? "preview") as keyof typeof D1_DATABASES;
  if (!(target in D1_DATABASES)) throw new Error("--d1-env must be preview or production");
  if (target === "production" && !process.argv.includes("--yes")) {
    throw new Error("Refusing to migrate the PRODUCTION D1 without --yes.");
  }
  const { cmd, prefix } = wranglerCommand();
  const args = [...prefix, "d1", "migrations", "apply", D1_DATABASES[target], "--remote"];
  if (target === "preview") args.push("--env", "preview");
  console.log(`wrangler ${args.slice(prefix.length).join(" ")}  (in workers/data-gateway)`);
  const result = spawnSync(cmd, args, {
    cwd: WORKER_DIR,
    stdio: "inherit",
    env: { ...process.env, CI: "1", CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || CLOUDFLARE_ACCOUNT_ID },
  });
  if (result.status !== 0) throw new Error(`wrangler exited with ${result.status}`);
}

async function migratePostgres(): Promise<void> {
  const client = new pg.Client(pgConnectionConfig(sessionPostgresConfigFromEnv()));
  await client.connect();
  try {
    const applied = await applyPostgresMigrations(pgMigrationClient(client));
    console.log(applied.length ? `Postgres: applied ${applied.join(", ")}` : "Postgres: up to date");
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const kind = resolveDbKind();
  if (kind === "sqlite") await migrateSqlite();
  else if (kind === "d1") migrateD1();
  else await migratePostgres();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
