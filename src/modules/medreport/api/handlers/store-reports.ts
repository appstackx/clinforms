import "server-only";

/**
 * /api/reports/v1/store/reports/{id} (signed-in clinic member, two-step verified)
 *
 * GET    → {rev, updatedAt, report}, ETag "<rev>"; 404 when the clinic has no such report.
 * PUT    {report} → 201 (created) / 200 (updated) {rev, updatedAt, report}, ETag "<rev>".
 *        No If-Match = create; If-Match: "<rev>" = update of exactly that revision.
 *        409 REV_CONFLICT {current: {rev, updatedAt, report} | null} when the stored revision differs (or the
 *        report already exists on a create) – the Studio reloads the stored copy.
 *        Rules: the body passes ReportSchema (422); report.id = the path id (422); the clinic is the
 *        member's (report.tenantId is set from the sign-in, never trusted); a report marked "signed" needs an
 *        approval receipt that verifies for this clinic and this exact content (422 RECEIPT_INVALID); any receipt
 *        on a draft must at least be genuine and for this report and clinic; an approved (signed) report cannot be
 *        turned back into a draft (409 REPORT_LOCKED – an amendment is a new report).
 * DELETE → {deleted}; If-Match optional (409 REV_CONFLICT when it does not match).
 * Every change writes an audit row (ids, revision and status only). Patient data is encrypted at rest by the host.
 *
 * Owner: store slice (wave 2).
 */
import { verifyReceipt } from "../../auth/sign-receipt";
import { ReportSchema } from "../../core/schemas";
import type { Report } from "../../core/types";
import { HttpError, json, logEvent, parseBody, problem, type MedreportHandler } from "../http";
import {
  STORE_MAX_PUT_BYTES,
  STORE_MAX_RECORD_BYTES,
  STORE_RECORD_ID_PATTERN,
  StoreReportPutRequestSchema,
  parseRevTag,
  type StoreReportResponse,
} from "../store-contract";
import type { StoredReportMeta, TenantStore } from "../store-port";
import { assertContentType, auditStore, jsonWithRev, pathParam, problemWith, requireTenantActor } from "./store-actor";

function readIfMatch(req: Request): number | null {
  const raw = req.headers.get("if-match");
  if (raw === null || raw.trim() === "") return null;
  const rev = parseRevTag(raw);
  if (rev === null) {
    throw new HttpError(422, "Invalid If-Match", { code: "VALIDATION_FAILED", issues: [{ path: "If-Match", message: 'Send the revision as "<rev>".' }] });
  }
  return rev;
}

/** A stored payload that no longer parses is a server fault, never shown to the client as data. */
function parseStoredReport(payload: unknown, id: string): Report {
  const parsed = ReportSchema.safeParse(payload);
  if (!parsed.success) {
    logEvent("store_report_unreadable", { id });
    throw new HttpError(500, "The stored report could not be read", { code: "INTERNAL", detail: "Please try again, or contact support." });
  }
  return parsed.data;
}

async function currentCopy(store: TenantStore, tenantId: string, id: string): Promise<StoreReportResponse | null> {
  const stored = await store.getReport(tenantId, id);
  if (!stored) return null;
  const parsed = ReportSchema.safeParse(stored.payload);
  return parsed.success ? { rev: stored.rev, updatedAt: stored.updatedAt, report: parsed.data } : null;
}

function conflict(current: StoreReportResponse | null, detail: string): Response {
  return problemWith(409, "This report was changed elsewhere", "REV_CONFLICT", detail, { current });
}

/** Receipt rules for a report about to be stored for `tenantId` (report.tenantId is already the actor's). */
async function checkReceipt(report: Report): Promise<Response | null> {
  if (report.status === "signed") {
    if (!report.receipt) {
      return problem(422, "An approved report needs its approval receipt", {
        code: "RECEIPT_INVALID",
        detail: "Approve the report in ClinForms: the server issues the receipt.",
      });
    }
    const verified = await verifyReceipt(report.receipt, report);
    if (!verified.ok) {
      return problem(422, "The approval receipt is not valid for this report", {
        code: "RECEIPT_INVALID",
        detail:
          verified.reason === "HASH_MISMATCH"
            ? "The report has changed since it was approved. Start an amendment to change an approved report."
            : "The approval receipt could not be verified for this report and clinic.",
      });
    }
    return null;
  }
  if (report.receipt) {
    // A draft may still carry a receipt from before an edit, but never a forged one or another report's.
    const verified = await verifyReceipt(report.receipt, report);
    if (!verified.ok && verified.reason !== "HASH_MISMATCH") {
      return problem(422, "The approval receipt is not valid for this report", {
        code: "RECEIPT_INVALID",
        detail: "The approval receipt could not be verified for this report and clinic.",
      });
    }
  }
  return null;
}

