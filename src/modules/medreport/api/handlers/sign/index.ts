import "server-only";

/**
 * POST /api/reports/v1/sign
 * Body SignRequest → SignResponse {receipt, flags}. Re-runs the validators; 409 SIGNOFF_BLOCKED (problem.flags) if blocking items remain.
 * Form reports (report.form set): `form` is required; validate against core/forms.ts formToTemplate(form); attestations must equal FORM_ATTESTATIONS.
 *
 * Checks, in order: an actor (auth/actor.ts; 401) of the report's clinic (403 TENANT_MISMATCH) and – for a
 * launch-bound actor – the report's patient and episode (403 SESSION_MISMATCH); WHO signs (below); the
 * template / form map (api/resolve-template.ts); a form map must be the clinic's and confirmed with a valid
 * server attestation (409 FORM_NOT_CONFIRMED); typed signature = signer name (case-insensitive, spaces
 * collapsed); statement accepted; every attestation of the template ticked (exact text); then the
 * validators (canSign). The receipt (auth/sign-receipt.ts) is an HMAC over the report fingerprint, signer,
 * time, attestations, the verified form map's hash and the session the approval came through.
 *
 * Who signs (wave 2):
 * - a clinic's signed-in member: the signer IS the member – name from the account, HCPC number and job
 *   title from the member profile – never the body's `signer`. Allowed for owner / admin / clinician with an
 *   HCPC number and "may sign" (403 SIGNER_NOT_ALLOWED otherwise; staff never approve). A body `signer`
 *   with another HCPC number is 403 SIGNER_MISMATCH (approve as yourself). A launch from the clinic system
 *   for another clinician is 403 SIGNER_MISMATCH too. approvedVia {kind "user", sid = sign-in session,
 *   userId, launchSid?}. Written to the clinic's audit trail.
 * - the public demo: the body's `signer` (fictional clinicians); a launch session that names a clinician
 *   may only be used by that clinician (403 SIGNER_MISMATCH); approvedVia {kind "launch" | "demo", sid}.
 * - (fix wave 2) a clinic's member never approves drafted answers that speak in ANOTHER clinician's first
 *   person (report.author ≠ the signer and an unedited drafted answer says "I …"): 409 SIGNER_NOT_AUTHOR with
 *   the questions to edit (core/voice.ts otherClinicianVoice). The demo is unchanged.
 * - (fix round 1, B0-1) every approval: a drafted answer that says "I" / "my" while citing another clinician's note is
 *   a blocking OTHER_CLINICIAN_VOICE flag (core/validation/voice.ts), so canSign refuses it (409 SIGNOFF_BLOCKED);
 *   on a report with no author, a member's approval is refused the same way against the signer (409 SIGNER_NOT_AUTHOR).
 * - (10/2026) DEMO clinics (core/demo-clinic.ts; ClinicProfile.demoClinic, read on the server): a member whose
 *   signing details hold a made-up PH-DEMO-NN number approves with it exactly like a real clinician does. In ANY
 *   OTHER clinic such a number never approves: 403 DEMO_NUMBER_NOT_ALLOWED, checked after every other check so the
 *   existing refusals read as before (a clinic that was a demo clinic and is real again; the members page already
 *   refuses to save one there). The audit row of a demo clinic's approval says
 *   so (demoClinic, and the made-up number when one was used – never a real registration number). The public demo
 *   (`/reports`, fictional signer from the body) is unchanged.
 *
 * Usage (25/10/2026): a clinic's approval is counted (api/usage.ts recordUsage): the report's first approval, and – when
 * nothing was drafted for it – it counts towards the clinic's allowance now. Approving the same report again, or an
 * amended version of an approved report (report.amends), never counts again – "amends" is taken only for an approved
 * report of the same patient, episode and form (the server's fingerprint of this report, api/usage.ts usageEpisodeFp);
 * any other "amends" counts as a new report. The public demo never counts.
 *
 * W0.4 module split (bh2): the checks live in sign/checks/ (roles.ts – who signs and the demo number, owner WC;
 * voice.ts – the signer's own voice, WB; issue.ts – the validators, WA1) and the receipt in sign/receipt.ts (WA1);
 * this file runs them in the order above. Owners: docs/bh2-ownership.json.
 *
 * Owner: forms-engine agent (formerly docgen; wave 2 caller rules: API slice).
 */
