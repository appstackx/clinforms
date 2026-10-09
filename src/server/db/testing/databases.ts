/**
 * TESTS ONLY: fresh, fully migrated databases for each dialect we can run in-process, plus a throwaway
 * data cipher. (The D1 gateway path is exercised by workers/data-gateway/test.)
 */
import { randomBytes } from "node:crypto";
import { Kysely } from "kysely";
import { DataCipher, parseKeyring } from "../../crypto/envelope";
import { NodeSqliteDialect, openSqliteDatabase, type SqliteDatabaseLike } from "../dialects/sqlite-local";
import { applySqliteMigrations } from "../migrations";
import type { Database } from "../schema";
import { createMigratedPgliteDb } from "./pglite";

export interface TestDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
}

export function createSqliteTestDb(): TestDb & { sqlite: SqliteDatabaseLike } {
  const sqlite = openSqliteDatabase(":memory:");
  applySqliteMigrations(sqlite);
  const db = new Kysely<Database>({ dialect: new NodeSqliteDialect({ database: sqlite }) });
  return { db, sqlite, close: () => db.destroy() };
}

export async function createPgliteTestDb(): Promise<TestDb> {
  const { db } = await createMigratedPgliteDb();
  return { db, close: () => db.destroy() };
}

export function testCipher(): DataCipher {
  return new DataCipher(parseKeyring(JSON.stringify({ t1: randomBytes(32).toString("base64") }), "t1"));
}
