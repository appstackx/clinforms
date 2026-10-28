/**
 * The import screens' server layer (K2-IMP-001…006, design round 2c "Import from previous system"): what the
 * /app/clinic/import pages and their server actions call. Every function checks `settings.import` FIRST (owners and
 * administrators by default – never reception), reads the batch from the member's OWN clinic only, validates the
 * input and answers a Result with a plain message (no values from the file, no database message).
 *
 *   upload    startImportFor → addRowsFor (parts of ≤ 1,000 rows, in order) → finishUploadFor (suggested columns)
 *   map       importViewFor (columns, one example row, the field choices) → saveMappingFor
 *   check     checkStepFor (one page per call; the page calls again until done – nothing is written to the records)
 *   import    approveFor (the person confirms they looked at the issues) → importStepFor (page by page)
 *   undo      undoStepFor (page by page; only what this import made and nothing changed or used since; 7 days)
 *
 * The file is parsed in the browser (src/modules/pms/integration/csv.ts) and sent as cells; the server stores the rows
 * encrypted until they are imported (then wiped). Large files never need one long request.
 */
import "server-only";
import { IMPORT_KIND_INFO, isImportKind, templateHeaders, type ImportKind } from "../../../modules/pms/integration/import-kinds";
import { issueMessage, type RowIssue } from "../../../modules/pms/integration/issues";
import { canDo, undoUntil, type BatchCounts, type BatchStatus, type RowStatus } from "../../../modules/pms/integration/import-status";
import { cleanMapping, suggestMapping, validateMapping, type ImportMapping } from "../../../modules/pms/integration/mapping";
import { toCsv, type CsvDelimiter } from "../../../modules/pms/integration/csv";
import { isPlausibleRecordId } from "../../../modules/pms/records/form-values";
import { logAuthEvent } from "../../email/log";
import { RepoInputError } from "../../repos/context";
import {
  appendImportRows,
  approveImportBatch,
  cancelImportBatch,
  countImportRows,
  createImportBatch,
  finishImportUpload,
  getImportBatch,
  listImportBatches,
  listImportRows,
  setImportMapping,
  type ImportBatch,
} from "../../repos/pms/integration/import-batches";
import type { ClinicActor } from "../actor";
import { runCheckPage, runImportPage, runUndoPage, undoBlocker, type StepProgress } from "./importer";
import { importTargetAvailable, importTargetMissingMessage } from "./ports";
import { integrationPorts } from "./wiring";

export type ImportActor = Pick<ClinicActor, "tenantId" | "userId" | "can" | "actor" | "repo">;

export type Result<T> = { ok: true; value: T } | { ok: false; code: "forbidden" | "not_found" | "invalid" | "conflict" | "error"; error: string };

const FORBIDDEN = "You do not have permission to import data.";
const NOT_FOUND = "That import does not exist in this clinic.";

function fail<T>(code: "forbidden" | "not_found" | "invalid" | "conflict" | "error", error: string): Result<T> {
  return { ok: false, code, error };
}

async function attempt<T>(what: string, work: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof RepoInputError) return fail("invalid", err.message);
    logAuthEvent("pms_import_failed", { step: what, error: err instanceof Error ? err.name : "error" });
    return fail("error", "Something went wrong. Please try again.");
  }
}

async function batchOf(actor: ImportActor, batchId: unknown): Promise<ImportBatch | null> {
  if (typeof batchId !== "string" || !isPlausibleRecordId(batchId)) return null;
  return getImportBatch(actor.repo(), actor.tenantId, batchId);
}

/* ------------------------------------------------------------------------------------------------
 * Lists and views
 * ----------------------------------------------------------------------------------------------*/

export interface ImportListRow {
  id: string;
  kind: ImportKind;
  kindLabel: string;
  status: BatchStatus;
  rows: number;
  counts: BatchCounts;
  createdAt: string;
  importedAt: string | null;
  undoneAt: string | null;
}

