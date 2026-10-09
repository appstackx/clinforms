/**
 * TESTS ONLY: an in-memory Postgres (PGlite, WebAssembly) behind Kysely's PGliteDialect, with the same
 * type parsers as the production Postgres dialect, so repository tests see identical rows on SQLite and
 * Postgres. @electric-sql/pglite is a devDependency: never import this from app code.
 */
import { PGlite } from "@electric-sql/pglite";
import { Kysely, PGliteDialect } from "kysely";
import { PG_TEXT_PARSERS } from "../dialects/postgres";
import { applyPostgresMigrations, type PgMigrationClient } from "../migrations";
import type { Database } from "../schema";

export function pgliteMigrationClient(pglite: PGlite): PgMigrationClient {
  return {
    exec: async (sql) => {
      await pglite.exec(sql);
    },
    query: async (sql, params) => {
      const result = await pglite.query<Record<string, unknown>>(sql, params as unknown[] | undefined);
      return { rows: result.rows };
    },
  };
}

export async function createPglite(): Promise<PGlite> {
  const pglite = new PGlite({ parsers: PG_TEXT_PARSERS });
  await pglite.waitReady;
  return pglite;
}

/** A fresh in-memory Postgres with every supabase/migrations file applied. */
export async function createMigratedPgliteDb(): Promise<{ db: Kysely<Database>; pglite: PGlite }> {
  const pglite = await createPglite();
  await applyPostgresMigrations(pgliteMigrationClient(pglite));
  const db = new Kysely<Database>({ dialect: new PGliteDialect({ pglite }) });
  return { db, pglite };
}
