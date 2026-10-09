/**
 * Copies every ClinForms table from D1 (through the gateway) or a local SQLite file into Postgres (Supabase):
 *
 *   DATABASE_URL=<session pooler URL> npm run db:copy-to-postgres -- --from gateway --env production [--dry-run]
 *   DATABASE_URL=… npm run db:copy-to-postgres -- --from sqlite:.data/clinforms.db [--dry-run]
 *
 * - Source "gateway" reads <ENV>_CLINFORMS_D1_GATEWAY_URL/_SECRET from ~/.config/appstackx/clinforms.secrets.env
 *   (or CLINFORMS_D1_GATEWAY_URL/_SECRET from the environment); export it from a snapshot you trust
 *   (writes during the copy are not seen – put the app in maintenance first, docs/database.md).
 * - The target must be migrated (npm run db:migrate with CLINFORMS_DB=postgres) and EMPTY.
 * - Tables are inserted in foreign-key order (TABLES_IN_FK_ORDER) inside ONE transaction; ciphertext is copied
 *   as-is (same keys, same AAD). Before COMMIT the target's row counts and per-table checksums (SHA-256 over
 *   the rows in primary-key order, timestamps normalised to ISO) must equal the source's – else ROLLBACK.
 * - --dry-run reads the source and prints counts and checksums; nothing is written.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { CompiledQuery, Kysely } from "kysely";
import pg from "pg";
import { D1HttpDialect } from "../../src/server/db/dialects/d1-http";
import { pgConnectionConfig, postgresConfigFromEnv } from "../../src/server/db/dialects/postgres";
import { openSqliteDatabase, type SqliteDatabaseLike } from "../../src/server/db/dialects/sqlite-local";
import type { PgMigrationClient } from "../../src/server/db/migrations";
import { PRIMARY_KEYS, TABLES_IN_FK_ORDER, type Database, type TableName } from "../../src/server/db/schema";
import { pgMigrationClient } from "./migrate";
import { readSecretsFile } from "./provision-gateway-secrets";

type Row = Record<string, unknown>;

/** Columns holding timestamps (TEXT in SQLite, timestamptz in Postgres): compared as ISO strings. */
const TIMESTAMP_COLUMNS = new Set(["created_at", "updated_at", "delete_after", "at", "revoked_at", "expires_at", "window_start"]);
/** Rows per page when reading (file chunks are ~700 KB each, so 2 at a time). */
const PAGE_SIZE: Partial<Record<TableName, number>> = { form_file_chunks: 2 };
const DEFAULT_PAGE = 200;
const MAX_INSERT_ROWS = 100;
const MAX_INSERT_BYTES = 1_000_000;

export interface SourceReader {
  readPage(table: TableName, limit: number, offset: number): Promise<Row[]>;
  close(): Promise<void>;
}

const quote = (id: string) => `"${id.replace(/"/g, '""')}"`;
const orderBy = (table: TableName) => PRIMARY_KEYS[table].map(quote).join(", ");

export function sqliteSource(db: SqliteDatabaseLike, closeAfter = false): SourceReader {
  return {
    async readPage(table, limit, offset) {
      return db
        .prepare(`select * from ${quote(table)} order by ${orderBy(table)} limit ? offset ?`)
        .all(limit, offset)
        .map((r) => ({ ...(r as Row) }));
    },
    async close() {
      if (closeAfter) db.close();
    },
  };
}

export function gatewaySource(url: string, secret: string): SourceReader {
  const db = new Kysely<Database>({ dialect: new D1HttpDialect({ url, secret, timeoutMs: 60_000 }) });
  return {
    async readPage(table, limit, offset) {
      const result = await db.executeQuery<Row>(
        CompiledQuery.raw(`select * from ${quote(table)} order by ${orderBy(table)} limit ? offset ?`, [limit, offset]),
      );
      return result.rows;
    },
    close: () => db.destroy(),
  };
}

function normalise(column: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (TIMESTAMP_COLUMNS.has(column) && typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? value : new Date(ms).toISOString();
  }
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

/** Canonical form of a row: columns sorted, values normalised. */
function canonical(row: Row): string {
  const keys = Object.keys(row).sort();
  return JSON.stringify(keys.map((k) => [k, normalise(k, row[k])]));
}

export interface TableSummary {
  table: TableName;
  rows: number;
  sha256: string;
}

async function* readAll(source: SourceReader, table: TableName): AsyncGenerator<Row[]> {
  const size = PAGE_SIZE[table] ?? DEFAULT_PAGE;
  for (let offset = 0; ; offset += size) {
    const page = await source.readPage(table, size, offset);
    if (page.length > 0) yield page;
    if (page.length < size) return;
  }
}

async function summarise(source: SourceReader, table: TableName): Promise<TableSummary> {
  const hash = createHash("sha256");
  let rows = 0;
  for await (const page of readAll(source, table)) {
    for (const row of page) {
      hash.update(canonical(row)).update("\n");
      rows += 1;
    }
  }
  return { table, rows, sha256: hash.digest("hex") };
}

/** Reads the Postgres target back the same way (inside the copy transaction). */
function pgSource(client: PgMigrationClient): SourceReader {
  return {
    async readPage(table, limit, offset) {
      const { rows } = await client.query(`select * from public.${quote(table)} order by ${orderBy(table)} limit $1 offset $2`, [limit, offset]);
      return rows;
    },
    async close() {},
  };
}

async function insertRows(client: PgMigrationClient, table: TableName, rows: Row[]): Promise<void> {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  let batch: Row[] = [];
  let bytes = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    const params: unknown[] = [];
    const tuples = batch.map((row) => {
      const slots = columns.map((c) => {
        params.push(normalise(c, row[c]));
        return `$${params.length}`;
      });
      return `(${slots.join(", ")})`;
    });
    await client.query(`insert into public.${quote(table)} (${columns.map(quote).join(", ")}) values ${tuples.join(", ")}`, params);
    batch = [];
    bytes = 0;
  };
  for (const row of rows) {
    const size = Buffer.byteLength(JSON.stringify(row), "utf8");
    if (batch.length >= MAX_INSERT_ROWS || (batch.length > 0 && bytes + size > MAX_INSERT_BYTES)) await flush();
    batch.push(row);
    bytes += size;
  }
  await flush();
}