export async function listImportsFor(actor: ImportActor): Promise<Result<ImportListRow[]>> {
  if (!actor.can("settings.import")) return fail("forbidden", FORBIDDEN);
  const rows = await listImportBatches(actor.repo(), actor.tenantId, { limit: 50 });
  return {
    ok: true,
    value: rows.map((b) => ({
      id: b.id,
      kind: b.kind,
      kindLabel: IMPORT_KIND_INFO[b.kind].label,
      status: b.status,
      rows: b.rowCount,
      counts: b.counts,
      createdAt: b.createdAt,
      importedAt: b.importedAt,
      undoneAt: b.undoneAt,
    })),
  };
}

export interface ImportFieldChoice {
  key: string;
  label: string;
  required: boolean;
  group: string | null;
  hint: string | null;
}

export interface ImportIssueRow {
  rowNo: number;
  status: RowStatus;
  severity: "error" | "warning";
  messages: string[];
}

export interface ImportView {
  id: string;
  rev: number;
  kind: ImportKind;
  kindLabel: string;
  noun: string;
  status: BatchStatus;
  fileName: string | null;
  rowCount: number;
  headers: string[];
  /** The first row's values (the member's own file), for the mapping step's "Example" column; null once wiped. */
  example: string[] | null;
  mapping: ImportMapping | null;
  /** Field key → a problem with the mapping, if any. */
  mappingProblems: string[];
  fields: ImportFieldChoice[];
  counts: BatchCounts;
  /** Live while checking / importing / undoing. */
  remaining: { staged: number; ready: number; imported: number };
  importedAt: string | null;
  undoneAt: string | null;
  /** Until when the import can be undone (imported only), and why not (null: it can). */
  undoUntil: string | null;
  undoBlocked: string | null;
  /** The kind can be checked but not run here (invoices). */
  runUnavailable: string | null;
}

export async function importViewFor(actor: ImportActor, batchId: unknown): Promise<Result<ImportView>> {
  if (!actor.can("settings.import")) return fail("forbidden", FORBIDDEN);
  return attempt("view", async () => {
    const b = await batchOf(actor, batchId);
    if (!b) return fail("not_found", NOT_FOUND);
    const ctx = actor.repo();
    const [first, counts] = await Promise.all([
      b.status === "mapping" || b.status === "checked" || b.status === "approved" ? listImportRows(ctx, actor.tenantId, b.id, { limit: 1 }) : Promise.resolve([]),
      countImportRows(ctx, actor.tenantId, b.id),
    ]);
    const info = IMPORT_KIND_INFO[b.kind];
    const blocked = b.status === "imported" ? await undoBlocker(ctx, actor.tenantId, b) : null;
    return {
      ok: true,
      value: {
        id: b.id,
        rev: b.rev,
        kind: b.kind,
        kindLabel: info.label,
        noun: info.noun,
        status: b.status,
        fileName: b.fileName,
        rowCount: b.rowCount,
        headers: b.headers,
        example: first[0]?.cells ?? null,
        mapping: b.mapping,
        mappingProblems: b.mapping ? validateMapping(b.kind, b.mapping).map((p) => p.message) : [],
        fields: info.fields.map((f) => ({ key: f.key, label: f.label, required: Boolean(f.required), group: f.requiredGroup ?? null, hint: f.hint ?? null })),
        counts: b.counts,
        remaining: { staged: counts.byStatus.staged, ready: counts.byStatus.ready, imported: counts.byStatus.imported },
        importedAt: b.importedAt,
        undoneAt: b.undoneAt,
        undoUntil: b.importedAt ? undoUntil(b.importedAt) : null,
        undoBlocked: blocked,
        runUnavailable: (b.kind === "appointments" || b.kind === "invoices") && !importTargetAvailable(b.kind, integrationPorts()) ? importTargetMissingMessage(b.kind) : null,
      },
    };
  });
}

