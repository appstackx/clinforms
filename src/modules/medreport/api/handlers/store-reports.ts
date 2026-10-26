import "server-only";

/**
 * /api/reports/v1/store/reports/{id} (signed-in clinic member, two-step verified)
 *
 * GET    → {rev, updatedAt, report}, ETag "<rev>"; 404 when the clinic has no such report.
 * PUT    {report} → 201 (created) / 200 (updated) {rev, updatedAt, report}, ETag "<rev>".
 *        No If-Match = create; If-Match: "<rev>" = update of exactly that revision.
 *        409 REV_CONFLICT {current: {rev, updatedAt, report} | null} when the stored revision differs (or the
 *        report already exists on a create) – the Studio reloads the stored copy.
 *        Rules: the body passes ReportSchema (422 – strict; a stored copy is READ with core/stored-schemas.ts
 *        StoredReportSchema, which keeps what a later release wrote); report.id = the path id (422); the clinic is the
 *        member's (report.tenantId is set from the sign-in, never trusted); a report marked "signed" needs an
 *        approval receipt that verifies for this clinic and this exact content (422 RECEIPT_INVALID); any receipt
 *        on a draft must at least be genuine and for this report and clinic; an approved (signed) report cannot be
 *        turned back into a draft (409 REPORT_LOCKED – an amendment is a new report).
 *        (fix wave 2) a body naming another clinic (report.tenantId neither the member's clinic nor "demo" – a
 *        case imported from the public demo) is refused: 403 TENANT_MISMATCH, never re-filed under this clinic.
 * DELETE → {deleted}; If-Match optional (409 REV_CONFLICT when it does not match). (Fix wave 2) an approved
 *        report is deleted only by the clinic's owner or an administrator (409 REPORT_LOCKED otherwise) – so an
 *        approved record can never be deleted and re-created as a draft by another role.
 * Every change writes an audit row (ids, revision and status only). Patient data is encrypted at rest by the host.
 * bh2 WC design 2 – provenance checked by the server: a PUT is compared with the stored revision, and every new or
 *        changed decision must carry the signed-in member's own stamp (`by` on paragraphs, answers, gap resolutions,
 *        acknowledgements, dispositions, adoptions, acceptances and own-words records); an approver-only decision –
 *        on a clinician box, an approver-only acknowledgement, "my own words", an adoption, an acceptance, applies
 *        anyway, the approving clinician's own text – needs the report's approver (403 DECISION_NOT_ALLOWED). The
 *        approver changes only by the member's own "Take over as approver"; tombstones and takeovers are append-only.
 *        A stored APPROVED report cannot change: its flags are byte-equal, its activity is only appended to (entries
 *        the server added – "superseded" – are kept), else 403 REPORT_LOCKED.
 *        WC design 8: storing an approved version 2 (report.amends) appends "Superseded by version 2" to version 1's
 *        activity on the server, once; loading the approved version 2 retries it, so every tab reads v1 as superseded.
 * Usage (25/10/2026): a report created here is counted as started for the clinic (an amended version names the report
 * it amends, so it never counts as a new report – only an approved report of the same patient, episode and form,
 * by the server's fingerprint of this report: api/usage.ts usageEpisodeFp).
 *
 * Owner: store slice (wave 2).
 */
import { MANAGE_ROLES, assertActorTenant, type Actor as AuthActor } from "../../auth/actor";
import { verifyReceipt } from "../../auth/sign-receipt";
import { DEMO_TENANT_ID } from "../../config.public";
import { WORDING } from "../../core/wording";
import { canonicalize } from "../../core/fingerprint";
import { isClinicianBox, isClinicianGap, isSupersededBy, normaliseHcpc, supersededEntry, type BoxContext } from "../../core/provenance";
import { StoredFormDefinitionSchema, StoredReportSchema } from "../../core/stored-schemas";
import type { ActivityEntry, Paragraph, Report, ReportSection } from "../../core/types";
import { ackPolicyOf } from "../../core/validation/acknowledge";
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
import { assertContentType, auditStore, jsonWithRev, pathParam, problemWith, requireTenantActor, takeNewData, type TenantActor } from "./store-actor";
import { assertClinicMayCreate } from "../../auth/clinic-access";
import { recordUsage, usageEpisodeFp, usageEpisodeOfReport } from "../usage";

