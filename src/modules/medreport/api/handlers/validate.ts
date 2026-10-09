import "server-only";

/**
 * POST /api/reports/v1/validate
 * Body ValidateRequest {report, form?} → ValidateResponse {flags, canSign, blocking}. `form` is required for a
 * form report (report.form set).
 * The bundle travels inside `report.bundleSnapshot`; facts are computed as of the report's creation
 * date. Same validators as the Studio runs in the browser.
 *
 * Owner: ai agent.
 */
import { validateReport } from "../../core/validation";
import { ValidateRequestSchema, type ValidateResponse } from "../contract";
import { json, logEvent, parseBody, type MedreportHandler } from "../http";
import { resolveTemplate } from "../resolve-template";

export const handleValidate: MedreportHandler = async (req) => {
  const parsed = await parseBody(req, ValidateRequestSchema);
  if (!parsed.ok) return parsed.response;
  const { report, form } = parsed.data;

  // Built-in template, or formToTemplate(form) for a report that completes a referrer's form.
  const resolved = resolveTemplate({ templateId: report.templateId, form, reportForm: report.form, path: "report.templateId" });
  if (!resolved.ok) return resolved.response;
  const template = resolved.template;

  const started = Date.now();
  const result = validateReport(report, template);
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
