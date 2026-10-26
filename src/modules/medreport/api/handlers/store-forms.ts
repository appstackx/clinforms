import "server-only";

/**
 * /api/reports/v1/store/forms/{id} (signed-in clinic member, two-step verified)
 *
 * GET    → {rev, updatedAt, form}, ETag "<rev>"; 404 when the clinic has no such form map.
 * PUT    {form} → 201 / 200 {rev, updatedAt, form, downgraded?}, ETag "<rev>". No If-Match = create;
 *        If-Match: "<rev>" = update; 409 REV_CONFLICT {current} as for reports.
 *        Rules: FormDefinitionSchema (422 – strict; a stored copy is READ with StoredFormDefinitionSchema,
 *        core/stored-schemas.ts); form.id = the path id; form.tenantId is set from the sign-in; a map
 *        marked "confirmed" is stored as "proposed" unless it carries the server's valid attestation of exactly
 *        this map for this clinic (auth/attestations.ts) – "confirmed" is never just the browser's claim.
 *        Portal question sets (kind "questions") have no file: nothing here requires one.
 *        (Fix wave 2) a body naming another clinic (neither the member's nor "demo") is 403 TENANT_MISMATCH; a
 *        confirmed map is turned back into a proposal only by a role that may confirm (owner, admin, clinician –
 *        403 ROLE_NOT_ALLOWED for staff).
 * DELETE → {deleted}; the map's file is deleted too when no other map of the clinic uses it (as in the
 *        browser store). If-Match optional. (Fix wave 2) a confirmed map is deleted only by a role that may confirm.
 * Every change writes an audit row (ids, revision and status only).
 * Usage (25/10/2026): a portal question set (kind "questions") stored for the first time is counted for the clinic.
 * bh2 WE design 2 (map lint L5): a map newly stored as "confirmed" (not the same confirmation stored again) is refused
 * (422 VALIDATION_FAILED) while a question asking for a clinical judgement would be answered by staff, a fixed value or
 * a draft without an acceptance stamped by a clinician (/forms/confirm stamps it; the attestation covers it).
 *
 * Owner: WE (data, maps and mapping page) – docs/bh2-ownership.json.
 */
import { CONFIRM_ROLES, assertActorTenant } from "../../auth/actor";
import { formConfirmationProblem, verifyFormConfirmation } from "../../auth/attestations";
import { DEMO_TENANT_ID } from "../../config.public";
import { WORDING } from "../../core/wording";
import { StoredFormDefinitionSchema } from "../../core/stored-schemas";
import type { FormDefinition } from "../../core/types";
import { HttpError, json, logEvent, parseBody, problem, type MedreportHandler } from "../http";
import {
  STORE_MAX_PUT_BYTES,
  STORE_MAX_RECORD_BYTES,
  STORE_RECORD_ID_PATTERN,
  StoreFormPutRequestSchema,
  parseRevTag,
  type StoreFormResponse,
} from "../store-contract";
import type { TenantStore } from "../store-port";
import { assertContentType, auditStore, jsonWithRev, pathParam, problemWith, requireTenantActor, takeNewData } from "./store-actor";
import { assertClinicMayCreate } from "../../auth/clinic-access";
import { recordUsage } from "../usage";
import { judgementOnNonClinicianSource } from "../../core/form-map-lint";

/**
 * L5 for a confirmed map: every question that asks for a clinical judgement but would be answered by staff, a fixed
 * value or a draft carries an acceptance stamped by a clinician (the role clinician, or a member who may sign). The
 * problems found, as API issues (empty: none).
 */
export function confirmedJudgementIssues(form: Pick<FormDefinition, "fields">): Array<{ path: string; message: string }> {
  const issues: Array<{ path: string; message: string }> = [];
  for (const f of form.fields) {
    const j = judgementOnNonClinicianSource(f);
    if (!j) continue;
    const acceptance = f.lintAccepted?.find((a) => a.rule === "L5");
    if (!acceptance) issues.push({ path: `form.fields.${f.id}`, message: `A clinical judgement (${j.kind}) not left to the clinician, and not accepted.` });
    else if (!acceptance.by || !(acceptance.by.role === "clinician" || acceptance.by.canSign)) {
      issues.push({ path: `form.fields.${f.id}`, message: `A clinical judgement (${j.kind}) accepted, but not by a clinician.` });
    }
  }
  return issues;
}