function readIfMatch(req: Request): number | null {
  const raw = req.headers.get("if-match");
  if (raw === null || raw.trim() === "") return null;
  const rev = parseRevTag(raw);
  if (rev === null) {
    throw new HttpError(422, "Invalid If-Match", { code: "VALIDATION_FAILED", issues: [{ path: "If-Match", message: 'Send the revision as "<rev>".' }] });
  }
  return rev;
}

/**
 * A stored payload that no longer parses is a server fault, never shown to the client as data. Read as stored
 * (core/stored-schemas.ts): keys and flag codes a later release wrote stay in, so its receipt still verifies.
 */
function parseStoredReport(payload: unknown, id: string): Report {
  const parsed = StoredReportSchema.safeParse(payload);
  if (!parsed.success) {
    logEvent("store_report_unreadable", { id });
    throw new HttpError(500, "The stored report could not be read", { code: "INTERNAL", detail: "Please try again, or contact support." });
  }
  return parsed.data;
}

async function currentCopy(store: TenantStore, tenantId: string, id: string): Promise<StoreReportResponse | null> {
  const stored = await store.getReport(tenantId, id);
  if (!stored) return null;
  const parsed = StoredReportSchema.safeParse(stored.payload);
  return parsed.success ? { rev: stored.rev, updatedAt: stored.updatedAt, report: parsed.data } : null;
}

function conflict(current: StoreReportResponse | null, detail: string): Response {
  return problemWith(409, "This report was changed elsewhere", "REV_CONFLICT", detail, { current });
}

/** Receipt rules for a report about to be stored for `tenantId` (report.tenantId is already the actor's). */
async function checkReceipt(report: Report, tenantId: string): Promise<Response | null> {
  if (report.status === "signed") {
    if (!report.receipt) {
      return problem(422, "An approved report needs its approval receipt", {
        code: "RECEIPT_INVALID",
        detail: "Approve the report in ClinForms: the server issues the receipt.",
      });
    }
    const verified = await verifyReceipt(report.receipt, report, { tenantId });
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
    const verified = await verifyReceipt(report.receipt, report, { tenantId });
    if (!verified.ok && verified.reason !== "HASH_MISMATCH") {
      return problem(422, "The approval receipt is not valid for this report", {
        code: "RECEIPT_INVALID",
        detail: "The approval receipt could not be verified for this report and clinic.",
      });
    }
  }
  return null;
}


/* ------------------------------------------------------------------------------------------------
 * Provenance (bh2 WC design 2)
 * ----------------------------------------------------------------------------------------------*/

/** The signed-in member as the store compares stamps with it (the account id is the member id the Studio stamps). */
interface StoreMember {
  memberId: string;
  name: string;
  role: string;
  hcpc?: string;
  canSign: boolean;
}

function storeMemberOf(actor: AuthActor): StoreMember {
  const hcpc = actor.clinician?.hcpc?.trim();
  return { memberId: actor.userId ?? "", name: actor.name ?? actor.clinician?.name ?? "", role: actor.role, ...(hcpc ? { hcpc } : {}), canSign: actor.clinician?.canSign === true };
}

/** A stamp names the signed-in member: their account id, or their registration number (a clinician's signing identity). */
function isMember(stamp: { memberId?: string; hcpc?: string } | null | undefined, m: StoreMember): boolean {
  if (!stamp) return false;
  if (stamp.memberId && m.memberId && stamp.memberId === m.memberId) return true;
  return Boolean(stamp.hcpc && m.hcpc && normaliseHcpc(stamp.hcpc) === normaliseHcpc(m.hcpc));
}

/** The member makes the approver's decisions on this report (a report with no approver: any member who is not staff). */
function isApprover(report: Pick<Report, "approver">, m: StoreMember): boolean {
  return report.approver ? isMember(report.approver, m) : m.role !== "staff";
}

const same = (a: unknown, b: unknown) => canonicalize(a ?? null) === canonicalize(b ?? null);

/** Paragraph content that a stamp vouches for. */
function paragraphContent(p: Paragraph): unknown {
  return { text: p.text, sourceIds: p.sourceIds };
}

