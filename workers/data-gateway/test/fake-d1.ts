/**
 * A D1 binding stand-in over node:sqlite for unit tests: prepare/bind/all and an atomic batch()
 * (BEGIN … COMMIT / ROLLBACK), with D1-style error messages ("D1_ERROR: …: SQLITE_CONSTRAINT").
 */
import { openSqliteDatabase, toSqliteValue, type SqliteDatabaseLike } from "../../../src/server/db/dialects/sqlite-local";
import { applySqliteMigrations } from "../../../src/server/db/migrations";
import type { D1DatabaseLike, D1ResultLike, D1StatementLike } from "../src/d1";

function d1Error(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  const kind = /constraint/i.test(message) ? "SQLITE_CONSTRAINT" : "SQLITE_ERROR";
  return new Error(`D1_ERROR: ${message}: ${kind}`);
}

class FakeStatement implements D1StatementLike {
  constructor(
    private readonly db: SqliteDatabaseLike,
    readonly sql: string,
    private readonly values: unknown[] = [],
  ) {}
  bind(...values: unknown[]): D1StatementLike {
    return new FakeStatement(this.db, this.sql, values);
  }
  run(): D1ResultLike {
    const stmt = this.db.prepare(this.sql);
    const params = this.values.map(toSqliteValue);
    if (stmt.columns().length > 0) {
      const results = stmt.all(...params).map((r) => ({ ...(r as Record<string, unknown>) }));
      return { results, meta: { changes: 0, last_row_id: 0 } };
    }
    const info = stmt.run(...params);
    return { results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }
  async all(): Promise<D1ResultLike> {
    try {
      return this.run();
    } catch (err) {
      throw d1Error(err);
    }
  }
}

export class FakeD1 implements D1DatabaseLike {
  readonly sqlite: SqliteDatabaseLike;
  batches = 0;
  constructor() {
    this.sqlite = openSqliteDatabase(":memory:");
    applySqliteMigrations(this.sqlite);
  }
  prepare(query: string): D1StatementLike {
    return new FakeStatement(this.sqlite, query);
  }
  async batch(statements: D1StatementLike[]): Promise<D1ResultLike[]> {
    this.batches += 1;
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((s) => (s as FakeStatement).run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (err) {
      this.sqlite.exec("ROLLBACK");
      throw d1Error(err);
    }
  }
  close(): void {
    this.sqlite.close();
  }
}
