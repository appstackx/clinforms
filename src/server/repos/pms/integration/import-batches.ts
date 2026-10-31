/**
 * `pms_import_batches` + `pms_import_rows` – data import from an earlier system, one CSV file per batch.
 *
 * - Rows are staged ENCRYPTED (data_enc: the JSON of the row's cells, AAD "<tenant>:pms_import_rows.data_enc:<row id>")
 *   and wiped as soon as they are no longer needed: when a row is imported, or the batch is cancelled or closed.
 * - Issues are stored as codes and field keys only; source_ref (the earlier system's reference – an id) is plain so
 *   duplicates can be found in SQL.
 * - Every state change is a conditional UPDATE on the status (and revision) it expects, so two people (or two tabs)
 *   can never move a batch twice; the long steps (check, import, undo) take a short lease on the batch while they
 *   work on a page of rows, so only one worker runs at a time and a crashed one is replaced after the lease.
 * - Every write is audited (one row per call; ids and counts only).
 * - Reading the clinic's existing references (patients and cases imported earlier) reads the shared record's
 *   import_ref columns directly – read-only, tenant-scoped, ids only.
 */
import { sql, type Selectable } from "kysely";
import { auditInsertWhenExists } from "../../../repos/audit";
import { INTEGRATION_ID_PREFIXES as P } from "../../../../modules/pms/integration/ids";
import type { CsvDelimiter } from "../../../../modules/pms/integration/csv";
import {
  isImportKind,
  type ImportKind,
} from "../../../../modules/pms/integration/import-kinds";
import {
  cleanCounts,
  isBatchStatus,
  isRowStatus,
  type BatchCounts,
  type BatchStatus,
  type RowStatus,
} from "../../../../modules/pms/integration/import-status";
import {
  cleanIssues,
  type RowIssue,
} from "../../../../modules/pms/integration/issues";
import {
  cleanMapping,
  type ImportMapping,
} from "../../../../modules/pms/integration/mapping";
import {
  ImportBatchInputSchema,
  ImportRowsPartSchema,
  MAX_IMPORT_ROW_BYTES,
  type ImportBatchInput,
  type ImportRowsPart,
} from "../../../../modules/pms/integration/schemas";
import type { PmsActor } from "../../../../modules/pms/core/types";
import type { LookupReferrer } from "../../../../modules/pms/integration/resolve";
import type { ReferrerKind } from "../../../../modules/pms/core/types";
import { runBatch, type BatchQuery } from "../../../db/batch";
import type {
  PmsImportBatchesTable,
  PmsImportRowsTable,
} from "../../../db/pms-schema/integration";
import {
  RepoInputError,
  assertActor,
  assertId,
  assertTenantId,
  decryptField,
  encryptField,
  nowIso,
  num,
  parseInput,
  pmsAuditQuery,
  type PmsAuditEntry,
  pmsId,
  writeWithAudit,
  type RepoContext,
} from "../context";

const B = "pms_import_batches";
const R = "pms_import_rows";
/** Rows per multi-row INSERT (8 values each: D1 allows 100 parameters per statement). */
const ROWS_PER_INSERT = 12;
/** Statements per batch (the gateway allows 100). */
const STATEMENTS_PER_BATCH = 90;
/** All rows of one upload part together (encrypted they grow by about a third). */
const MAX_PART_BYTES = 3 * 1024 * 1024;

type BatchRow = Selectable<PmsImportBatchesTable>;
type RowRow = Selectable<PmsImportRowsTable>;