/**
 * The new or changed decisions in `after` (against the stored `before`, null on a create) that the member may not
 * record: a stamp that is not theirs, or an approver-only decision by someone who is not the approver. Codes only.
 */
export function decisionViolations(before: Report | null, after: Report, m: StoreMember, ctx: BoxContext = {}): string[] {
  const out: string[] = [];
  const approver = isApprover(after, m);
  const flagsBefore = new Map((before?.flags ?? []).map((f) => [f.id, f]));
  for (const f of after.flags ?? []) {
    const ack = f.acknowledged;
    if (!ack) continue;
    const was = flagsBefore.get(f.id)?.acknowledged;
    if (was && was.reason === ack.reason && was.at === ack.at && same(was.by, ack.by)) continue;
    if (ack.by && !isMember(ack.by, m)) out.push("acknowledged-by-other");
    else if (f.code === "APPROVER_DECISION") out.push("approver-decision-acknowledged");
    else if (ackPolicyOf(f, after) === "approver" && !approver) out.push("acknowledgement-approver-only");
  }
  for (const s of after.sections ?? []) {
    const was = before?.sections.find((x) => x.key === s.key);
    const clinician = isClinicianBox(after, s, ctx);
    for (const p of s.paragraphs) {
      const b = was?.paragraphs.find((x) => x.id === p.id);
      const contentChanged = !b || !same(paragraphContent(p), paragraphContent(b));
      if (p.by && (contentChanged || !same(p.by, b?.by)) && !isMember(p.by, m) && !(b && !contentChanged && p.origin !== b.origin)) out.push("paragraph-by-other");
      if (p.ownWords && !same(p.ownWords, b?.ownWords) && (!isMember(p.ownWords.by, m) || !approver)) out.push("own-words-approver-only");
      if (p.ackReason && p.ackReason !== b?.ackReason && after.approver && !approver) out.push("acknowledgement-approver-only");
      const nowClinician = p.origin === "clinician" && (!b || b.origin !== "clinician" || contentChanged);
      if (nowClinician && after.approver && !approver) out.push("clinician-text-approver-only");
    }
    if (s.answer && !same(s.answer, was?.answer) && s.answerBy && !isMember(s.answerBy, m)) out.push("answer-by-other");
    if (s.adoptedBy && !same(s.adoptedBy, was?.adoptedBy) && (!isMember(s.adoptedBy.by, m) || !approver)) out.push("adoption-approver-only");
    const acceptedBefore = new Set((was?.accepted ?? []).map((a) => canonicalize(a)));
    for (const a of s.accepted ?? []) if (!acceptedBefore.has(canonicalize(a)) && (!isMember(a.by, m) || !approver)) out.push("acceptance-approver-only");
    const d = s.disposition;
    if (d && !same(d, was?.disposition)) {
      if (!isMember(d.by, m)) out.push("disposition-by-other");
      else if ((clinician || d.kind === "applies_anyway") && !approver) out.push("disposition-approver-only");
    }
    const tombs = was?.tombstones ?? [];
    if (!same((s.tombstones ?? []).slice(0, tombs.length), tombs)) out.push("tombstones-rewritten");
  }
  const gapsBefore = new Map((before?.gaps ?? []).map((g) => [g.id, g]));
  for (const g of after.gaps ?? []) {
    const r = g.resolution;
    if (!r) continue;
    const was = gapsBefore.get(g.id)?.resolution;
    if (was && same({ ...was, by: undefined }, { ...r, by: undefined }) && same(was.by, r.by)) continue;
    if (r.by && !isMember(r.by, m)) out.push("gap-by-other");
    else if (!r.notApplicable && isClinicianGap(after, g, ctx) && !approver) out.push("gap-approver-only");
  }
  if (before && !same(before.approver, after.approver)) {
    // Only "Take over as approver": the member themselves, who may approve, recorded as a takeover from the approver.
    const takeovers = after.approverTakeovers ?? [];
    const last = takeovers[takeovers.length - 1];
    const recorded = !before.approver || (last && same(last.from, before.approver) && same(last.to, after.approver) && takeovers.length === (before.approverTakeovers?.length ?? 0) + 1);
    if (!after.approver || !isMember(after.approver, m) || !m.canSign || !m.hcpc || !recorded) out.push("approver-changed");
  }
  if (before && !same((after.approverTakeovers ?? []).slice(0, (before.approverTakeovers ?? []).length), before.approverTakeovers ?? [])) out.push("takeovers-rewritten");
  return Array.from(new Set(out));
}

