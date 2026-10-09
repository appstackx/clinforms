/**
 * Kysely dialect over Node 22's built-in `node:sqlite` (`DatabaseSync`), for local development
 * (CLINFORMS_DB=sqlite, file CLINFORMS_SQLITE_PATH) and tests (":memory:").
 *
 * `node:sqlite` is loaded with process.getBuiltinModule() at runtime, so bundlers never see the import.
 * Kysely serialises access to the single connection itself (SqliteAdapter.supportsMultipleConnections =
 * false), so a transaction cannot interleave with other queries.
 */
import fs from "node:fs";
import path from "node:path";
import {
  CompiledQuery,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type DatabaseConnection,
  type DatabaseIntrospector,
  type Dialect,
  type DialectAdapter,
  type Driver,
  type Kysely,
  type QueryCompiler,
  type QueryResult,
} from "kysely";
import { DbError } from "../errors";

/** The subset of node:sqlite's StatementSync we use. */
export interface SqliteStatementLike {
  all(...params: SqliteValue[]): unknown[];
  run(...params: SqliteValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  columns(): unknown[];
}

/** The subset of node:sqlite's DatabaseSync we use. */
export interface SqliteDatabaseLike {
  prepare(sql: string): SqliteStatementLike;
  exec(sql: string): void;
  close(): void;
}

export type SqliteValue = null | number | bigint | string | Uint8Array;

interface NodeSqliteModule {
  DatabaseSync: new (
    location: string,
    options?: { open?: boolean; readOnly?: boolean; enableForeignKeyConstraints?: boolean; timeout?: number },
  ) => SqliteDatabaseLike;
}

function loadNodeSqlite(): NodeSqliteModule {
  const mod = process.getBuiltinModule?.("node:sqlite") as NodeSqliteModule | undefined;
  if (!mod?.DatabaseSync) {
    throw new DbError("NOT_CONFIGURED", "node:sqlite is not available: local SQLite needs Node 22.13 or later.");
  }
  return mod;
}

/** Opens (and creates) a SQLite database file, or ":memory:". Foreign keys on, WAL for files. */
export function openSqliteDatabase(location: string): SqliteDatabaseLike {
  const { DatabaseSync } = loadNodeSqlite();
  const inMemory = location === ":memory:";
  if (!inMemory) fs.mkdirSync(path.dirname(path.resolve(location)), { recursive: true });
  const db = new DatabaseSync(location, { enableForeignKeyConstraints: true, timeout: 5000 });
  db.exec("PRAGMA foreign_keys = ON");
  if (!inMemory) db.exec("PRAGMA journal_mode = WAL");
  return db;
}

export function toSqliteValue(value: unknown): SqliteValue {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
      return value;
    case "number":
      if (!Number.isFinite(value)) throw new DbError("BAD_PARAMETER", "SQL parameter is not a finite number.");
      return value;
    case "bigint":
      return value;
    case "boolean":
      return value ? 1 : 0;
    case "object":
      if (value instanceof Date) return value.toISOString();
      if (value instanceof Uint8Array) return value;
      break;
    default:
      break;
  }
  throw new DbError("BAD_PARAMETER", `Unsupported SQL parameter type: ${value === undefined ? "undefined" : typeof value}.`);
}

export interface NodeSqliteDialectConfig {
  /** An open database, or a factory called once on first use (e.g. open + migrate). */
  database: SqliteDatabaseLike | (() => SqliteDatabaseLike);
}

export class NodeSqliteDialect implements Dialect {
  constructor(private readonly config: NodeSqliteDialectConfig) {}
  createAdapter(): DialectAdapter {
    return new SqliteAdapter();
  }
  createDriver(): Driver {
    return new NodeSqliteDriver(this.config);
  }
  createIntrospector(db: Kysely<unknown>): DatabaseIntrospector {
    return new SqliteIntrospector(db);
  }
  createQueryCompiler(): QueryCompiler {
    return new SqliteQueryCompiler();
  }
}

class NodeSqliteDriver implements Driver {
  private _db?: SqliteDatabaseLike;
  private _connection?: NodeSqliteConnection;
  constructor(private readonly config: NodeSqliteDialectConfig) {}

  async init(): Promise<void> {
    const { database } = this.config;
    this._db = typeof database === "function" ? database() : database;
    this._connection = new NodeSqliteConnection(this._db);
  }
  async acquireConnection(): Promise<DatabaseConnection> {
    if (!this._connection) throw new DbError("NOT_CONFIGURED", "SQLite driver used before init().");
    return this._connection;
  }
  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("begin immediate"));
  }
  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("commit"));
  }
  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("rollback"));
  }
  async releaseConnection(): Promise<void> {
    // single shared connection; Kysely holds its own mutex around it
  }
  async destroy(): Promise<void> {
    this._db?.close();
    this._db = undefined;
    this._connection = undefined;
  }
}

class NodeSqliteConnection implements DatabaseConnection {
  constructor(private readonly db: SqliteDatabaseLike) {}

  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    const params = compiled.parameters.map(toSqliteValue);
    const stmt = this.db.prepare(compiled.sql);
    if (stmt.columns().length > 0) {
      // node:sqlite rows have a null prototype: copy them into plain objects.
      const rows = stmt.all(...params).map((row) => ({ ...(row as Record<string, unknown>) }) as R);
      return { rows };
    }
    const { changes, lastInsertRowid } = stmt.run(...params);
    return {
      rows: [],
      numAffectedRows: BigInt(changes),
      insertId: BigInt(lastInsertRowid),
    };
  }

  streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new DbError("SQL_ERROR", "Streaming is not supported by the local SQLite driver.");
  }
}