function readIfMatch(req: Request): number | null {
  const raw = req.headers.get("if-match");
  if (raw === null || raw.trim() === "") return null;
  const rev = parseRevTag(raw);
  if (rev === null) {
    throw new HttpError(422, "Invalid If-Match", { code: "VALIDATION_FAILED", issues: [{ path: "If-Match", message: 'Send the revision as "<rev>".' }] });
  }
  return rev;
}

async function currentCopy(store: TenantStore, tenantId: string, id: string): Promise<Omit<StoreFormResponse, "downgraded"> | null> {
  const stored = await store.getForm(tenantId, id);
  if (!stored) return null;
  const parsed = StoredFormDefinitionSchema.safeParse(stored.payload);
  return parsed.success ? { rev: stored.rev, updatedAt: stored.updatedAt, form: parsed.data } : null;
}

function conflict(current: Omit<StoreFormResponse, "downgraded"> | null, detail: string): Response {
  return problemWith(409, "This form mapping was changed elsewhere", "REV_CONFLICT", detail, { current });
}

/** 403 ROLE_NOT_ALLOWED: only a role that may confirm a map may undo or delete a confirmed one. */
function confirmedMapRefusal(): Response {
  return problem(403, WORDING.server.access.confirmedMapTitle, { code: "ROLE_NOT_ALLOWED", detail: WORDING.server.access.confirmedMapDetail });
}

/**
 * The map as the clinic may store it: its clinic is the member's, and a confirmation the server cannot verify
 * for this clinic becomes "proposed" (the same rule the browser store applies on reading).
 */
export function normaliseStoredForm(form: FormDefinition, tenantId: string): { form: FormDefinition; downgraded: boolean; reason?: string } {
  const own: FormDefinition = form.tenantId === tenantId ? form : { ...form, tenantId };
  if (own.status !== "confirmed") return { form: own, downgraded: false };
  const check = verifyFormConfirmation(own, { tenantId });
  if (check.ok) return { form: own, downgraded: false };
  const next: FormDefinition = { ...own, status: "proposed" };
  delete next.confirmed;
  return { form: next, downgraded: true, reason: formConfirmationProblem(check.reason) };
}

export const handleStoreFormGet: MedreportHandler = async (req, ctx, deps) => {
  const t = await requireTenantActor(req, deps);
  const id = pathParam(ctx.params, "id", STORE_RECORD_ID_PATTERN);
  const stored = await t.store.getForm(t.tenantId, id);
  if (!stored) return problem(404, "Form mapping not found", { code: "NOT_FOUND", detail: "This form mapping is not in the clinic's library." });
  // Read as stored (core/stored-schemas.ts): what a later release wrote stays in, so the map's attestation verifies.
  const parsed = StoredFormDefinitionSchema.safeParse(stored.payload);
  if (!parsed.success) {
    logEvent("store_form_unreadable", { id });
    throw new HttpError(500, "The stored form mapping could not be read", { code: "INTERNAL", detail: "Please try again, or contact support." });
  }
  const body: StoreFormResponse = { rev: stored.rev, updatedAt: stored.updatedAt, form: parsed.data };
  return jsonWithRev(body, stored.rev);
};

