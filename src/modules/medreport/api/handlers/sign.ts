import "server-only";

/**
 * POST /api/reports/v1/sign
 * Body SignRequest → SignResponse {receipt, flags}. Re-runs the validators; 409 SIGNOFF_BLOCKED (problem.flags) if blocking items remain.
 * Form reports (report.form set): `form` is required; validate against core/forms.ts formToTemplate(form); attestations must equal FORM_ATTESTATIONS.
 *
 * Checks, in order: a session (Bearer; 401) for the report's tenant and – for a launch session – its
 * patient and episode (403 SESSION_MISMATCH); a launch session that names a clinician may only be used
 * by that clinician (403 SIGNER_MISMATCH); the template / form map (api/resolve-template.ts); a form map
 * must be confirmed with a valid server attestation (409 FORM_NOT_CONFIRMED); typed signature = signer
 * name (case-insensitive, spaces collapsed); statement accepted; every attestation of the template
 * ticked (exact text); then the validators (canSign). The receipt (auth/sign-receipt.ts) is an HMAC
 * over the report fingerprint, signer, time, attestations, the verified form map's hash and the
 * session the approval came through.
 *
 * Owner: forms-engine agent (formerly docgen).
 */
import { formMapSha256 } from "../../auth/attestations";
import { requireSession } from "../../auth/session-token";
import { createReceipt } from "../../auth/sign-receipt";
import { MAX_FORM_REQUEST_BYTES } from "../../config.public";
import { validateReport } from "../../core/validation";
import { SignRequestSchema, type ProblemIssue, type SignResponse } from "../contract";
import { json, logEvent, parseBody, problem, type MedreportHandler } from "../http";
import { requireAttestedForm, resolveTemplate } from "../resolve-template";

const normaliseName = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const normaliseHcpc = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").toUpperCase();

export const handleSign: MedreportHandler = async (req) => {
  // Approval is an authenticated act: who approved is recorded from the session, not just typed.
  const claims = requireSession(req);
  const parsed = await parseBody(req, SignRequestSchema, { maxBytes: MAX_FORM_REQUEST_BYTES });
  if (!parsed.ok) return parsed.response;
  const { report, signer, typedSignature, statementAccepted, attestations, form } = parsed.data;

  const ref = report.episodeRef;
  if (
    claims.tenantId !== report.tenantId ||
    (claims.kind === "launch" &&
      (claims.connectorId !== ref.connectorId || claims.patientId !== ref.patientId || claims.episodeId !== ref.episodeId))
  ) {
    return problem(403, "This session does not cover this report", {
      code: "SESSION_MISMATCH",
      detail: "You opened a different patient from the clinic system. Open this patient from the clinic system, or reload the page, and approve again.",
    });
  }
  if (claims.kind === "launch" && claims.clinician && normaliseHcpc(claims.clinician.hcpc) !== normaliseHcpc(signer.hcpc)) {
    return problem(403, "Approve as yourself", {
      code: "SIGNER_MISMATCH",
      detail: `The clinic system opened this report for ${claims.clinician.name} (HCPC ${claims.clinician.hcpc}). Only they can approve it from this session; another clinician must open the patient from the clinic system themselves.`,
    });
  }

  const resolved = resolveTemplate({ templateId: report.templateId, form, reportForm: report.form, path: "report.templateId" });
  if (!resolved.ok) return resolved.response;
  const { template } = resolved;

  if (resolved.form) {
    const unconfirmed = requireAttestedForm(resolved.form);
    if (unconfirmed) return unconfirmed;
  }

  const issues: ProblemIssue[] = [];
  if (normaliseName(typedSignature) !== normaliseName(signer.name)) {
    issues.push({ path: "typedSignature", message: "Type your name exactly as it appears in the name field to sign." });
  }
  if (!statementAccepted) issues.push({ path: "statementAccepted", message: "Confirm the statement before approving." });
  const missing = template.attestations.filter((a) => !attestations.includes(a));
  missing.forEach((a) => issues.push({ path: "attestations", message: `Tick: “${a}”` }));
  if (issues.length > 0) return problem(422, "The approval is incomplete", { code: "VALIDATION_FAILED", issues });

  const started = Date.now();
  const result = validateReport(report, template);
  if (!result.canSign) {
    logEvent("sign_blocked", { template: template.id, blocking: result.blocking.length, ms: Date.now() - started });
    return problem(409, "Blocking items remain", {
      code: "SIGNOFF_BLOCKED",
      detail: `${result.blocking.length} item${result.blocking.length === 1 ? "" : "s"} must be resolved before approval.`,
      flags: result.blocking,
    });
  }

  const receipt = await createReceipt({
    report,
    signer,
    statementAccepted: true,
    attestations: [...template.attestations],
    ...(resolved.form ? { formMapSha256: formMapSha256(resolved.form) } : {}),
    approvedVia: { kind: claims.kind, sid: claims.sid, ...(claims.clinician ? { clinician: claims.clinician } : {}) },
  });
  const body: SignResponse = { receipt, flags: result.flags };
  logEvent("sign", { template: template.id, report: report.id, flags: result.flags.length, form: Boolean(resolved.form), ms: Date.now() - started });
  return json(body);
};