export interface ImportBatchSummary {
  tenantId: string;
  id: string;
  rev: number;
  kind: ImportKind;
  status: BatchStatus;
  columnCount: number;
  expectedRows: number;
  rowCount: number;
  counts: BatchCounts;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  checkedAt: string | null;
  importedAt: string | null;
  undoneAt: string | null;
  cancelledAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportBatch extends ImportBatchSummary {
  /** Decrypted. */
  fileName: string | null;
  fileSha256: string | null;
  delimiter: CsvDelimiter;
  /** Decrypted column names. */
  headers: string[];
  mapping: ImportMapping | null;
  /** Referrers and payers the import added to the directory. */
  directoryAdded: string[];
  checkedBy: string | null;
  importedBy: string | null;
  undoneBy: string | null;
  cancelledBy: string | null;
  leaseUntil: string | null;
}

export interface ImportRow {
  tenantId: string;
  id: string;
  batchId: string;
  rowNo: number;
  /** Decrypted cells; null once wiped. */
  cells: string[] | null;
  sourceRef: string | null;
  status: RowStatus;
  issues: RowIssue[];
  patientId: string | null;
  caseId: string | null;
  targetId: string | null;
  targetRev: number | null;
  extra: Record<string, string> | null;
}

const toDelimiter = (d: string): CsvDelimiter =>
  d === "tab" ? "\t" : d === ";" ? ";" : ",";
const fromDelimiter = (d: CsvDelimiter): string => (d === "\t" ? "tab" : d);

function parseJsonSafe(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function kindOf(v: string): ImportKind {
  if (!isImportKind(v))
    throw new Error(`Unknown import kind "${v}" in the database.`);
  return v;
}

function statusOf(v: string): BatchStatus {
  if (!isBatchStatus(v))
    throw new Error(`Unknown import status "${v}" in the database.`);
  return v;
}

function toSummary(r: BatchRow): ImportBatchSummary {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    rev: num(r.rev),
    kind: kindOf(r.kind),
    status: statusOf(r.status),
    columnCount: num(r.column_count),
    expectedRows: num(r.expected_rows),
    rowCount: num(r.row_count),
    counts: cleanCounts(parseJsonSafe(r.counts_json)),
    createdBy: r.created_by,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    checkedAt: r.checked_at,
    importedAt: r.imported_at,
    undoneAt: r.undone_at,
    cancelledAt: r.cancelled_at,
    closedAt: r.closed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toBatch(ctx: RepoContext, r: BatchRow): ImportBatch {
  const headersText = decryptField(
    ctx,
    r.tenant_id,
    B,
    "headers_enc",
    r.id,
    r.headers_enc,
  );
  const headers =
    (parseJsonSafe(headersText) as unknown[] | null)?.map(String) ?? [];
  const added = parseJsonSafe(r.directory_added_json);
  return {
    ...toSummary(r),
    fileName: decryptField(
      ctx,
      r.tenant_id,
      B,
      "file_name_enc",
      r.id,
      r.file_name_enc,
    ),
    fileSha256: r.file_sha256,
    delimiter: toDelimiter(r.delimiter),
    headers,
    mapping: r.mapping_json
      ? cleanMapping(
          kindOf(r.kind),
          parseJsonSafe(r.mapping_json),
          num(r.column_count),
        )
      : null,
    directoryAdded: Array.isArray(added)
      ? added.filter((x): x is string => typeof x === "string")
      : [],
    checkedBy: r.checked_by,
    importedBy: r.imported_by,
    undoneBy: r.undone_by,
    cancelledBy: r.cancelled_by,
    leaseUntil: r.lease_until,
  };
}

function toRow(ctx: RepoContext, r: RowRow): ImportRow {
  const text = r.data_enc
    ? decryptField(ctx, r.tenant_id, R, "data_enc", r.id, r.data_enc)
    : null;
  const cells = text
    ? ((parseJsonSafe(text) as unknown[] | null)?.map((c) =>
        typeof c === "string" ? c : String(c ?? ""),
      ) ?? null)
    : null;
  const extra = parseJsonSafe(r.extra_json);
  return {
    tenantId: r.tenant_id,
    id: r.id,
    batchId: r.batch_id,
    rowNo: num(r.row_no),
    cells,
    sourceRef: r.source_ref,
    status: isRowStatus(r.status) ? r.status : "staged",
    issues: cleanIssues(parseJsonSafe(r.issues_json)),
    patientId: r.patient_id,
    caseId: r.case_id,
    targetId: r.target_id,
    targetRev: r.target_rev === null ? null : num(r.target_rev),
    extra:
      extra && typeof extra === "object" && !Array.isArray(extra)
        ? (extra as Record<string, string>)
        : null,
  };
}

/**
 * The audit row of a batch's state change, written in the SAME batch as the change and only when it happened: the
 * change moves the batch to revision `rev` (and `status`), and the audit INSERT runs only when a row of this batch
 * with exactly that revision and status exists as the batch runs.
 */
function batchAuditWhen(
  ctx: RepoContext,
  tenantId: string,
  batchId: string,
  rev: number,
  status: BatchStatus,
  actor: PmsActor,
  entry: PmsAuditEntry,
): BatchQuery {
  const who = assertActor(actor);
  const when = ctx.db
    .selectFrom(B)
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("id", "=", batchId)
    .where("rev", "=", rev)
    .where("status", "=", status);
  return auditInsertWhenExists(
    ctx,
    tenantId,
    { ...entry, userId: who.userId, sessionId: who.sessionId },
    when,
  ).query;
}

/** The batch's revision and status now (a transition reads it, then changes it only if it is still the same). */
async function currentRev(
  ctx: RepoContext,
  tenantId: string,
  batchId: string,
): Promise<{ rev: number; status: BatchStatus } | null> {
  const row = await ctx.db
    .selectFrom(B)
    .select(["rev", "status"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", batchId)
    .executeTakeFirst();
  return row ? { rev: num(row.rev), status: statusOf(row.status) } : null;
}

function changed(results: readonly unknown[], index = 0): boolean {
  const r = results[index] as
    { numAffectedRows?: bigint; numUpdatedRows?: bigint } | undefined;
  return Number(r?.numAffectedRows ?? r?.numUpdatedRows ?? 0) > 0;
}

/* ------------------------------------------------------------------------------------------------
 * Creating a batch and uploading its rows
 * ----------------------------------------------------------------------------------------------*/

export async function createImportBatch(
  ctx: RepoContext,
  tenantId: string,
  input: ImportBatchInput,
  actor: PmsActor,
): Promise<ImportBatch> {
  assertTenantId(tenantId);
  const d = parseInput(ImportBatchInputSchema, input, "Import");
  const id = pmsId(P.importBatch, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(ctx, [
    ctx.db.insertInto(B).values({
      tenant_id: tenantId,
      id,
      rev: 1,
      kind: d.kind,
      status: "uploading",
      file_name_enc: encryptField(
        ctx,
        tenantId,
        B,
        "file_name_enc",
        id,
        d.fileName,
      ),
      file_sha256: d.fileSha256 ?? null,
      delimiter: fromDelimiter(d.delimiter),
      headers_enc: encryptField(
        ctx,
        tenantId,
        B,
        "headers_enc",
        id,
        JSON.stringify(d.headers),
      ),
      column_count: d.headers.length,
      expected_rows: d.expectedRows,
      row_count: 0,
      mapping_json: null,
      counts_json: null,
      lease_until: null,
      directory_added_json: null,
      created_by: actor.userId,
      created_at: at,
      updated_at: at,
    }),
    pmsAuditQuery(ctx, tenantId, actor, {
      action: "pms.import_batch.create",
      targetType: "pms_import_batch",
      targetId: id,
      detail: { kind: d.kind, rows: d.expectedRows, columns: d.headers.length },
    }),
  ]);
  return (await getImportBatch(ctx, tenantId, id)) as ImportBatch;
}

/**
 * Adds the next part of the file's rows (in order). Sending a part again that is already stored is harmless (the
 * same row count comes back); a gap or an overlap is refused.
 */
export async function appendImportRows(
  ctx: RepoContext,
  tenantId: string,
  batchId: string,
  part: ImportRowsPart,
  actor: PmsActor,
): Promise<{ rowCount: number }> {
  assertTenantId(tenantId);
  assertId(batchId, "import id");
  const d = parseInput(ImportRowsPartSchema, part, "Import rows");
  const batch = await ctx.db
    .selectFrom(B)
    .select(["status", "row_count", "expected_rows", "column_count"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", batchId)
    .executeTakeFirst();
  if (!batch)
    throw new RepoInputError("That import does not exist in this clinic.");
  if (batch.status !== "uploading")
    throw new RepoInputError("This import is no longer taking rows.");
  const have = num(batch.row_count);
  const last = d.firstRowNo + d.rows.length - 1;
  if (d.firstRowNo <= have) {
    if (last <= have) return { rowCount: have };
    throw new RepoInputError(
      "These rows overlap rows already uploaded. Start the upload again.",
    );
  }
  if (d.firstRowNo !== have + 1)
    throw new RepoInputError(
      `Rows must be sent in order: the next row is ${have + 1}.`,
    );
  if (last > num(batch.expected_rows))
    throw new RepoInputError("More rows were sent than the file has.");
  const columns = num(batch.column_count);
  const at = nowIso(ctx);
  let bytes = 0;
  const values = d.rows.map((cells, i) => {
    if (cells.length !== columns)
      throw new RepoInputError(
        `Row ${d.firstRowNo + i} has ${cells.length} values, the file has ${columns} columns.`,
      );
    const json = JSON.stringify(cells);
    const size = Buffer.byteLength(json, "utf8");
    if (size > MAX_IMPORT_ROW_BYTES)
      throw new RepoInputError(
        `Row ${d.firstRowNo + i} is too long to import (over 64 KB).`,
      );
    bytes += size;
    const id = pmsId(P.importRow, ctx);
    return {
      tenant_id: tenantId,
      id,
      batch_id: batchId,
      row_no: d.firstRowNo + i,
      data_enc: encryptField(ctx, tenantId, R, "data_enc", id, json),
      status: "staged",
      created_at: at,
      updated_at: at,
    };
  });
  if (bytes > MAX_PART_BYTES)
    throw new RepoInputError(
      "This part of the file is too large. Send fewer rows at a time.",
    );
  const queries: BatchQuery[] = [];
  for (let i = 0; i < values.length; i += ROWS_PER_INSERT)
    queries.push(
      ctx.db.insertInto(R).values(values.slice(i, i + ROWS_PER_INSERT)),
    );
  queries.push(
    ctx.db
      .updateTable(B)
      .set({ row_count: have + values.length, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", batchId)
      .where("status", "=", "uploading")
      .where("row_count", "=", have),
  );
  queries.push(
    pmsAuditQuery(ctx, tenantId, actor, {
      action: "pms.import_batch.rows_add",
      targetType: "pms_import_batch",
      targetId: batchId,
      detail: { from: d.firstRowNo, count: values.length },
    }),
  );
  await writeWithAudit(ctx, queries, {
    unique: "These rows were already uploaded. Start the upload again.",
  });
  return { rowCount: have + values.length };
}

/** Every row is in: the batch moves to the mapping step with the suggested mapping (audited in the same batch). */
export async function finishImportUpload(
  ctx: RepoContext,
  tenantId: string,
  batchId: string,
  mapping: ImportMapping,
  actor: PmsActor,
): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(batchId, "import id");
  const cur = await currentRev(ctx, tenantId, batchId);
  if (!cur || cur.status !== "uploading") return false;
  const at = nowIso(ctx);
  const next = cur.rev + 1;
  const results = await runBatch(ctx.db, [
    ctx.db
      .updateTable(B)
      .set({
        status: "mapping",
        mapping_json: JSON.stringify(mapping),
        rev: next,
        updated_at: at,
      })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", batchId)
      .where("rev", "=", cur.rev)
      .where("status", "=", "uploading")
      .whereRef("row_count", "=", "expected_rows"),
    batchAuditWhen(ctx, tenantId, batchId, next, "mapping", actor, {
      action: "pms.import_batch.upload",
      targetType: "pms_import_batch",
      targetId: batchId,
    }),
  ]);
  return changed(results);
}

/* ------------------------------------------------------------------------------------------------
 * Reading
 * ----------------------------------------------------------------------------------------------*/

export async function getImportBatch(
  ctx: RepoContext,
  tenantId: string,
  id: string,
): Promise<ImportBatch | null> {
  assertTenantId(tenantId);
  const row = await ctx.db
    .selectFrom(B)
    .selectAll()
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .executeTakeFirst();
  return row ? toBatch(ctx, row) : null;
}

/** The clinic's imports, newest first (summaries – nothing decrypted). */
export async function listImportBatches(
  ctx: RepoContext,
  tenantId: string,
  options: { limit?: number; kind?: ImportKind } = {},
): Promise<ImportBatchSummary[]> {
  assertTenantId(tenantId);
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 50)), 200);
  let q = ctx.db.selectFrom(B).selectAll().where("tenant_id", "=", tenantId);
  if (options.kind) q = q.where("kind", "=", options.kind);
  const rows = await q
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(limit)
    .execute();
  return rows.map(toSummary);
}

/** How many rows of a batch are in each status (and how many ready rows carry warnings). */
export async function countImportRows(
  ctx: RepoContext,
  tenantId: string,
  batchId: string,
): Promise<{ byStatus: Record<RowStatus, number>; readyWithWarnings: number }> {
  assertTenantId(tenantId);
  const rows = await ctx.db
    .selectFrom(R)
    .select((eb) => ["status", eb.fn.countAll<number>().as("n")])
    .where("tenant_id", "=", tenantId)
    .where("batch_id", "=", batchId)
    .groupBy("status")
    .execute();
  const byStatus = {
    staged: 0,
    ready: 0,
    error: 0,
    duplicate: 0,
    imported: 0,
    skipped: 0,
    undone: 0,
    kept: 0,
  } as Record<RowStatus, number>;
  for (const r of rows)
    if (isRowStatus(r.status)) byStatus[r.status] = num(r.n);
  const warn = await ctx.db
    .selectFrom(R)
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("tenant_id", "=", tenantId)
    .where("batch_id", "=", batchId)
    .where("status", "in", ["ready", "imported"])
    .where("issues_json", "is not", null)
    .executeTakeFirst();
  return { byStatus, readyWithWarnings: num(warn?.n ?? 0) };
}

/** The batch's counts as stored in counts_json, from the rows (call when a step finishes). */
export async function computeBatchCounts(
  ctx: RepoContext,
  tenantId: string,
  batch: Pick<ImportBatchSummary, "id" | "rowCount">,
  directoryAdded = 0,
): Promise<BatchCounts> {
  const { byStatus, readyWithWarnings } = await countImportRows(
    ctx,
    tenantId,
    batch.id,
  );
  return {
    total: batch.rowCount,
    ready: byStatus.ready,
    warnings: readyWithWarnings,
    errors: byStatus.error,
    duplicates: byStatus.duplicate,
    imported: byStatus.imported,
    skipped: byStatus.skipped,
    undone: byStatus.undone,
    kept: byStatus.kept,
    directoryAdded,
  };
}

export interface ListRowsOptions {
  statuses?: readonly RowStatus[];
  /** Only rows with at least one issue. */
  withIssues?: boolean;
  rowNos?: readonly number[];
  afterRowNo?: number;
  /** Default 50, at most 500 (work pages) – review pages use 100. */
  limit?: number;
}

/**
 * Rows of ONE batch, decrypted, by row number. The import's own screens and steps only: the staff check must see
 * the values of the rows it is asked to check (members with the import permission – owners and administrators).
 */
export async function listImportRows(
  ctx: RepoContext,
  tenantId: string,
  batchId: string,
  options: ListRowsOptions = {},
): Promise<ImportRow[]> {
  assertTenantId(tenantId);
  assertId(batchId, "import id");
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 50)), 500);
  let q = ctx.db
    .selectFrom(R)
    .selectAll()
    .where("tenant_id", "=", tenantId)
    .where("batch_id", "=", batchId);
  if (options.statuses?.length)
    q = q.where("status", "in", options.statuses as RowStatus[]);
  if (options.withIssues) q = q.where("issues_json", "is not", null);
  if (options.rowNos) {
    if (options.rowNos.length === 0) return [];
    if (options.rowNos.length > 90)
      throw new RepoInputError("At most 90 row numbers at a time.");
    q = q.where("row_no", "in", options.rowNos as number[]);
  }
  if (options.afterRowNo !== undefined)
    q = q.where("row_no", ">", options.afterRowNo);
  const rows = await q.orderBy("row_no").limit(limit).execute();
  return rows.map((r) => toRow(ctx, r));
}

/** Row numbers of a batch's rows in a status (for the staff-check sample), ascending. */
export async function importRowNumbers(
  ctx: RepoContext,
  tenantId: string,
  batchId: string,
  status: RowStatus,
): Promise<number[]> {
  assertTenantId(tenantId);
  const rows = await ctx.db
    .selectFrom(R)
    .select("row_no")
    .where("tenant_id", "=", tenantId)
    .where("batch_id", "=", batchId)
    .where("status", "=", status)
    .orderBy("row_no")
    .limit(100_000)
    .execute();
  return rows.map((r) => num(r.row_no));
}

/** References (source_ref) that READY rows of the batch already carry before `beforeRowNo` (duplicates in the file). */
export async function readyRefsBefore(
  ctx: RepoContext,
  tenantId: string,
  batchId: string,
  refs: readonly string[],
  beforeRowNo: number,
): Promise<Set<string>> {
  assertTenantId(tenantId);
  const out = new Set<string>();
  const unique = Array.from(new Set(refs));
  for (let i = 0; i < unique.length; i += 90) {
    const rows = await ctx.db
      .selectFrom(R)
      .select("source_ref")
      .where("tenant_id", "=", tenantId)
      .where("batch_id", "=", batchId)
      .where("status", "=", "ready")
      .where("row_no", "<", beforeRowNo)
      .where("source_ref", "in", unique.slice(i, i + 90))
      .execute();
    for (const r of rows) if (r.source_ref) out.add(r.source_ref);
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * The clinic's existing references (read-only, ids only)
 * ----------------------------------------------------------------------------------------------*/

/** Patients by their import reference: ref → patient id. */
export async function patientIdsByImportRef(
  ctx: RepoContext,
  tenantId: string,
  refs: readonly string[],
): Promise<Map<string, string>> {
  assertTenantId(tenantId);
  const out = new Map<string, string>();
  const unique = Array.from(new Set(refs.filter(Boolean)));
  for (let i = 0; i < unique.length; i += 90) {
    const rows = await ctx.db
      .selectFrom("pms_patients")
      .select(["id", "import_ref"])
      .where("tenant_id", "=", tenantId)
      .where("import_ref", "in", unique.slice(i, i + 90))
      .execute();
    for (const r of rows) if (r.import_ref) out.set(r.import_ref, r.id);
  }
  return out;
}

/** Cases by their import reference: ref → case id and its patient. */
export async function caseIdsByImportRef(
  ctx: RepoContext,
  tenantId: string,
  refs: readonly string[],
): Promise<Map<string, { id: string; patientId: string }>> {
  assertTenantId(tenantId);
  const out = new Map<string, { id: string; patientId: string }>();
  const unique = Array.from(new Set(refs.filter(Boolean)));
  for (let i = 0; i < unique.length; i += 90) {
    const rows = await ctx.db
      .selectFrom("pms_cases")
      .select(["id", "patient_id", "import_ref"])
      .where("tenant_id", "=", tenantId)
      .where("import_ref", "in", unique.slice(i, i + 90))
      .execute();
    for (const r of rows)
      if (r.import_ref)
        out.set(r.import_ref, { id: r.id, patientId: r.patient_id });
  }
  return out;
}

/** The clinic's referrers and payers for matching names (active and inactive; id, name and kind only). */
export async function referrerLookups(
  ctx: RepoContext,
  tenantId: string,
): Promise<LookupReferrer[]> {
  assertTenantId(tenantId);
  const rows = await ctx.db
    .selectFrom("pms_referrers")
    .select(["id", "name", "kind", "active"])
    .where("tenant_id", "=", tenantId)
    .orderBy("active", "desc")
    .orderBy("name")
    .limit(20_000)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind as ReferrerKind,
  }));
}

/* ------------------------------------------------------------------------------------------------
 * Mapping, staff check, cancel, close
 * ----------------------------------------------------------------------------------------------*/

const REMAPPABLE: BatchStatus[] = ["mapping", "checked", "approved"];

/**
 * Saves the column mapping. A batch already checked (or checked by staff) goes back to the mapping step: its check
 * results and the staff check are cleared, so the rows are checked again with the new mapping.
 */
export async function setImportMapping(
  ctx: RepoContext,
  tenantId: string,
  batchId: string,
  expectedRev: number,
  mapping: ImportMapping,
  actor: PmsActor,
): Promise<
  | { ok: true; rev: number }
  | { ok: false; reason: "conflict" | "not_found" | "wrong_status" }
> {
  assertTenantId(tenantId);
  assertId(batchId, "import id");
  const current = await ctx.db
    .selectFrom(B)
    .select(["rev", "status", "kind", "column_count"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", batchId)
    .executeTakeFirst();
  if (!current) return { ok: false, reason: "not_found" };
  if (!REMAPPABLE.includes(current.status as BatchStatus))
    return { ok: false, reason: "wrong_status" };
  if (num(current.rev) !== expectedRev)
    return { ok: false, reason: "conflict" };
  const clean = cleanMapping(
    kindOf(current.kind),
    mapping,
    num(current.column_count),
  );
  const at = nowIso(ctx);
  const next = expectedRev + 1;
  const fields = Object.values(clean).filter((v) => v !== null).length;
  const results = await runBatch(ctx.db, [
    ctx.db
      .updateTable(B)
      .set({
        status: "mapping",
        mapping_json: JSON.stringify(clean),
        counts_json: null,
        checked_at: null,
        checked_by: null,
        approved_at: null,
        approved_by: null,
        lease_until: null,
        rev: next,
        updated_at: at,
      })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", batchId)
      .where("rev", "=", expectedRev)
      .where("status", "in", REMAPPABLE),
    // Only when the batch update above happened (same atomic batch): the check results go.
    ctx.db
      .updateTable(R)
      .set({
        status: "staged",
        issues_json: null,
        source_ref: null,
        patient_id: null,
        case_id: null,
        updated_at: at,
      })
      .where("tenant_id", "=", tenantId)
      .where("batch_id", "=", batchId)
      .where("status", "in", ["ready", "error", "duplicate"])
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom(B)
            .select("id")
            .where("tenant_id", "=", tenantId)
            .where("id", "=", batchId)
            .where("rev", "=", next)
            .where("status", "=", "mapping"),
        ),
      ),
    batchAuditWhen(ctx, tenantId, batchId, next, "mapping", actor, {
      action: "pms.import_batch.map",
      targetType: "pms_import_batch",
      targetId: batchId,
      detail: { fields, rev: next },
    }),
  ]);
  if (!changed(results)) return { ok: false, reason: "conflict" };
  return { ok: true, rev: next };
}

/** The staff check: a person has compared a sample of the rows with the earlier system (audited in the same batch). */
export async function approveImportBatch(
  ctx: RepoContext,
  tenantId: string,
  batchId: string,
  expectedRev: number,
  actor: PmsActor,
  detail: { sample: number; leftOut: number },
): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(batchId, "import id");
  const at = nowIso(ctx);
  const next = expectedRev + 1;
  const results = await runBatch(ctx.db, [
    ctx.db
      .updateTable(B)
      .set({
        status: "approved",
        approved_at: at,
        approved_by: actor.userId,
        rev: next,
        updated_at: at,
      })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", batchId)
      .where("rev", "=", expectedRev)
      .where("status", "=", "checked"),
    batchAuditWhen(ctx, tenantId, batchId, next, "approved", actor, {
      action: "pms.import_batch.approve",
      targetType: "pms_import_batch",
      targetId: batchId,
      detail: { sample: detail.sample, leftOut: detail.leftOut },
    }),
  ]);
  return changed(results);
}

const CANCELLABLE: BatchStatus[] = [
  "uploading",
  "mapping",
  "checking",
  "checked",
  "approved",
];

/** Stops an import before anything was imported: the uploaded rows are wiped (the batch is kept as a record). */
export async function cancelImportBatch(
  ctx: RepoContext,
  tenantId: string,
  batchId: string,
  actor: PmsActor,
): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(batchId, "import id");
  const cur = await currentRev(ctx, tenantId, batchId);
  if (!cur || !CANCELLABLE.includes(cur.status)) return false;
  const at = nowIso(ctx);
  const next = cur.rev + 1;
  const results = await runBatch(ctx.db, [
    ctx.db
      .updateTable(B)
      .set({
        status: "cancelled",
        cancelled_at: at,
        cancelled_by: actor.userId,
        lease_until: null,
        file_name_enc: null,
        headers_enc: null,
        rev: next,
        updated_at: at,
      })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", batchId)
      .where("rev", "=", cur.rev)
      .where("status", "in", CANCELLABLE),
    ctx.db
      .updateTable(R)
      .set({ data_enc: null, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("batch_id", "=", batchId)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom(B)
            .select("id")
            .where("tenant_id", "=", tenantId)
            .where("id", "=", batchId)
            .where("rev", "=", next)
            .where("status", "=", "cancelled"),
        ),
      ),
    batchAuditWhen(ctx, tenantId, batchId, next, "cancelled", actor, {
      action: "pms.import_batch.cancel",
      targetType: "pms_import_batch",
      targetId: batchId,
    }),
  ]);
  return changed(results);
}