export const handleStoreFormPut: MedreportHandler = async (req, ctx, deps) => {
  const t = await requireTenantActor(req, deps, { write: true });
  assertContentType(req);
  const id = pathParam(ctx.params, "id", STORE_RECORD_ID_PATTERN);
  const ifMatch = readIfMatch(req);
  const parsed = await parseBody(req, StoreFormPutRequestSchema, { maxBytes: STORE_MAX_PUT_BYTES });
  if (!parsed.ok) return parsed.response;
  if (parsed.data.form.id !== id) {
    return problem(422, "Form id does not match the path", { code: "VALIDATION_FAILED", issues: [{ path: "form.id", message: "Must equal the id in the path." }] });
  }
  if (parsed.data.form.tenantId !== DEMO_TENANT_ID) assertActorTenant(t.actor, parsed.data.form.tenantId, "form");
  const { form, downgraded } = normaliseStoredForm(parsed.data.form, t.tenantId);
  // bh2 WE design 2: a new confirmation settles every clinical judgement (L5); the same confirmation stored again is not new.
  if (form.status === "confirmed") {
    const issues = confirmedJudgementIssues(form);
    if (issues.length > 0) {
      const stored = ifMatch !== null ? await currentCopy(t.store, t.tenantId, id) : null;
      const same = stored?.form.status === "confirmed" && stored.form.confirmed?.mapSha256 === form.confirmed?.mapSha256;
      if (!same) {
        return problem(422, "A clinical judgement is not left to the clinician", { code: "VALIDATION_FAILED", detail: issues[0].message, issues });
      }
    }
  }
  if (new TextEncoder().encode(JSON.stringify(form)).byteLength > STORE_MAX_RECORD_BYTES) {
    return problem(413, "This form mapping is too large to store", { code: "PAYLOAD_TOO_LARGE" });
  }
  if (ifMatch !== null && form.status !== "confirmed" && CONFIRM_ROLES.indexOf(t.actor.role) < 0) {
    const stored = (await t.store.listForms(t.tenantId)).find((f) => f.id === id);
    if (stored && stored.status === "confirmed") return confirmedMapRefusal();
  }
  const row = {
    id,
    status: form.status,
    title: form.title.slice(0, 300),
    referrer: form.referrer.name ? form.referrer.name.slice(0, 300) : null,
    kind: form.kind,
    fileSha256: form.file.sha256,
    sampleId: form.sampleId ?? null,
    payload: form,
  };
  // The daily new-data allowance: a new form map in full, and (fix wave 3) the growth of an update.
  const bytes = new TextEncoder().encode(JSON.stringify(form)).byteLength;
  // 10/2026: a clinic whose trial has ended keeps (and may still change) what it has, but creates nothing new.
  if (ifMatch === null) await assertClinicMayCreate(t.actor, deps, "form");
  if (ifMatch === null) await takeNewData(deps, t, bytes);
  else {
    const previous = await t.store.getForm(t.tenantId, id);
    const previousBytes = previous ? new TextEncoder().encode(JSON.stringify(previous.payload)).byteLength : 0;
    if (bytes - previousBytes > 1024) await takeNewData(deps, t, bytes - previousBytes);
  }
  const result = ifMatch === null ? await t.store.createForm(t.tenantId, row) : await t.store.updateForm(t.tenantId, row, ifMatch);
  if (!result.ok) {
    switch (result.reason) {
      case "exists":
        return conflict(await currentCopy(t.store, t.tenantId, id), "The clinic already holds this form mapping. The stored copy was loaded.");
      case "conflict":
        return conflict(await currentCopy(t.store, t.tenantId, id), "Someone saved this form mapping after you opened it. The stored copy was loaded.");
      case "not_found":
        return problem(404, "Form mapping not found", { code: "NOT_FOUND", detail: "This form mapping was deleted." });
      case "invalid":
        return problem(422, "The form mapping could not be stored", { code: "VALIDATION_FAILED", detail: result.message });
    }
  }
  const created = ifMatch === null;
  await auditStore(t, {
    action: created ? "form.create" : form.status === "confirmed" ? "form.store_confirmed" : "form.update",
    targetType: "form",
    targetId: id,
    detail: { rev: result.rev, status: form.status, kind: form.kind, downgraded },
  });
  if (created && form.kind === "questions") await recordUsage(deps, t.actor, { kind: "question_set_created", formId: id });
  const body: StoreFormResponse = { rev: result.rev, updatedAt: result.updatedAt, form, ...(downgraded ? { downgraded: true } : {}) };
  return jsonWithRev(body, result.rev, { status: created ? 201 : 200 });
};

export const handleStoreFormDelete: MedreportHandler = async (req, ctx, deps) => {
  const t = await requireTenantActor(req, deps, { write: true });
  const id = pathParam(ctx.params, "id", STORE_RECORD_ID_PATTERN);
  const ifMatch = readIfMatch(req);
  const forms = await t.store.listForms(t.tenantId);
  const target = forms.find((f) => f.id === id) ?? null;
  if (target && ifMatch !== null && target.rev !== ifMatch) {
    return conflict(await currentCopy(t.store, t.tenantId, id), "Someone saved this form mapping after you opened it. The stored copy was loaded.");
  }
  if (target && target.status === "confirmed" && CONFIRM_ROLES.indexOf(t.actor.role) < 0) return confirmedMapRefusal();
  const deleted = target ? await t.store.deleteForm(t.tenantId, id) : false;
  let fileDeleted = false;
  if (deleted && target && !forms.some((f) => f.id !== id && f.fileSha256 === target.fileSha256)) {
    // Same rule as the browser store: the file goes with the last map that uses it.
    fileDeleted = await t.store.deleteFile(t.tenantId, target.fileSha256).catch(() => false);
  }
  if (deleted) {
    await auditStore(t, { action: "form.delete", targetType: "form", targetId: id, detail: { rev: target?.rev ?? null, fileDeleted } });
  }
  return json({ deleted });
};