/** Rows with issues (errors first in each page is not needed – by row number), 100 at a time after `afterRowNo`. No values. */
export async function importIssuesFor(actor: ImportActor, batchId: unknown, afterRowNo = 0): Promise<Result<{ rows: ImportIssueRow[]; more: boolean }>> {
  if (!actor.can("settings.import")) return fail("forbidden", FORBIDDEN);
  return attempt("issues", async () => {
    const b = await batchOf(actor, batchId);
    if (!b) return fail("not_found", NOT_FOUND);
    const rows = await listImportRows(actor.repo(), actor.tenantId, b.id, { withIssues: true, afterRowNo: Math.max(0, Math.floor(afterRowNo)), limit: 101 });
    const out = rows.slice(0, 100).map((r) => {
      const issues: RowIssue[] = r.issues;
      return {
        rowNo: r.rowNo,
        status: r.status,
        severity: issues.some((i) => i.severity === "error") || r.status === "error" ? ("error" as const) : ("warning" as const),
        messages: issues.map((i) => issueMessage(b.kind, i)),
      };
    });
    return { ok: true, value: { rows: out, more: rows.length > 100 } };
  });
}

/* ------------------------------------------------------------------------------------------------
 * Upload
 * ----------------------------------------------------------------------------------------------*/

export interface StartImportInput {
  kind: string;
  fileName: string | null;
  fileSha256: string | null;
  delimiter: CsvDelimiter;
  headers: string[];
  expectedRows: number;
}

export async function startImportFor(actor: ImportActor, input: StartImportInput): Promise<Result<{ id: string }>> {
  if (!actor.can("settings.import")) return fail("forbidden", FORBIDDEN);
  if (!isImportKind(input?.kind)) return fail("invalid", "Choose what you are importing.");
  return attempt("start", async () => {
    const b = await createImportBatch(
      actor.repo(),
      actor.tenantId,
      { kind: input.kind as ImportKind, fileName: input.fileName, fileSha256: input.fileSha256, delimiter: input.delimiter, headers: input.headers, expectedRows: input.expectedRows },
      actor.actor,
    );
    return { ok: true, value: { id: b.id } };
  });
}

export async function addRowsFor(actor: ImportActor, batchId: unknown, part: { firstRowNo: number; rows: string[][] }): Promise<Result<{ rowCount: number }>> {
  if (!actor.can("settings.import")) return fail("forbidden", FORBIDDEN);
  return attempt("rows", async () => {
    const b = await batchOf(actor, batchId);
    if (!b) return fail("not_found", NOT_FOUND);
    const r = await appendImportRows(actor.repo(), actor.tenantId, b.id, part, actor.actor);
    return { ok: true, value: r };
  });
}

export async function finishUploadFor(actor: ImportActor, batchId: unknown): Promise<Result<{ status: BatchStatus }>> {
  if (!actor.can("settings.import")) return fail("forbidden", FORBIDDEN);
  return attempt("finish", async () => {
    const b = await batchOf(actor, batchId);
    if (!b) return fail("not_found", NOT_FOUND);
    if (b.status !== "uploading") return { ok: true, value: { status: b.status } };
    if (b.rowCount !== b.expectedRows) return fail("invalid", `Only ${b.rowCount.toLocaleString("en-GB")} of ${b.expectedRows.toLocaleString("en-GB")} rows arrived. Start the upload again.`);
    const changed = await finishImportUpload(actor.repo(), actor.tenantId, b.id, suggestMapping(b.kind, b.headers), actor.actor);
    return changed ? { ok: true, value: { status: "mapping" } } : fail("conflict", "This import changed in another tab. Reload the page.");
  });
}

/* ------------------------------------------------------------------------------------------------
 * Mapping, check, import, undo
 * ----------------------------------------------------------------------------------------------*/

