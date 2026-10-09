/**
 * Schema parity: every SQLite/D1 migration applied to node:sqlite and every Supabase migration applied to
 * PGlite must give the same tables with the same column names, and match src/server/db/schema.ts.
 * Run by `npm run test:db`.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { PGlite } from "@electric-sql/pglite";
import { openSqliteDatabase, type SqliteDatabaseLike } from "../src/server/db/dialects/sqlite-local";
import { applyPostgresMigrations, applySqliteMigrations } from "../src/server/db/migrations";
import { PRIMARY_KEYS, TABLES_IN_FK_ORDER } from "../src/server/db/schema";
import { createPglite, pgliteMigrationClient } from "../src/server/db/testing/pglite";

const BOOKKEEPING = new Set(["_migrations", "schema_migrations", "d1_migrations", "sqlite_sequence"]);

type Shape = Map<string, string[]>;

function sqliteShape(db: SqliteDatabaseLike): Shape {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => String((r as { name: unknown }).name))
    .filter((name) => !BOOKKEEPING.has(name));
  const shape: Shape = new Map();
  for (const table of tables) {
    const cols = db
      .prepare("SELECT name FROM pragma_table_info(?) ORDER BY name")
      .all(table)
      .map((r) => String((r as { name: unknown }).name));
    shape.set(table, cols);
  }
  return shape;
}

async function postgresShape(pglite: PGlite): Promise<Shape> {
  const { rows } = await pglite.query<{ table_name: string; column_name: string }>(
    "select table_name, column_name from information_schema.columns where table_schema = 'public' order by table_name, column_name",
  );
  const shape: Shape = new Map();
  for (const row of rows) {
    if (BOOKKEEPING.has(row.table_name)) continue;
    const cols = shape.get(row.table_name) ?? [];
    cols.push(row.column_name);
    shape.set(row.table_name, cols);
  }
  return shape;
}

function asObject(shape: Shape): Record<string, string[]> {
  return Object.fromEntries(Array.from(shape.entries()).sort(([a], [b]) => a.localeCompare(b)));
}

describe("migration parity (SQLite/D1 vs Postgres/Supabase)", () => {
  let sqlite: SqliteDatabaseLike;
  let pglite: PGlite;

  before(async () => {
    sqlite = openSqliteDatabase(":memory:");
    applySqliteMigrations(sqlite);
    pglite = await createPglite();
    await applyPostgresMigrations(pgliteMigrationClient(pglite));
  });
  after(async () => {
    sqlite?.close();
    await pglite?.close();
  });

  it("both migration sets create the same tables and column names", async () => {
    assert.deepEqual(asObject(await postgresShape(pglite)), asObject(sqliteShape(sqlite)));
  });

  it("the schema module lists exactly the migrated tables (ours and Better Auth's)", () => {
    const migrated = Array.from(sqliteShape(sqlite).keys()).sort();
    assert.deepEqual(migrated, Array.from(TABLES_IN_FK_ORDER).sort());
    for (const table of TABLES_IN_FK_ORDER) {
      const cols = sqliteShape(sqlite).get(table) ?? [];
      for (const pk of PRIMARY_KEYS[table]) assert.ok(cols.includes(pk), `${table}.${pk}`);
    }
  });

  it("re-running the migrations is a no-op on both", async () => {
    assert.deepEqual(applySqliteMigrations(sqlite), []);
    assert.deepEqual(await applyPostgresMigrations(pgliteMigrationClient(pglite)), []);
  });

  it("every Postgres table has row level security enabled", async () => {
    const { rows } = await pglite.query<{ relname: string; relrowsecurity: boolean }>(
      "select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace " +
        "where n.nspname = 'public' and c.relkind = 'r'",
    );
    assert.ok(rows.length >= TABLES_IN_FK_ORDER.length);
    for (const row of rows) assert.equal(row.relrowsecurity, true, `${row.relname} has RLS off`);
    const policies = await pglite.query<{ n: number }>("select count(*)::int as n from pg_policies where schemaname = 'public'");
    assert.equal(policies.rows[0].n, 0);
  });

  it("the migration files themselves are idempotent (applying the SQL twice raises nothing)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const sqliteDir = path.resolve("db/migrations/sqlite");
    for (const file of fs.readdirSync(sqliteDir).filter((f) => f.endsWith(".sql"))) {
      sqlite.exec(fs.readFileSync(path.join(sqliteDir, file), "utf8"));
    }
    const pgDir = path.resolve("supabase/migrations");
    for (const file of fs.readdirSync(pgDir).filter((f) => f.endsWith(".sql"))) {
      await pglite.exec(fs.readFileSync(path.join(pgDir, file), "utf8"));
    }
  });
});
