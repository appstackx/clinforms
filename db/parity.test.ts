/**
 * Schema parity: every SQLite/D1 migration applied to node:sqlite and every Supabase migration applied to
 * PGlite must give the same tables with the same column names and the same constraints (NOT NULL, primary keys,
 * foreign keys with ON DELETE, unique and other indexes), keep audit_log append-only on both, and match
 * src/server/db/schema.ts. Not compared: column types (dialect-specific by design), defaults (Better Auth's
 * generator adds DEFAULT CURRENT_TIMESTAMP on Postgres only) and CHECK constraints.
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

/** Per table: NOT NULL columns, primary key, foreign keys (with ON DELETE), unique and plain indexes. */
interface Constraints {
  notNull: string[];
  primaryKey: string[];
  foreignKeys: string[];
  unique: string[];
  indexes: string[];
}

type Row = Record<string, unknown>;

function sqliteConstraints(db: SqliteDatabaseLike, table: string): Constraints {
  const cols = db.prepare('SELECT name, "notnull" AS nn, pk FROM pragma_table_info(?)').all(table) as Row[];
  const fkRows = db.prepare('SELECT id, "from" AS col, "table" AS ref, "to" AS refcol, on_delete FROM pragma_foreign_key_list(?) ORDER BY id, seq').all(table) as Row[];
  const fkById = new Map<number, Row[]>();
  for (const r of fkRows) fkById.set(Number(r.id), [...(fkById.get(Number(r.id)) ?? []), r]);
  const indexes = (db.prepare('SELECT name, "unique" AS u, origin FROM pragma_index_list(?)').all(table) as Row[])
    .filter((i) => i.origin !== "pk") // SQLite's automatic index for the primary key
    .map((i) => ({
      unique: Number(i.u) === 1,
      cols: (db.prepare("SELECT name FROM pragma_index_info(?) ORDER BY seqno").all(String(i.name)) as Row[]).map((c) => String(c.name)).join(","),
    }));
  return {
    notNull: cols.filter((c) => Number(c.nn) === 1 || Number(c.pk) > 0).map((c) => String(c.name)).sort(),
    primaryKey: cols.filter((c) => Number(c.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map((c) => String(c.name)),
    foreignKeys: Array.from(fkById.values())
      .map((rs) => `${rs.map((r) => r.col).join(",")} -> ${String(rs[0].ref)}(${rs.map((r) => r.refcol).join(",")}) on delete ${String(rs[0].on_delete)}`)
      .sort(),
    unique: indexes.filter((i) => i.unique).map((i) => i.cols).sort(),
    indexes: indexes.filter((i) => !i.unique).map((i) => i.cols).sort(),
  };
}

const PG_ON_DELETE: Record<string, string> = { a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT" };

async function postgresConstraints(pglite: PGlite): Promise<Map<string, Constraints>> {
  const notNull = await pglite.query<Row>("select table_name, column_name from information_schema.columns where table_schema = 'public' and is_nullable = 'NO'");
  const pks = await pglite.query<Row>(
    "select tc.table_name, kcu.column_name from information_schema.table_constraints tc join information_schema.key_column_usage kcu " +
      "on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema " +
      "where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY' order by kcu.ordinal_position",
  );
  const cols = (keys: string, rel: string) =>
    `array_to_string(array(select a.attname from unnest(${keys}) with ordinality k(n, o) join pg_attribute a on a.attrelid = ${rel} and a.attnum = k.n order by k.o), ',')`;
  const fks = await pglite.query<Row>(
    `select cl.relname as t, rc.relname as ref, c.confdeltype as del, ${cols("c.conkey", "c.conrelid")} as col, ${cols("c.confkey", "c.confrelid")} as refcol ` +
      "from pg_constraint c join pg_class cl on cl.oid = c.conrelid join pg_namespace n on n.oid = cl.relnamespace " +
      "join pg_class rc on rc.oid = c.confrelid where c.contype = 'f' and n.nspname = 'public'",
  );
  const idx = await pglite.query<Row>(
    `select t.relname as t, ix.indisunique as u, ix.indisprimary as p, ${cols("ix.indkey", "t.oid")} as cols ` +
      "from pg_index ix join pg_class t on t.oid = ix.indrelid join pg_namespace n on n.oid = t.relnamespace where n.nspname = 'public'",
  );
  const out = new Map<string, Constraints>();
  const get = (t: unknown) => {
    const key = String(t);
    if (!out.has(key)) out.set(key, { notNull: [], primaryKey: [], foreignKeys: [], unique: [], indexes: [] });
    return out.get(key) as Constraints;
  };
  for (const r of notNull.rows) get(r.table_name).notNull.push(String(r.column_name));
  for (const r of pks.rows) get(r.table_name).primaryKey.push(String(r.column_name));
  for (const r of fks.rows) get(r.t).foreignKeys.push(`${String(r.col)} -> ${String(r.ref)}(${String(r.refcol)}) on delete ${PG_ON_DELETE[String(r.del)]}`);
  for (const r of idx.rows) {
    if (r.p) continue;
    (r.u ? get(r.t).unique : get(r.t).indexes).push(String(r.cols));
  }
  for (const c of Array.from(out.values())) {
    c.notNull.sort();
    c.foreignKeys.sort();
    c.unique.sort();
    c.indexes.sort();
  }
  return out;
}

/** A migration file that is one `ALTER TABLE … ADD COLUMN …` statement and comments, nothing else. */
function isLoneAddColumn(sql: string): boolean {
  const statements = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  return statements.length === 1 && /^ALTER\s+TABLE\s+\S+\s+ADD\s+(COLUMN\s+)?\S+\s+\S+/i.test(statements[0]);
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

  it("both migration sets have the same constraints: NOT NULL, primary keys, foreign keys + ON DELETE, unique and other indexes", async () => {
    const pg = await postgresConstraints(pglite);
    for (const table of Array.from(sqliteShape(sqlite).keys())) {
      assert.deepEqual(pg.get(table), sqliteConstraints(sqlite, table), table);
    }
  });

  it("audit_log is append-only on both: UPDATE, DELETE and overwrite (REPLACE / upsert) are refused", async () => {
    const triggers = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'audit_log' ORDER BY name").all() as Row[]).map((r) => r.name);
    assert.deepEqual(triggers, ["audit_log_no_delete", "audit_log_no_replace", "audit_log_no_update"]);
    const at = "2026-10-09T10:00:00.000Z";
    sqlite.prepare("INSERT INTO audit_log (id, tenant_id, action, at) VALUES (?, ?, ?, ?)").run("P1", "t", "member.remove", at);
    for (const sql of [
      "UPDATE audit_log SET action = 'x' WHERE id = 'P1'",
      "DELETE FROM audit_log WHERE id = 'P1'",
      "INSERT OR REPLACE INTO audit_log (id, tenant_id, action, at) VALUES ('P1', 't', 'harmless.event', 'x')",
      "REPLACE INTO audit_log (id, tenant_id, action, at) VALUES ('P1', 't', 'harmless.event', 'x')",
      "INSERT INTO audit_log (id, tenant_id, action, at) VALUES ('P1', 't', 'x', 'x') ON CONFLICT (id) DO UPDATE SET action = 'x'",
    ]) {
      assert.throws(() => sqlite.exec(sql), /append-only/, sql);
    }
    assert.deepEqual((sqlite.prepare("SELECT action FROM audit_log WHERE id = 'P1'").all() as Row[]).map((r) => r.action), ["member.remove"]);
    await pglite.query("insert into audit_log (id, tenant_id, action, at) values ('P1', 't', 'member.remove', now())");
    for (const sql of [
      "update audit_log set action = 'x' where id = 'P1'",
      "delete from audit_log where id = 'P1'",
      "insert into audit_log (id, tenant_id, action, at) values ('P1', 't', 'x', now()) on conflict (id) do update set action = 'x'",
    ]) {
      await assert.rejects(pglite.query(sql), /append-only/, sql);
    }
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

  it("access_requests.contacted_at (0004) is a nullable timestamp on both; audit_log has the per-user index (0005)", async () => {
    const col = (sqlite.prepare('SELECT type, "notnull" AS nn FROM pragma_table_info(?) WHERE name = ?').all("access_requests", "contacted_at") as Row[])[0];
    assert.deepEqual({ type: col?.type, nn: Number(col?.nn) }, { type: "TEXT", nn: 0 });
    const pgCol = await pglite.query<Row>(
      "select data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'access_requests' and column_name = 'contacted_at'",
    );
    assert.deepEqual(pgCol.rows, [{ data_type: "timestamp with time zone", is_nullable: "YES" }]);
    assert.ok(sqliteConstraints(sqlite, "audit_log").indexes.includes("tenant_id,user_id,id"));
    assert.ok((await postgresConstraints(pglite)).get("audit_log")?.indexes.includes("tenant_id,user_id,id"));
  });

  it("only a file holding one lone ADD COLUMN statement is exempt from re-running cleanly", () => {
    assert.equal(isLoneAddColumn("-- why\nALTER TABLE access_requests ADD COLUMN contacted_at TEXT;\n"), true);
    assert.equal(isLoneAddColumn("ALTER TABLE t ADD c TEXT"), true);
    assert.equal(isLoneAddColumn("ALTER TABLE t ADD COLUMN c TEXT;\nCREATE INDEX IF NOT EXISTS i ON t (c);"), false);
    assert.equal(isLoneAddColumn("ALTER TABLE t DROP COLUMN c;"), false);
    assert.equal(isLoneAddColumn("ALTER TABLE t RENAME TO u;"), false);
    assert.equal(isLoneAddColumn("-- only a comment\n"), false);
  });

  it("the migration files themselves are idempotent (applying the SQL twice raises nothing)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const sqliteDir = path.resolve("db/migrations/sqlite");
    for (const file of fs.readdirSync(sqliteDir).filter((f) => f.endsWith(".sql"))) {
      const sql = fs.readFileSync(path.join(sqliteDir, file), "utf8");
      try {
        sqlite.exec(sql);
      } catch (err) {
        // SQLite has no ADD COLUMN IF NOT EXISTS: a file holding exactly one ALTER TABLE … ADD COLUMN (and nothing
        // else) may fail on a second run, and only because the column exists already.
        if (!(isLoneAddColumn(sql) && /duplicate column name/i.test(err instanceof Error ? err.message : String(err)))) throw err;
      }
    }
    const pgDir = path.resolve("supabase/migrations");
    for (const file of fs.readdirSync(pgDir).filter((f) => f.endsWith(".sql"))) {
      await pglite.exec(fs.readFileSync(path.join(pgDir, file), "utf8"));
    }
  });
});