/** An activity entry the server wrote (version 1's "superseded"): a client's older copy may lack it. */
function serverEntry(e: ActivityEntry): boolean {
  return e.action === "superseded" && typeof e.reportId === "string";
}

/**
 * A stored approved report: the flags must be exactly the stored ones and the activity an extension of it. Returns the
 * activity to store (the server's own entries kept where the client's copy lacks them), or null when refused.
 */
function lockedActivity(before: Report, after: Report): ActivityEntry[] | null {
  if (!same(before.flags, after.flags)) return null;
  const body = after.activity.map((e) => canonicalize(e));
  let i = 0;
  const merged: ActivityEntry[] = [];
  for (const e of before.activity) {
    const key = canonicalize(e);
    if (body[i] === key) {
      merged.push(e);
      i += 1;
    } else if (serverEntry(e)) {
      merged.push(e);
    } else {
      return null;
    }
  }
  return [...merged, ...after.activity.slice(i)];
}

/** The form map a form report was started from, for the clinician-box rules (null when it cannot be read). */
async function boxContextOf(t: TenantActor, report: Report): Promise<BoxContext> {
  if (!report.form?.formId) return {};
  const row = await t.store.getForm(t.tenantId, report.form.formId).catch(() => null);
  const parsed = row ? StoredFormDefinitionSchema.safeParse(row.payload) : null;
  return parsed?.success ? { fields: parsed.data.fields } : {};
}

/**
 * WC design 8: an approved amended version marks the version it amends as superseded – one activity entry naming
 * version 2 (ActivityEntry.reportId), appended once (idempotent); outside the content fingerprint, so version 1's
 * receipt still verifies. Best effort: a failure is logged and retried the next time version 2 is stored or loaded.
 */
async function markSuperseded(t: TenantActor, v2: Report): Promise<void> {
  if (v2.status !== "signed" || !v2.amends?.reportId || v2.amends.reportId === v2.id) return;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const row = await t.store.getReport(t.tenantId, v2.amends.reportId);
      if (!row) return;
      const parsed = StoredReportSchema.safeParse(row.payload);
      if (!parsed.success) return;
      const v1 = parsed.data;
      if (isSupersededBy(v1, v2.id)) return;
      const updated: Report = { ...v1, activity: [...v1.activity, supersededEntry(v2)] };
      const res = await t.store.updateReport(t.tenantId, { id: v1.id, status: v1.status, templateId: v1.templateId, formId: v1.form?.formId ?? null, payload: updated }, row.rev);
      if (res.ok) {
        await auditStore(t, { action: "report.update", targetType: "report", targetId: v1.id, detail: { rev: res.rev, status: v1.status, supersededBy: v2.id } });
        return;
      }
      if (res.reason !== "conflict") return;
    }
  } catch {
    logEvent("store_supersede_failed", { id: v2.id });
  }
}