/** Ends an import that is done (imported or undone): the rows that were not imported are wiped too. */
export async function closeImportBatch(
  ctx: RepoContext,
  tenantId: string,
  batchId: string,
  actor: PmsActor,
): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(batchId, "import id");
  const cur = await currentRev(ctx, tenantId, batchId);
  if (!cur || (cur.status !== "imported" && cur.status !== "undone"))
    return false;
  const at = nowIso(ctx);
  const next = cur.rev + 1;
  const results = await runBatch(ctx.db, [
    ctx.db
      .updateTable(B)
      .set({ closed_at: at, file_name_enc: null, rev: next, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", batchId)
      .where("rev", "=", cur.rev)
      .where("status", "in", ["imported", "undone"])
      .where("closed_at", "is", null),
    ctx.db
      .updateTable(R)
      .set({ data_enc: null, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("batch_id", "=", batchId)
      .where("data_enc", "is not", null)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom(B)
            .select("id")
            .where("tenant_id", "=", tenantId)
            .where("id", "=", batchId)
            .where("rev", "=", next)
            .where("closed_at", "is not", null),
        ),
      ),
    batchAuditWhen(ctx, tenantId, batchId, next, cur.status, actor, {
      action: "pms.import_batch.close",
      targetType: "pms_import_batch",
      targetId: batchId,
    }),
  ]);
  return changed(results);
}

/* ------------------------------------------------------------------------------------------------
 * Steps that work page by page (check, import, undo)
 * ----------------------------------------------------------------------------------------------*/

/** How long a worker holds a batch while it works on one page. */
export const STEP_LEASE_MS = 90_000;

/**
 * Takes the batch for one page of work: moves it from one of `from` to `to` and holds it for STEP_LEASE_MS.
 * Null when another worker holds it, or it is not in one of `from` (nothing changed).
 */
export async function claimImportStep(
  ctx: RepoContext,
  tenantId: string,
  batchId: string,
  from: readonly BatchStatus[],
  to: BatchStatus,
): Promise<ImportBatch | null> {
  assertTenantId(tenantId);
  assertId(batchId, "import id");
  const now = ctx.now ? ctx.now() : new Date();
  const at = now.toISOString();
  const until = new Date(now.getTime() + STEP_LEASE_MS).toISOString();
  const result = await ctx.db
    .updateTable(B)
    .set((eb) => ({
      status: to,
      lease_until: until,
      rev: eb("rev", "+", 1),
      updated_at: at,
    }))
    .where("tenant_id", "=", tenantId)
    .where("id", "=", batchId)
    .where("status", "in", from as BatchStatus[])
    .where((eb) =>
      eb.or([eb("lease_until", "is", null), eb("lease_until", "<", at)]),
    )
    // M10 L3: one import of a kind writes at a time – another batch of the same kind still importing holds it off
    // (an import adopts records it wrote in an interrupted call; overlapping imports could adopt each other's).
    .$if(to === "importing", (q) =>
      q.where((eb) =>
        eb.not(
          eb.exists(
            ctx.db
              .selectFrom(`${B} as other`)
              .select("other.id")
              .where("other.tenant_id", "=", tenantId)
              .where("other.id", "!=", batchId)
              .where("other.status", "=", "importing")
              .whereRef("other.kind", "=", `${B}.kind` as never),
          ),
        ),
      ),
    )
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) return null;
  return getImportBatch(ctx, tenantId, batchId);
}

