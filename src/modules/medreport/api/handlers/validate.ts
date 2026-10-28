import "server-only";

/**
 * POST /api/reports/v1/validate
 * Body ValidateRequest {report, form?} → ValidateResponse {flags, canSign, blocking}. `form` is required for a
 * form report (report.form set).
 * The bundle travels inside `report.bundleSnapshot`; facts are computed as of the report's creation
 * date. Same validators as the Studio runs in the browser.
 *
 * Wave 2: an actor is required (auth/actor.ts; any role); the report and form must be the actor's clinic's
 * (403 TENANT_MISMATCH).
 *
 * bh2 fix round 1 (WA1; ownership exception – the integrator's file): a body over the validators' budget is refused
 * before any validator runs (413 PAYLOAD_TOO_LARGE – R1T-WA1-03, SEC-1 / SAF-1 defence in depth), and the body is
 * checked as not yet approved – its status and receipt are the client's word (R1T-WA1-04), in the voice its own content
 * gives (the approver, else – for a body that says it is approved – that receipt's signer, else the author), as before.
 *
 * Owner: ai agent.
 */
import { assertActorTenant, requireActor } from "../../auth/actor";
import { validateReport } from "../../core/validation";
import { defaultVoiceOwner } from "../../core/validation/attribution-owner";
import { asNotYetApproved, validationBudgetRefusal } from "./sign/checks/issue";
import { ValidateRequestSchema, type ValidateResponse } from "../contract";
import { json, logEvent, parseBody, type MedreportHandler } from "../http";
import { resolveTemplate } from "../resolve-template";

export const handleValidate: MedreportHandler = async (req, _ctx, deps) => {
  const actor = await requireActor(req, deps);
  const parsed = await parseBody(req, ValidateRequestSchema);
  if (!parsed.ok) return parsed.response;
  const { report, form } = parsed.data;
  const tooLarge = validationBudgetRefusal(report, form);
  if (tooLarge) return tooLarge;
  assertActorTenant(actor, report.tenantId, "report");
  if (form) assertActorTenant(actor, form.tenantId, "form");

  // Built-in template, or formToTemplate(form) for a report that completes a referrer's form.
  const resolved = resolveTemplate({ templateId: report.templateId, form, reportForm: report.form, path: "report.templateId" });
  if (!resolved.ok) return resolved.response;
  const template = resolved.template;

  const started = Date.now();
  const result = validateReport(asNotYetApproved(report), template, { form: resolved.form, voice: { owner: defaultVoiceOwner(report) } });
  const body: ValidateResponse = { flags: result.flags, canSign: result.canSign, blocking: result.blocking };
  logEvent("validate", {
    template: template.id,
    flags: result.flags.length,
    blocking: result.blocking.length,
    canSign: result.canSign,
    ms: Date.now() - started,
  });
  return json(body);
};