export async function saveMappingFor(actor: ImportActor, batchId: unknown, expectedRev: number, mapping: unknown): Promise<Result<{ rev: number }>> {
  if (!actor.can("settings.import")) return fail("forbidden", FORBIDDEN);
  return attempt("map", async () => {
    const b = await batchOf(actor, batchId);
    if (!b) return fail("not_found", NOT_FOUND);
    if (!canDo(b.status, "map")) return fail("invalid", "The columns can no longer be changed for this import.");
    const clean = cleanMapping(b.kind, mapping, b.headers.length);
    const problems = validateMapping(b.kind, clean);
    if (problems.length) return fail("invalid", problems[0].message);
    const r = await setImportMapping(actor.repo(), actor.tenantId, b.id, expectedRev, clean, actor.actor);
    if (!r.ok) return fail(r.reason === "not_found" ? "not_found" : "conflict", r.reason === "wrong_status" ? "The columns can no longer be changed for this import." : "This import changed in another tab. Reload the page.");
    return { ok: true, value: { rev: r.rev } };
  });
}

export async function checkStepFor(actor: ImportActor, batchId: unknown): Promise<Result<StepProgress>> {
  if (!actor.can("settings.import")) return fail("forbidden", FORBIDDEN);
  return attempt("check", async () => {
    const b = await batchOf(actor, batchId);
    if (!b) return fail("not_found", NOT_FOUND);
    return { ok: true, value: await runCheckPage(actor.repo(), actor.tenantId, b.id, actor.actor, integrationPorts()) };
  });
}

/** "Import N patients": the person confirms they looked at the issues; the batch may then run. */
export async function approveFor(actor: ImportActor, batchId: unknown, expectedRev: number, confirmed: boolean): Promise<Result<{ ok: true }>> {
  if (!actor.can("settings.import")) return fail("forbidden", FORBIDDEN);
  if (confirmed !== true) return fail("invalid", "Tick that you have looked at the issues first.");
  return attempt("approve", async () => {
    const b = await batchOf(actor, batchId);
    if (!b) return fail("not_found", NOT_FOUND);
    if (b.status === "approved" || b.status === "importing") return { ok: true, value: { ok: true } };
    if (b.counts.ready === 0) return fail("invalid", "There is nothing ready to import in this file.");
    if ((b.kind === "appointments" || b.kind === "invoices") && !importTargetAvailable(b.kind, integrationPorts())) return fail("invalid", importTargetMissingMessage(b.kind));
    const changed = await approveImportBatch(actor.repo(), actor.tenantId, b.id, expectedRev, actor.actor, { sample: 0, leftOut: b.counts.errors + b.counts.duplicates });
    return changed ? { ok: true, value: { ok: true } } : fail("conflict", "This import changed in another tab. Reload the page.");
  });
}

export async function importStepFor(actor: ImportActor, batchId: unknown): Promise<Result<StepProgress>> {
  if (!actor.can("settings.import")) return fail("forbidden", FORBIDDEN);
  return attempt("import", async () => {
    const b = await batchOf(actor, batchId);
    if (!b) return fail("not_found", NOT_FOUND);
    return { ok: true, value: await runImportPage(actor.repo(), actor.tenantId, b.id, actor.actor, integrationPorts()) };
  });
}

export async function undoStepFor(actor: ImportActor, batchId: unknown): Promise<Result<StepProgress>> {
  if (!actor.can("settings.import")) return fail("forbidden", FORBIDDEN);
  return attempt("undo", async () => {
    const b = await batchOf(actor, batchId);
    if (!b) return fail("not_found", NOT_FOUND);
    return { ok: true, value: await runUndoPage(actor.repo(), actor.tenantId, b.id, actor.actor, integrationPorts()) };
  });
}

export async function cancelImportFor(actor: ImportActor, batchId: unknown): Promise<Result<{ ok: true }>> {
  if (!actor.can("settings.import")) return fail("forbidden", FORBIDDEN);
  return attempt("cancel", async () => {
    const b = await batchOf(actor, batchId);
    if (!b) return fail("not_found", NOT_FOUND);
    await cancelImportBatch(actor.repo(), actor.tenantId, b.id, actor.actor);
    return { ok: true, value: { ok: true } };
  });
}

/** Our CSV template for a kind: the header line only (its column names always match in the mapping step). */
export function importTemplateCsv(kind: string): string | null {
  if (!isImportKind(kind)) return null;
  return `﻿${toCsv([templateHeaders(kind)])}\r\n`;
}