export const handleStoreReportGet: MedreportHandler = async (req, ctx, deps) => {
  const t = await requireTenantActor(req, deps);
  const id = pathParam(ctx.params, "id", STORE_RECORD_ID_PATTERN);
  const stored = await t.store.getReport(t.tenantId, id);
  if (!stored) return problem(404, "Report not found", { code: "NOT_FOUND", detail: "This report is not in the clinic's records." });
  const body: StoreReportResponse = { rev: stored.rev, updatedAt: stored.updatedAt, report: parseStoredReport(stored.payload, id) };
  return jsonWithRev(body, stored.rev);
};

export const handleStoreReportPut: MedreportHandler = async (req, ctx, deps) => {
  const t = await requireTenantActor(req, deps, { write: true });
  assertContentType(req);
  const id = pathParam(ctx.params, "id", STORE_RECORD_ID_PATTERN);
  const ifMatch = readIfMatch(req);
  const parsed = await parseBody(req, StoreReportPutRequestSchema, { maxBytes: STORE_MAX_PUT_BYTES });
  if (!parsed.ok) return parsed.response;
  if (parsed.data.report.id !== id) {
    return problem(422, "Report id does not match the path", { code: "VALIDATION_FAILED", issues: [{ path: "report.id", message: "Must equal the id in the path." }] });
  }
  // The clinic is the signed-in member's – a stored report can never be filed under another clinic.
  const report: Report = parsed.data.report.tenantId === t.tenantId ? parsed.data.report : { ...parsed.data.report, tenantId: t.tenantId };
  if (new TextEncoder().encode(JSON.stringify(report)).byteLength > STORE_MAX_RECORD_BYTES) {
    return problem(413, "This report is too large to store", { code: "PAYLOAD_TOO_LARGE" });
  }
  const refused = await checkReceipt(report);
  if (refused) return refused;

  let before: StoredReportMeta | null = null;
  if (ifMatch !== null) {
    before = await t.store.getReportMeta(t.tenantId, id);
    if (before && before.status === "signed" && report.status !== "signed") {
      return problem(409, "This report has been approved", {
        code: "REPORT_LOCKED",
        detail: "An approved report cannot be changed. Start an amendment to correct it.",
      });
    }
  }

  const row = { id, status: report.status, templateId: report.templateId, formId: report.form?.formId ?? null, payload: report };
  const result = ifMatch === null ? await t.store.createReport(t.tenantId, row) : await t.store.updateReport(t.tenantId, row, ifMatch);
  if (!result.ok) {
    switch (result.reason) {
      case "exists":
        return conflict(await currentCopy(t.store, t.tenantId, id), "The clinic already holds this report. The stored copy was loaded.");
      case "conflict":
        return conflict(await currentCopy(t.store, t.tenantId, id), "Someone saved this report after you opened it. The stored copy was loaded.");
      case "not_found":
        return problem(404, "Report not found", { code: "NOT_FOUND", detail: "This report was deleted." });
      case "invalid":
        return problem(422, "The report could not be stored", { code: "VALIDATION_FAILED", detail: result.message });
    }
  }
  const created = ifMatch === null;
  await auditStore(t, {
    action: created ? "report.create" : report.status === "signed" && before?.status !== "signed" ? "report.store_signed" : "report.update",
    targetType: "report",
    targetId: id,
    detail: { rev: result.rev, status: report.status, version: report.version ?? 1 },
  });
  const body: StoreReportResponse = { rev: result.rev, updatedAt: result.updatedAt, report };
  return jsonWithRev(body, result.rev, { status: created ? 201 : 200 });
};

export const handleStoreReportDelete: MedreportHandler = async (req, ctx, deps) => {
  const t = await requireTenantActor(req, deps, { write: true });
  const id = pathParam(ctx.params, "id", STORE_RECORD_ID_PATTERN);
  const ifMatch = readIfMatch(req);
  const before = await t.store.getReportMeta(t.tenantId, id);
  if (before && ifMatch !== null && before.rev !== ifMatch) {
    return conflict(await currentCopy(t.store, t.tenantId, id), "Someone saved this report after you opened it. The stored copy was loaded.");
  }
  const deleted = before ? await t.store.deleteReport(t.tenantId, id) : false;
  if (deleted) {
    await auditStore(t, { action: "report.delete", targetType: "report", targetId: id, detail: { rev: before?.rev ?? null, status: before?.status ?? null } });
  }
  return json({ deleted });
};
