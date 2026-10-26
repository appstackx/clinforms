import "server-only";

/**
 * POST /api/reports/v1/forms/confirm
 * Body FormsConfirmRequest {form, confirmedBy} → FormsConfirmResponse {form}.
 *
 * The staff member has reviewed a proposed (or edited) form map in the mapping screen. The server
 * checks the map (core/forms.ts checkFormDefinition: anchors of the right kind, tick boxes linked,
 * options for choices, at least one question to complete) and returns it with status "confirmed" and a
 * server attestation of exactly these fields (auth/attestations.ts: confirmed.mapSha256 + mac).
 * /drafts, /sign and /render only accept maps whose attestation verifies – editing a field afterwards
 * (in the browser or in transit) invalidates it.
 *
 * Portal question sets (form.kind "questions", no file): the placeholder `file` is recomputed from the
 * questions before the check (core/question-set.ts withQuestionSetFile: SHA-256 of the canonical
 * question list), so the attested map always carries the canonical question-set version.
 *
 * Wave 2 – who: an actor (auth/actor.ts) with role owner, admin or clinician (403 ROLE_NOT_ALLOWED for
 * staff); the public demo acts as a clinician. The map must be the actor's clinic's (403 TENANT_MISMATCH;
 * the attestation MAC covers form.tenantId). For a clinic's member the attestation records the member's
 * own name (the body's `confirmedBy` is ignored) and the confirmation is written to the audit trail.
 *
 * 401 without a caller; 422 VALIDATION_FAILED listing the map's problems.
 *
 * bh2 WE design 2 (map lint L5, D-6, D-7): a question asking for a clinical judgement (fitness for work, restrictions,
 * causation, prognosis, recovery, permanence, barriers, psychosocial factors, yellow flags, a declaration) whose answer
 * would come from staff, a fixed value or a draft from the notes blocks confirming (422 VALIDATION_FAILED, one issue
 * per question) – unless the map records an acceptance for that question (FormField.lintAccepted, rule L5, with its
 * reason). Only a clinician may confirm a map that carries one (the role clinician, or a member who may sign; 403
 * ROLE_NOT_ALLOWED otherwise): the server stamps every such acceptance with the confirming clinician and the time (what
 * the browser sent as `by`/`at` is replaced), the attestation covers it (it is inside `fields`), and each one is
 * written to the audit trail ("form.lint_accepted").
 *
 * Owner: WE (data, maps and mapping page) – docs/bh2-ownership.json.
 */
import { AUDIT_ACTIONS, CONFIRM_ROLES, assertActorTenant, auditActor, requireActor, type Actor as RequestActor } from "../../auth/actor";
import { demoActor, memberActor, type Actor } from "../../core/actor";
import { judgementOnNonClinicianSource } from "../../core/form-map-lint";
import type { FormDefinition } from "../../core/types";
import { withAttestedConfirmation } from "../../auth/attestations";
import { MAX_FORM_REQUEST_BYTES } from "../../config.public";
import { checkFormDefinition } from "../../core/forms";
import { withQuestionSetFile } from "../../core/question-set";
import { FormsConfirmRequestSchema, type FormsConfirmResponse } from "../contract";
import { json, logEvent, parseBody, problem, type MedreportHandler } from "../http";
import { formRequestCapIssues } from "../../forms/request-caps";

/** Whether the caller is a clinician (the role, or a member who may sign; the public demo acts as one). */
export function isClinicalCaller(actor: Pick<RequestActor, "via" | "role" | "clinician">): boolean {
  return actor.via === "demo" || actor.role === "clinician" || actor.clinician?.canSign === true;
}

/** The person who confirms, as the map records them (core/actor.ts: the stored Actor). */
function confirmingActor(actor: RequestActor, name: string): Actor {
  if (actor.via === "demo") return demoActor(name, actor.clinician?.hcpc);
  return memberActor({ userId: actor.userId, name, role: actor.role, canSign: actor.clinician?.canSign, hcpc: actor.clinician?.hcpc }, name);
}

/**
 * The map lint's L5 at confirmation: the questions that ask for a clinical judgement but would be answered by staff, a
 * fixed value or a draft, split into those without an acceptance (they block) and those with one.
 */
export function judgementChecks(form: Pick<FormDefinition, "fields">): { open: Array<{ fieldId: string; kind: string }>; accepted: Array<{ fieldId: string; kind: string; reason: string }> } {
  const open: Array<{ fieldId: string; kind: string }> = [];
  const accepted: Array<{ fieldId: string; kind: string; reason: string }> = [];
  for (const f of form.fields) {
    const j = judgementOnNonClinicianSource(f);
    if (!j) continue;
    const acceptance = f.lintAccepted?.find((a) => a.rule === "L5" && a.reason.trim());
    if (acceptance) accepted.push({ fieldId: f.id, kind: j.kind, reason: acceptance.reason.trim() });
    else open.push({ fieldId: f.id, kind: j.kind });
  }
  return { open, accepted };
}