export const handleStoreReportGet: MedreportHandler = async (req, ctx, deps) => {
  const t = await requireTenantActor(req, deps);
  const id = pathParam(ctx.params, "id", STORE_RECORD_ID_PATTERN);
  const stored = await t.store.getReport(t.tenantId, id);
  if (!stored) return problem(404, "Report not found", { code: "NOT_FOUND", detail: "This report is not in the clinic's records." });
  const body: StoreReportResponse = { rev: stored.rev, updatedAt: stored.updatedAt, report: parseStoredReport(stored.payload, id) };
  // WC design 8: an approved version 2 makes sure version 1 reads as superseded (idempotent retry).
  if (body.report.status === "signed" && body.report.amends) await markSuperseded(t, body.report);
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
  // The clinic is the signed-in member's – a stored report can never be filed under another clinic. A body that
  // names another clinic is refused (a change made for one clinic is never re-filed under another); a case
  // imported from the public demo (tenant "demo") becomes the clinic's own.
  if (parsed.data.report.tenantId !== DEMO_TENANT_ID) assertActorTenant(t.actor, parsed.data.report.tenantId, "report");
  const report: Report = parsed.data.report.tenantId === t.tenantId ? parsed.data.report : { ...parsed.data.report, tenantId: t.tenantId };
  if (new TextEncoder().encode(JSON.stringify(report)).byteLength > STORE_MAX_RECORD_BYTES) {
    return problem(413, "This report is too large to store", { code: "PAYLOAD_TOO_LARGE" });
  }
  const refused = await checkReceipt(report, t.tenantId);
  if (refused) return refused;

  let before: StoredReportMeta | null = null;
  let stored: Report | null = null;
  if (ifMatch !== null) {
    before = await t.store.getReportMeta(t.tenantId, id);
    if (before && before.status === "signed" && report.status !== "signed") {
      return problem(409, "This report has been approved", {
        code: "REPORT_LOCKED",
        detail: "An approved report cannot be changed. Start an amendment to correct it.",
      });
    }
    // The stored revision this PUT changes (a revision other than If-Match is answered 409 by the update below).
    if (before && before.rev === ifMatch) {
      const full = await t.store.getReport(t.tenantId, id);
      if (full && full.rev === ifMatch) stored = parseStoredReport(full.payload, id);
    }
  }

  // bh2 WC design 2: every new or changed decision is the signed-in member's own, and approver-only ones the approver's –
  // checked against the stored revision (a new report, and a case imported from the public demo, are stored as sent).
  const violations = stored ? decisionViolations(stored, report, storeMemberOf(t.actor), await boxContextOf(t, report)) : [];
  if (violations.length > 0) {
    logEvent("store_decision_refused", { id, count: violations.length, first: violations[0] });
    return problem(403, "This change cannot be saved as yours", {
      code: "DECISION_NOT_ALLOWED",
      detail: "It records a decision as someone else, or a decision only the approving clinician can make. Reload the report and try again.",
    });
  }
  let toStore: Report = report;
  if (stored && stored.status === "signed") {
    const activity = lockedActivity(stored, report);
    if (!activity) {
      return problem(403, "This report has been approved", {
        code: "REPORT_LOCKED",
        detail: "An approved report's checks and activity log cannot be rewritten. Start an amendment to correct it.",
      });
    }
    toStore = activity.length === report.activity.length ? report : { ...report, activity };
  }

  const row = { id, status: toStore.status, templateId: toStore.templateId, formId: toStore.form?.formId ?? null, payload: toStore };
  // The clinic's daily new-data allowance counts a new report in full and (fix wave 3) the growth of an update – a
  // record created small and saved again at full size is counted too.
  const bytes = new TextEncoder().encode(JSON.stringify(toStore)).byteLength;
  // 10/2026: a clinic whose trial has ended keeps (and may still change) what it has, but creates nothing new.
  if (ifMatch === null) await assertClinicMayCreate(t.actor, deps, "report");
  if (ifMatch === null) await takeNewData(deps, t, bytes);
  else if (before?.storedBytes !== undefined && bytes - before.storedBytes > 1024) await takeNewData(deps, t, bytes - before.storedBytes);
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
  if (created) {
    await recordUsage(deps, t.actor, {
      kind: "report_started",
      reportId: id,
      ...(report.amends ? { amendsReportId: report.amends.reportId } : {}),
      episodeFp: usageEpisodeFp(t.tenantId, usageEpisodeOfReport(report)),
    });
  }
  // WC design 8: storing the approved version 2 supersedes version 1 on the server (never a second client write).
  if (toStore.status === "signed" && toStore.amends) await markSuperseded(t, toStore);
  const body: StoreReportResponse = { rev: result.rev, updatedAt: result.updatedAt, report: toStore };
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
  if (before && before.status === "signed" && MANAGE_ROLES.indexOf(t.actor.role) < 0) {
    return problem(409, WORDING.server.access.approvedLockedTitle, { code: "REPORT_LOCKED", detail: WORDING.server.access.approvedDeleteDetail });
  }
  const deleted = before ? await t.store.deleteReport(t.tenantId, id) : false;
  if (deleted) {
    await auditStore(t, { action: "report.delete", targetType: "report", targetId: id, detail: { rev: before?.rev ?? null, status: before?.status ?? null } });
  }
  return json({ deleted });
};