export interface CopyResult {
  dryRun: boolean;
  tables: TableSummary[];
}

/** The copy itself (exported for tests: sqlite → PGlite). */
export async function copyDatabase(
  source: SourceReader,
  target: PgMigrationClient,
  options: { dryRun?: boolean; log?: (line: string) => void } = {},
): Promise<CopyResult> {
  const log = options.log ?? (() => undefined);
  const sourceSummaries: TableSummary[] = [];
  for (const table of TABLES_IN_FK_ORDER) sourceSummaries.push(await summarise(source, table));
  for (const s of sourceSummaries) log(`source ${s.table.padEnd(18)} ${String(s.rows).padStart(7)} rows  ${s.sha256.slice(0, 16)}…`);
  if (options.dryRun) return { dryRun: true, tables: sourceSummaries };

  const { rows: present } = await target.query(
    "select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1)",
    [Array.from(TABLES_IN_FK_ORDER)],
  );
  const missing = TABLES_IN_FK_ORDER.filter((t) => !present.some((r) => r.table_name === t));
  if (missing.length) throw new Error(`Target is not migrated (missing: ${missing.join(", ")}). Run npm run db:migrate with CLINFORMS_DB=postgres.`);
  for (const table of TABLES_IN_FK_ORDER) {
    const { rows } = await target.query(`select count(*)::int as n from public.${quote(table)}`);
    if (Number(rows[0].n) > 0) throw new Error(`Target table ${table} is not empty: refusing to copy into a used database.`);
  }

  await target.exec("begin");
  try {
    for (const table of TABLES_IN_FK_ORDER) {
      for await (const page of readAll(source, table)) await insertRows(target, table, page);
    }
    const targetReader = pgSource(target);
    for (const expected of sourceSummaries) {
      const actual = await summarise(targetReader, expected.table);
      if (actual.rows !== expected.rows || actual.sha256 !== expected.sha256) {
        throw new Error(
          `Verification failed for ${expected.table}: source ${expected.rows} rows ${expected.sha256.slice(0, 12)}, ` +
            `target ${actual.rows} rows ${actual.sha256.slice(0, 12)}. Rolled back.`,
        );
      }
      log(`verified ${expected.table.padEnd(16)} ${String(actual.rows).padStart(7)} rows`);
    }
    await target.exec("commit");
  } catch (err) {
    await target.exec("rollback");
    throw err;
  }
  return { dryRun: false, tables: sourceSummaries };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const from = arg("--from") ?? "";
  const dryRun = process.argv.includes("--dry-run");
  let source: SourceReader;
  if (from === "gateway") {
    const prefix = (arg("--env") ?? "production") === "preview" ? "PREVIEW_" : "PRODUCTION_";
    const secrets = readSecretsFile();
    const url = process.env.CLINFORMS_D1_GATEWAY_URL || secrets.get(`${prefix}CLINFORMS_D1_GATEWAY_URL`);
    const secret = process.env.CLINFORMS_D1_GATEWAY_SECRET || secrets.get(`${prefix}CLINFORMS_D1_GATEWAY_SECRET`);
    if (!url || !secret) throw new Error("Gateway URL/secret not found (environment or secrets file).");
    source = gatewaySource(url, secret);
  } else if (from.startsWith("sqlite:")) {
    source = sqliteSource(openSqliteDatabase(from.slice("sqlite:".length)), true);
  } else {
    throw new Error("--from gateway | sqlite:<path> is required");
  }
  const log = (line: string) => console.log(line);
  try {
    if (dryRun) {
      await copyDatabase(source, { exec: async () => undefined, query: async () => ({ rows: [] }) }, { dryRun: true, log });
      console.log("Dry run: nothing written.");
      return;
    }
    const client = new pg.Client(pgConnectionConfig(postgresConfigFromEnv()));
    await client.connect();
    try {
      const result = await copyDatabase(source, pgMigrationClient(client), { log });
      console.log(`Copied ${result.tables.reduce((n, t) => n + t.rows, 0)} rows into Postgres; counts and checksums verified.`);
    } finally {
      await client.end();
    }
  } finally {
    await source.close();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