/** Lets go of the batch after a page (the status stays: more pages may follow). */
export async function releaseImportStep(
  ctx: RepoContext,
  tenantId: string,
  batchId: string,
): Promise<void> {
  assertTenantId(tenantId);
  await ctx.db
    .updateTable(B)
    .set({ lease_until: null })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", batchId)
    .execute();
}

export type StepStamp = "checked" | "imported" | "undone";

/** Ends a step: the batch moves on, its counts are stored, who and when are recorded – and the audit row, in one batch. */
export async function finishImportStep(
  ctx: RepoContext,
  tenantId: string,
  batchId: string,
  step: {
    from: BatchStatus;
    to: BatchStatus;
    stamp: StepStamp;
    counts: BatchCounts;
    directoryAdded?: readonly string[];
    action:
      | "pms.import_batch.check"
      | "pms.import_batch.commit"
      | "pms.import_batch.undo";
  },
  actor: PmsActor,
): Promise<boolean> {
  assertTenantId(tenantId);
  const cur = await currentRev(ctx, tenantId, batchId);
  if (!cur || cur.status !== step.from) return false;
  const at = nowIso(ctx);
  const next = cur.rev + 1;
  const stamp: Record<string, string | null> =
    step.stamp === "checked"
      ? { checked_at: at, checked_by: actor.userId }
      : step.stamp === "imported"
        ? { imported_at: at, imported_by: actor.userId }
        : { undone_at: at, undone_by: actor.userId };
  const c = step.counts;
  const results = await runBatch(ctx.db, [
    ctx.db
      .updateTable(B)
      .set({
        status: step.to,
        counts_json: JSON.stringify(step.counts),
        lease_until: null,
        ...stamp,
        ...(step.directoryAdded
          ? { directory_added_json: JSON.stringify(step.directoryAdded) }
          : {}),
        rev: next,
        updated_at: at,
      })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", batchId)
      .where("rev", "=", cur.rev)
      .where("status", "=", step.from),
    batchAuditWhen(ctx, tenantId, batchId, next, step.to, actor, {
      action: step.action,
      targetType: "pms_import_batch",
      targetId: batchId,
      detail: {
        total: c.total,
        ready: c.ready,
        errors: c.errors,
        duplicates: c.duplicates,
        imported: c.imported,
        undone: c.undone,
        kept: c.kept,
        directoryAdded: c.directoryAdded,
      },
    }),
  ]);
  return changed(results);
}

