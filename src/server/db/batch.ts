/**
 * runBatch(db, queries): several writes that must succeed or fail together, on every dialect.
 * - D1 (gateway): one `batch` request → env.DB.batch() (D1 runs it as one atomic unit).
 * - Postgres / local SQLite: a real transaction.
 * Queries are built on `db` and passed un-executed (a query builder or a CompiledQuery). No reads between
 * statements are possible (D1 cannot do that); put conditions in the SQL (WHERE rev = ?, ON CONFLICT…).
 */
import type { CompiledQuery, Compilable, Kysely, QueryResult } from "kysely";
import { D1_BATCH_MARKER, type D1HttpConnection } from "./dialects/d1-http";

export type BatchQuery = Compilable<unknown> | CompiledQuery<unknown>;

function compile(query: BatchQuery): CompiledQuery<unknown> {
  return "compile" in query && typeof query.compile === "function" ? query.compile() : (query as CompiledQuery<unknown>);
}

function hasMarker(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[D1_BATCH_MARKER] === true;
}

export function isD1Database<DB>(db: Kysely<DB>): boolean {
  return hasMarker(db.getExecutor().adapter);
}

export async function runBatch<DB>(
  db: Kysely<DB>,
  queries: readonly BatchQuery[],
): Promise<QueryResult<Record<string, unknown>>[]> {
  if (queries.length === 0) return [];
  const compiled = queries.map(compile);
  if (isD1Database(db)) {
    return db.getExecutor().provideConnection(async (connection) => {
      if (!hasMarker(connection)) throw new Error("runBatch: unexpected D1 connection type.");
      return (connection as D1HttpConnection).executeBatch(compiled);
    });
  }
  return db.transaction().execute(async (trx) => {
    const results: QueryResult<Record<string, unknown>>[] = [];
    for (const query of compiled) {
      results.push((await trx.executeQuery(query)) as QueryResult<Record<string, unknown>>);
    }
    return results;
  });
}
