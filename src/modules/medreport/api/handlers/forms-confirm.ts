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
 * Owner: forms-engine agent (wave 2 caller rules: API slice).
 */
import { AUDIT_ACTIONS, CONFIRM_ROLES, assertActorTenant, auditActor, requireActor } from "../../auth/actor";
import { withAttestedConfirmation } from "../../auth/attestations";
import { MAX_FORM_REQUEST_BYTES } from "../../config.public";
import { checkFormDefinition } from "../../core/forms";
import { withQuestionSetFile } from "../../core/question-set";
import { FormsConfirmRequestSchema, type FormsConfirmResponse } from "../contract";
import { json, logEvent, parseBody, problem, type MedreportHandler } from "../http";

export const handleFormsConfirm: MedreportHandler = async (req, _ctx, deps) => {
  const actor = await requireActor(req, deps, { roles: CONFIRM_ROLES, action: "confirm form mappings" });
  const parsed = await parseBody(req, FormsConfirmRequestSchema, { maxBytes: MAX_FORM_REQUEST_BYTES });
  if (!parsed.ok) return parsed.response;
  const form = await withQuestionSetFile(parsed.data.form);
  assertActorTenant(actor, form.tenantId, "form");
  const problems = checkFormDefinition(form);
  if (problems.length > 0) {
    return problem(422, "The mapping is not ready to confirm", {
      code: "VALIDATION_FAILED",
      detail: problems[0],
      issues: problems.map((message) => ({ path: "form.fields", message })),
    });
  }
  // Who confirmed it: a clinic member's own name from the sign-in; the demo keeps the typed name.
  const confirmedBy = (actor.via === "demo" ? parsed.data.confirmedBy : (actor.name ?? actor.clinician?.name ?? parsed.data.confirmedBy)).trim().slice(0, 120);
  const at = new Date().toISOString();
  const confirmed = withAttestedConfirmation({ ...form, updatedAt: at }, confirmedBy, at);
  logEvent("form_confirmed", { form: form.id, kind: form.kind, fields: form.fields.length, session: actor.via });
  await auditActor(deps, actor, {
    action: AUDIT_ACTIONS.formConfirm,
    targetType: "form",
    targetId: form.id,
    detail: { kind: form.kind, fields: form.fields.length, mapSha256: confirmed.confirmed?.mapSha256?.slice(0, 16) ?? null },
  });
  const body: FormsConfirmResponse = { form: confirmed };
  return json(body);
};
