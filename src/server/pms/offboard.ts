/**
 * Offboarding a clinic that used the clinic system (src/server/auth/platform.ts offboardClinic): count, export
 * DECRYPTED, then delete every clinic-system row of the clinic – generically, over the tables each module lists in
 * src/server/db/pms-schema/<module>.ts (*_TENANT_TABLES), so a module's new tables are covered without touching
 * this file. Encrypted columns ("<name>_enc", AAD "<tenant>:<table>.<column>:<id>") come out as "<name>".
 *
 * This is the ONLY place clinic-system rows are deleted in bulk, and only after the export has been written and
 * read back (docs/auth.md "Offboard a clinic"). No scheduled job ever deletes clinical records.
 */
import type { Kysely } from "kysely";
import type { DataCipher } from "../crypto/envelope";
import type { BatchQuery } from "../db/batch";
import { PMS_PRIMARY_KEYS, PMS_TENANT_TABLES, type PmsTableName } from "../db/pms-schema";
import type { Database } from "../db/schema";
import { decryptField } from "../repos/pms/context";
import { isMissingPmsTable } from "./missing-table";

export { isMissingPmsTable };

type Row = Record<string, unknown>;
type AnyDb = Kysely<Record<string, Row>>;

const PAGE = 200;

function loose(db: Kysely<Database>): AnyDb {
  return db as unknown as AnyDb;
}

/**
 * Rows per clinic-system table for one clinic (tables with no rows are left out). FAIL-SAFE for a release that
 * reaches a database before the clinic system's migrations: a table that does not exist yet holds no rows (any
 * other error still throws). Offboarding a ClinForms-only clinic therefore works before, during and after them.
 */
export async function countPmsRows(db: Kysely<Database>, tenantId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of PMS_TENANT_TABLES) {
    let row: { n: number } | undefined;
    try {
      row = await loose(db)
        .selectFrom(table)
        .select((eb) => eb.fn.countAll<number>().as("n"))
        .where("tenant_id", "=", tenantId)
        .executeTakeFirst();
    } catch (err) {
      if (isMissingPmsTable(err, table)) continue;
      throw err;
    }
    const n = Number(row?.n ?? 0);
    if (n > 0) out[table] = n;
  }
  return out;
}

function decryptRow(cipher: DataCipher, tenantId: string, table: string, row: Row): Row {
  const out: Row = {};
  for (const [column, value] of Object.entries(row)) {
    if (column.endsWith("_enc")) {
      const id = typeof row.id === "string" ? row.id : "";
      out[column.slice(0, -4)] = value === null ? null : decryptField({ cipher }, tenantId, table, column, id, String(value));
    } else {
      out[column] = value;
    }
  }
  return out;
}

/**
 * Every clinic-system row of the clinic, decrypted, by table (keyset paging on the primary key). `tables`: only these
 * (offboarding passes the tables countPmsRows found rows in, so a table that does not exist yet is never read).
 */
export async function exportPmsData(
  db: Kysely<Database>,
  cipher: DataCipher,
  tenantId: string,
  options: { tables?: readonly string[] } = {},
): Promise<Record<string, Row[]>> {
  const out: Record<string, Row[]> = {};
  const wanted = options.tables ? new Set(options.tables) : null;
  for (const table of PMS_TENANT_TABLES) {
    if (wanted && !wanted.has(table)) continue;
    const keys = PMS_PRIMARY_KEYS[table as PmsTableName] as readonly string[];
    const rows: Row[] = [];
    if (keys.length === 2 && keys[0] === "tenant_id" && keys[1] === "id") {
      let after = "";
      for (;;) {
        const page = await loose(db).selectFrom(table).selectAll().where("tenant_id", "=", tenantId).where("id", ">", after).orderBy("id").limit(PAGE).execute();
        rows.push(...page.map((r) => decryptRow(cipher, tenantId, table, r)));
        if (page.length < PAGE) break;
        after = String(page[page.length - 1].id);
      }
    } else {
      // Small per-clinic tables (packages, counters, settings): read in one go, ordered by their key.
      let q = loose(db).selectFrom(table).selectAll().where("tenant_id", "=", tenantId);
      for (const k of keys) q = q.orderBy(k);
      const page = await q.limit(10_000).execute();
      rows.push(...page.map((r) => decryptRow(cipher, tenantId, table, r)));
    }
    if (rows.length) out[table] = rows;
  }
  return out;
}

/**
 * DELETE statements for the clinic's clinic-system rows, children first (send them in the offboarding batch).
 * `keep`: tables left alone (the local demo seed's --fresh keeps the packages and the demo flag).
 * `only`: just these tables (offboarding: the tables that hold the clinic's rows – one statement per table counts
 * against the gateway's GATEWAY_MAX_STATEMENTS, and a table that does not exist yet must not be named).
 */
export function deletePmsQueries(
  db: Kysely<Database>,
  tenantId: string,
  options: { keep?: readonly string[]; only?: readonly string[] } = {},
): BatchQuery[] {
  const keep = new Set(options.keep ?? []);
  const only = options.only ? new Set(options.only) : null;
  return PMS_TENANT_TABLES.slice()
    .reverse()
    .filter((table) => !keep.has(table) && (!only || only.has(table)))
    .map((table) => loose(db).deleteFrom(table).where("tenant_id", "=", tenantId));
}
