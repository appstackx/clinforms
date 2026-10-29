/**
 * Text comparison order across the dialects. SQLite and D1 compare text byte by byte (BINARY). Supabase Postgres
 * uses the database's default collation, en_US.UTF-8 (glibc): case is only a tie-breaker and punctuation is
 * IGNORED on the first pass, so "pms.closure.create" > "pms.closure/" there, while it is smaller in byte order.
 *
 * Display order (names in a list) may follow the database. Anything that relies on byte order – a range over a
 * prefix, a code or an id with punctuation, a cursor compared with `<` – must use byteOrder() on Postgres.
 * ULIDs (0-9, A-Z only) sort the same in both, so id ranges and keysets on ULIDs need nothing.
 */
import { sql, type Kysely, type RawBuilder } from "kysely";
import { isPostgresDb } from "./dialect-kind";

/** `column` compared in byte order: COLLATE "C" on Postgres; as it is on SQLite / D1 (already byte order). */
export function byteOrder<DB>(db: Kysely<DB>, column: string): RawBuilder<string> {
  return isPostgresDb(db) ? sql<string>`${sql.ref(column)} collate "C"` : sql<string>`${sql.ref(column)}`;
}