/** Records the referrers and payers the import has added so far (undo makes them inactive). */
export async function recordDirectoryAdded(
  ctx: RepoContext,
  tenantId: string,
  batchId: string,
  ids: readonly string[],
): Promise<void> {
  assertTenantId(tenantId);
  await ctx.db
    .updateTable(B)
    .set({ directory_added_json: JSON.stringify(Array.from(new Set(ids))) })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", batchId)
    .execute();
}

export interface RowOutcome {
  id: string;
  status: RowStatus;
  issues?: readonly RowIssue[] | null;
  sourceRef?: string | null;
  patientId?: string | null;
  caseId?: string | null;
  targetId?: string | null;
  targetRev?: number | null;
  extra?: Record<string, string> | null;
  /** Wipe the row's uploaded values (it is imported – the record holds them now). */
  wipeData?: boolean;
}

/** Writes the outcome of a page of rows (batches of 90 updates; each is one row of this clinic's batch). */
export async function saveRowOutcomes(
  ctx: RepoContext,
  tenantId: string,
  batchId: string,
  outcomes: readonly RowOutcome[],
): Promise<void> {
  assertTenantId(tenantId);
  assertId(batchId, "import id");
  if (outcomes.length === 0) return;
  const at = nowIso(ctx);
  const queries = outcomes.map((o) => {
    const set: Record<string, unknown> = { status: o.status, updated_at: at };
    if (o.issues !== undefined)
      set.issues_json =
        o.issues && o.issues.length ? JSON.stringify(o.issues) : null;
    if (o.sourceRef !== undefined)
      set.source_ref = o.sourceRef ? o.sourceRef.slice(0, 80) : null;
    if (o.patientId !== undefined) set.patient_id = o.patientId;
    if (o.caseId !== undefined) set.case_id = o.caseId;
    if (o.targetId !== undefined) set.target_id = o.targetId;
    if (o.targetRev !== undefined) set.target_rev = o.targetRev;
    if (o.extra !== undefined)
      set.extra_json = o.extra ? JSON.stringify(o.extra) : null;
    if (o.wipeData) set.data_enc = null;
    return ctx.db
      .updateTable(R)
      .set(set)
      .where("tenant_id", "=", tenantId)
      .where("batch_id", "=", batchId)
      .where("id", "=", o.id);
  });
  for (let i = 0; i < queries.length; i += STATEMENTS_PER_BATCH)
    await runBatch(ctx.db, queries.slice(i, i + STATEMENTS_PER_BATCH));
}

