/**
 * TESTS ONLY: the repository suites on a REAL Postgres instead of PGlite, when CLINFORMS_TEST_PG_URL is set.
 *
 *   CLINFORMS_TEST_PG_URL=postgres://postgres:…@localhost:55432/postgres npm run test:pms
 *
 * PGlite is one in-process connection with the C collation; production (Supabase, Postgres 17) sorts text in
 * en_US.UTF-8, talks over the network through a pool and runs writers concurrently. With the variable set, every
 * createPgliteTestDb() / createGuardedPgliteDb() hands out a fresh database on that server instead (created,
 * migrated with supabase/migrations, dropped on close). The URL must be a Postgres on this machine (loopback host;
 * TLS off) – e.g. the Docker `k2-pg` database (docs/clinic-system/M11-RUNSHEET.md) – never a server database.
 * Its default collation decides text order: create the server with --locale=en_US.UTF-8 to match Supabase.
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { Kysely, PostgresDialect, type LogEvent } from "kysely";
import { createPgPool, isLoopbackPostgresUrl, pgConnectionConfig } from "../dialects/postgres";
import { applyPostgresMigrations } from "../migrations";
import type { Database } from "../schema";

/** The real-Postgres URL for tests, or null (PGlite). Throws for anything but a Postgres on this machine. */
export function realPgTestUrl(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const url = env.CLINFORMS_TEST_PG_URL;
  if (!url) return null;
  if (!isLoopbackPostgresUrl(url)) throw new Error("CLINFORMS_TEST_PG_URL must be a Postgres on this machine (localhost) – never a server database.");
  return url;
}

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

async function admin<T>(url: string, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(pgConnectionConfig({ connectionString: url, ssl: "disable" }));
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

let counter = 0;

/** A fresh, migrated database on the real Postgres (`url` = its own URL); `close` drops it. */
export async function createRealPgDb(url: string, log?: (event: LogEvent) => void): Promise<{ db: Kysely<Database>; url: string; close: () => Promise<void> }> {
  const name = `cf_test_${process.pid}_${++counter}_${randomBytes(3).toString("hex")}`;
  await admin(url, (c) => c.query(`create database ${name}`));
  const dbUrl = withDatabase(url, name);
  await admin(dbUrl, (c) =>
    applyPostgresMigrations({
      exec: async (sql) => {
        await c.query(sql);
      },
      query: async (sql, params) => ({ rows: (await c.query(sql, params)).rows as Record<string, unknown>[] }),
    }),
  );
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool: createPgPool({ connectionString: dbUrl, ssl: "disable", max: 4 }) }),
    ...(log ? { log } : {}),
  });
  return {
    db,
    url: dbUrl,
    close: async () => {
      await db.destroy();
      await admin(url, (c) => c.query(`drop database if exists ${name} with (force)`));
    },
  };
}