/** The map with every L5 acceptance stamped by `by` at `at` (what the browser sent is not kept). */
function withStampedAcceptances(form: FormDefinition, fieldIds: ReadonlySet<string>, by: Actor, at: string): FormDefinition {
  if (fieldIds.size === 0) return form;
  return {
    ...form,
    fields: form.fields.map((f) =>
      fieldIds.has(f.id) && f.lintAccepted ? { ...f, lintAccepted: f.lintAccepted.map((a) => (a.rule === "L5" ? { rule: a.rule, reason: a.reason.trim().slice(0, 500), at, by } : a)) } : f,
    ),
  };
}

export const handleFormsConfirm: MedreportHandler = async (req, _ctx, deps) => {
  const actor = await requireActor(req, deps, { roles: CONFIRM_ROLES, action: "confirm form mappings" });
  const parsed = await parseBody(req, FormsConfirmRequestSchema, { maxBytes: MAX_FORM_REQUEST_BYTES });
  if (!parsed.ok) return parsed.response;
  const form = await withQuestionSetFile(parsed.data.form);
  assertActorTenant(actor, form.tenantId, "form");
  // bh2 W0 follow-up (seam "form-request-caps"): WA2's size caps for a map in a request (forms/request-caps.ts; a stub
  // that finds nothing until WA2 fills it in).
  const capIssues = formRequestCapIssues(form);
  if (capIssues.length > 0) return problem(422, "This form is too complex to fill", { code: "FORM_TOO_COMPLEX", detail: capIssues[0].message, issues: capIssues });
  const problems = checkFormDefinition(form);
  if (problems.length > 0) {
    return problem(422, "The mapping is not ready to confirm", {
      code: "VALIDATION_FAILED",
      detail: problems[0],
      issues: problems.map((message) => ({ path: "form.fields", message })),
    });
  }
  // bh2 WE design 2: a clinical judgement is the clinician's – or a clinician accepts it, per question.
  const judgement = judgementChecks(form);
  if (judgement.open.length > 0) {
    return problem(422, "A clinical judgement is not left to the clinician", {
      code: "VALIDATION_FAILED",
      detail: `${judgement.open[0].fieldId} asks for a clinical judgement (${judgement.open[0].kind}) but would be entered by staff, fixed or drafted from the notes: make it the clinician's own answer, or have a clinician accept it with the reason.`,
      issues: judgement.open.map((j) => ({ path: `form.fields.${j.fieldId}`, message: `A clinical judgement (${j.kind}) not left to the clinician: make it the clinician's own answer, or accept it with the reason.` })),
    });
  }
  if (judgement.accepted.length > 0 && !isClinicalCaller(actor)) {
    return problem(403, "Only a clinician can accept a clinical judgement as it is", {
      code: "ROLE_NOT_ALLOWED",
      detail: "This mapping accepts a clinical judgement on a question staff or the notes would answer. A clinician (or a member who may sign) confirms it.",
    });
  }
  // Who confirmed it: a clinic member's own name from the sign-in; the demo keeps the typed name.
  const confirmedBy = (actor.via === "demo" ? parsed.data.confirmedBy : (actor.name ?? actor.clinician?.name ?? parsed.data.confirmedBy)).trim().slice(0, 120);
  const at = new Date().toISOString();
  const stamped = withStampedAcceptances(form, new Set(judgement.accepted.map((j) => j.fieldId)), confirmingActor(actor, confirmedBy), at);
  const confirmed = withAttestedConfirmation({ ...stamped, updatedAt: at }, confirmedBy, at);
  logEvent("form_confirmed", { form: form.id, kind: form.kind, fields: form.fields.length, session: actor.via });
  await auditActor(deps, actor, {
    action: AUDIT_ACTIONS.formConfirm,
    targetType: "form",
    targetId: form.id,
    detail: { kind: form.kind, fields: form.fields.length, mapSha256: confirmed.confirmed?.mapSha256?.slice(0, 16) ?? null },
  });
  for (const j of judgement.accepted) {
    await auditActor(deps, actor, {
      action: "form.lint_accepted",
      targetType: "form",
      targetId: form.id,
      detail: { rule: "L5", fieldId: j.fieldId, judgement: j.kind, reason: j.reason.slice(0, 200) },
    });
  }
  const body: FormsConfirmResponse = { form: confirmed };
  return json(body);
};