/**
 * Imported rows of OTHER batches that depend on what this batch imported (rows linked to its patients or cases).
 * A batch can only be undone once those are undone (cases before their patients).
 */
export async function countDependentImportedRows(
  ctx: RepoContext,
  tenantId: string,
  batchId: string,
  kind: ImportKind,
): Promise<number> {
  assertTenantId(tenantId);
  if (kind !== "patients" && kind !== "cases") return 0;
  const link = kind === "patients" ? "patient_id" : "case_id";
  const row = await sql<{ n: number | string }>`
    select count(*) as n from pms_import_rows r
    where r.tenant_id = ${tenantId} and r.batch_id <> ${batchId} and r.status = 'imported'
      and r.${sql.ref(link)} in (
        select t.target_id from pms_import_rows t where t.tenant_id = ${tenantId} and t.batch_id = ${batchId} and t.status = 'imported' and t.target_id is not null
      )`.execute(ctx.db);
  return num(row.rows[0]?.n ?? 0);
}

/** Case ids among `caseIds` that an import made and has since undone (they do not keep a patient "in use"). */
export async function undoneImportedCaseIds(
  ctx: RepoContext,
  tenantId: string,
  caseIds: readonly string[],
): Promise<Set<string>> {
  assertTenantId(tenantId);
  const out = new Set<string>();
  const unique = Array.from(new Set(caseIds));
  for (let i = 0; i < unique.length; i += 90) {
    const rows = await ctx.db
      .selectFrom(R)
      .select("target_id")
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "undone")
      .where("target_id", "in", unique.slice(i, i + 90))
      .execute();
    for (const r of rows) if (r.target_id) out.add(r.target_id);
  }
  return out;
}

