import "server-only";

/**
 * POST /api/reports/v1/forms/confirm  (Bearer session)
 * Body FormsConfirmRequest {form, confirmedBy} → FormsConfirmResponse {form}.
 *
 * The staff member has reviewed a proposed (or edited) form map in the mapping screen. The server
 * checks the map (core/forms.ts checkFormDefinition: anchors of the right kind, tick boxes linked,
 * options for choices, at least one question to complete) and returns it with status "confirmed" and a
 * server attestation of exactly these fields (auth/attestations.ts: confirmed.mapSha256 + mac).
 * /drafts, /sign and /render only accept maps whose attestation verifies – editing a field afterwards
 * (in the browser or in transit) invalidates it.
 *
 * 401 without a session; 403 for another tenant; 422 VALIDATION_FAILED listing the map's problems.
 *
 * Owner: forms-engine agent.
 */
import { withAttestedConfirmation } from "../../auth/attestations";
import { requireSession } from "../../auth/session-token";
import { MAX_FORM_REQUEST_BYTES } from "../../config.public";
import { checkFormDefinition } from "../../core/forms";
import { FormsConfirmRequestSchema, type FormsConfirmResponse } from "../contract";
import { json, logEvent, parseBody, problem, type MedreportHandler } from "../http";

export const handleFormsConfirm: MedreportHandler = async (req) => {
  const claims = requireSession(req);
  const parsed = await parseBody(req, FormsConfirmRequestSchema, { maxBytes: MAX_FORM_REQUEST_BYTES });
  if (!parsed.ok) return parsed.response;
  const { form, confirmedBy } = parsed.data;
  if (form.tenantId !== claims.tenantId) {
    return problem(403, "This form belongs to another clinic", { code: "FORBIDDEN" });
  }
  const problems = checkFormDefinition(form);
  if (problems.length > 0) {
    return problem(422, "The mapping is not ready to confirm", {
      code: "VALIDATION_FAILED",
      detail: problems[0],
      issues: problems.map((message) => ({ path: "form.fields", message })),
    });
  }
  const at = new Date().toISOString();
  const confirmed = withAttestedConfirmation({ ...form, updatedAt: at }, confirmedBy.trim(), at);
  logEvent("form_confirmed", { form: form.id, kind: form.kind, fields: form.fields.length, session: claims.kind });
  const body: FormsConfirmResponse = { form: confirmed };
  return json(body);
};
