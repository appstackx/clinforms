/**
 * TESTS ONLY: fresh, migrated databases (node:sqlite and PGlite) whose Kysely instance records every SQL
 * statement, and the tenant-scope guard every clinic-system repository suite must pass:
 *
 *   every statement that touches a clinic-system table (pms_*, clinic_entitlements, clinic_usage_counters)
 *   names tenant_id – in its WHERE clause (SELECT / UPDATE / DELETE) or its column list (INSERT).
 *
 * Module builders: run your repository suite on these databases and call assertTenantScoped(queries) at the end
 * (docs/clinic-system/contract.md §8). Cross-clinic reads (platform pages, retention jobs) run between pause()
 * and resume() and need a reason in the test.
 */
import { Kysely, PGliteDialect, type LogEvent } from "kysely";
import { NodeSqliteDialect, openSqliteDatabase } from "../../../db/dialects/sqlite-local";
import { applyPostgresMigrations, applySqliteMigrations } from "../../../db/migrations";
import type { Database } from "../../../db/schema";
import { createPglite, pgliteMigrationClient } from "../../../db/testing/pglite";

export interface QueryLog {
  readonly statements: string[];
  /** Stop recording (cross-clinic reads that are allowed). */
  pause(): void;
  resume(): void;
}

export interface GuardedDb {
  db: Kysely<Database>;
  log: QueryLog;
  close: () => Promise<void>;
}

function makeLog(): { log: QueryLog; onEvent: (event: LogEvent) => void } {
  const statements: string[] = [];
  let paused = false;
  return {
    log: {
      statements,
      pause: () => {
        paused = true;
      },
      resume: () => {
        paused = false;
      },
    },
    onEvent: (event) => {
      if (!paused) statements.push(event.query.sql);
    },
  };
}

export function createGuardedSqliteDb(): GuardedDb {
  const sqlite = openSqliteDatabase(":memory:");
  applySqliteMigrations(sqlite);
  const { log, onEvent } = makeLog();
  const db = new Kysely<Database>({ dialect: new NodeSqliteDialect({ database: sqlite }), log: onEvent });
  return { db, log, close: () => db.destroy() };
}

export async function createGuardedPgliteDb(): Promise<GuardedDb> {
  const pglite = await createPglite();
  await applyPostgresMigrations(pgliteMigrationClient(pglite));
  const { log, onEvent } = makeLog();
  const db = new Kysely<Database>({ dialect: new PGliteDialect({ pglite }), log: onEvent });
  return { db, log, close: () => db.destroy() };
}

const PMS_TABLE = /"(pms_[a-z0-9_]+|clinic_entitlements|clinic_usage_counters)"|\bfrom (pms_[a-z0-9_]+)\b/i;

/** The statements that touch a clinic-system table without naming tenant_id (empty = all scoped). */
export function unscopedStatements(statements: readonly string[]): string[] {
  return statements.filter((sql) => {
    if (!PMS_TABLE.test(sql)) return false;
    const s = sql.trim();
    if (/^insert/i.test(s)) {
      const columns = /^insert into\s+"?[a-z0-9_]+"?\s*\(([^)]*)\)/i.exec(s)?.[1] ?? "";
      return !/"?tenant_id"?/.test(columns);
    }
    if (/^(select|update|delete|with)/i.test(s)) return !/\btenant_id"?\s*(=|in\b)/i.test(s);
    return true;
  });
}