import { AUDIT_ACTIONS, assertActorEpisode, assertActorTenant, auditActor, macPrefix, requireActor } from "../../../auth/actor";
import { MAX_FORM_REQUEST_BYTES } from "../../../config.public";
import { normaliseDemoHcpc } from "../../../core/demo-clinic";
import { SignRequestSchema, type ProblemIssue, type SignResponse } from "../../contract";
import { json, logEvent, parseBody, problem, type MedreportHandler } from "../../http";
import { requireAttestedForm, resolveTemplate } from "../../resolve-template";
import { recordUsage, usageEpisodeFp, usageEpisodeOfReport } from "../../usage";
import { validationCheck } from "./checks/issue";
import { demoNumberCheck, resolveSigner } from "./checks/roles";
import { voiceRefusal } from "./checks/voice";
import { mintReceipt } from "./receipt";

const normaliseName = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

export const handleSign: MedreportHandler = async (req, _ctx, deps) => {
  // Approval is an authenticated act: who approved is recorded from the sign-in / session, not just typed.
  const actor = await requireActor(req, deps);
  const parsed = await parseBody(req, SignRequestSchema, { maxBytes: MAX_FORM_REQUEST_BYTES });
  if (!parsed.ok) return parsed.response;
  const { report, typedSignature, statementAccepted, attestations, form } = parsed.data;

  assertActorTenant(actor, report.tenantId, "report");
  const ref = report.episodeRef;
  try {
    // A launch-bound actor approves only its own patient's episode (a demo session bound to a connector is
    // not limited here, as before wave 2).
    if (actor.scope) assertActorEpisode(actor, { connectorId: ref.connectorId, patientId: ref.patientId, episodeId: ref.episodeId });
  } catch {
    return problem(403, "This session does not cover this report", {
      code: "SESSION_MISMATCH",
      detail: "You opened a different patient from the clinic system. Open this patient from the clinic system, or reload the page, and approve again.",
    });
  }

  // Who signs.
  const who = resolveSigner(actor, parsed.data.signer);
  if (!who.ok) return who.response;
  const { signer } = who;

  const voice = voiceRefusal(actor, report, signer);
  if (voice) return voice;

  const resolved = resolveTemplate({ templateId: report.templateId, form, reportForm: report.form, path: "report.templateId" });
  if (!resolved.ok) return resolved.response;
  const { template } = resolved;

  if (resolved.form) {
    const unconfirmed = requireAttestedForm(resolved.form, actor.tenantId);
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
  const { result, response: blocked } = validationCheck({ report, template, form: resolved.form, started });
  if (blocked) return blocked;

  const { demoClinic, response: demoRefusal } = await demoNumberCheck({ deps, actor, signer, templateId: template.id, started });
  if (demoRefusal) return demoRefusal;

  const receipt = await mintReceipt({ report, signer, template, form: resolved.form, actor });
  const body: SignResponse = { receipt, flags: result.flags };
  logEvent("sign", { template: template.id, report: report.id, flags: result.flags.length, form: Boolean(resolved.form), via: actor.via, demoClinic, ms: Date.now() - started });
  const demoNumber = demoClinic ? normaliseDemoHcpc(signer.hcpc) : null;
  await auditActor(deps, actor, {
    action: AUDIT_ACTIONS.sign,
    targetType: "report",
    targetId: report.id,
    detail: {
      ...(resolved.form ? { formId: resolved.form.id } : { templateId: template.id }),
      receiptMac: macPrefix(receipt.mac),
      contentSha256: receipt.contentSha256.slice(0, 16),
      flags: result.flags.length,
      // A demo clinic's approval says so; a made-up number is recorded (it identifies nobody), a real one never is.
      ...(demoClinic ? { demoClinic: true, ...(demoNumber ? { demoNumber } : {}) } : {}),
    },
  });
  await recordUsage(deps, actor, {
    kind: "report_approved",
    reportId: report.id,
    ...(report.amends ? { amendsReportId: report.amends.reportId } : {}),
    episodeFp: usageEpisodeFp(actor.tenantId, usageEpisodeOfReport(report)),
  });
  return json(body);
};