/** Cases of the given patients (id and patient), for the undo's "still in use" check. */
export async function casesOfPatients(
  ctx: RepoContext,
  tenantId: string,
  patientIds: readonly string[],
): Promise<{ id: string; patientId: string }[]> {
  assertTenantId(tenantId);
  const out: { id: string; patientId: string }[] = [];
  const unique = Array.from(new Set(patientIds));
  for (let i = 0; i < unique.length; i += 90) {
    const rows = await ctx.db
      .selectFrom("pms_cases")
      .select(["id", "patient_id"])
      .where("tenant_id", "=", tenantId)
      .where("patient_id", "in", unique.slice(i, i + 90))
      .execute();
    for (const r of rows) out.push({ id: r.id, patientId: r.patient_id });
  }
  return out;
}

/**
 * Records made by an import step that ended before it could note them (a crash between the write and the note):
 * of `ids`, those created at or after `since` that no import row points at yet → their revision. The import adopts
 * them instead of skipping them as "already in the clinic".
 */
export async function unlinkedRecordsSince(
  ctx: RepoContext,
  tenantId: string,
  table: "pms_patients" | "pms_cases",
  ids: readonly string[],
  since: string,
): Promise<Map<string, number>> {
  assertTenantId(tenantId);
  const out = new Map<string, number>();
  const unique = Array.from(new Set(ids));
  for (let i = 0; i < unique.length; i += 90) {
    const part = unique.slice(i, i + 90);
    const [records, linked] = await Promise.all([
      ctx.db
        .selectFrom(table)
        .select(["id", "rev", "created_at"])
        .where("tenant_id", "=", tenantId)
        .where("id", "in", part)
        .where("created_at", ">=", since)
        .execute(),
      ctx.db
        .selectFrom(R)
        .select("target_id")
        .where("tenant_id", "=", tenantId)
        .where("target_id", "in", part)
        .execute(),
    ]);
    const taken = new Set(linked.map((l) => l.target_id));
    for (const r of records) if (!taken.has(r.id)) out.set(r.id, num(r.rev));
  }
  return out;
}
