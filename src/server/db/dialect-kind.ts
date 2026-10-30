/**
 * Which SQL dialect a Kysely instance speaks, robust to DUPLICATE MODULE INSTANCES of kysely. The app's database is
 * cached on globalThis (src/server/db/index.ts), and Next.js gives route handlers, pages and dev reloads their own
 * copy of kysely, so `adapter instanceof PostgresAdapter` can be false for a Postgres database created by another
 * bundle – the SQLite branch then ran on Supabase ("function julianday(timestamp with time zone) does not exist").
 * Like D1's Symbol.for marker (dialects/d1-http.ts), this falls back to the adapter's shape: of the adapters we use,
 * only Postgres (pg, PGlite) has transactional DDL; SQLite and D1 have none (MSSQL, never used, also has OUTPUT).
 */
import { PostgresAdapter, type DialectAdapter, type Kysely } from "kysely";

export function isPostgresAdapter(adapter: DialectAdapter): boolean {
  if (adapter instanceof PostgresAdapter) return true;
  return adapter.supportsTransactionalDdl === true && adapter.supportsReturning === true && adapter.supportsOutput !== true;
}

export function isPostgresDb<DB>(db: Kysely<DB>): boolean {
  return isPostgresAdapter(db.getExecutor().adapter);
}
