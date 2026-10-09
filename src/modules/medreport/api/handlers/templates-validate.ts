import "server-only";

/**
 * POST /api/reports/v1/templates/validate
 * Body TemplatesValidateRequest {fileName, docxBase64} (≤ MAX_TEMPLATE_DOCX_BYTES) → TemplatesValidateResponse with plain-English TemplateErrors.
 *
 * Wave 2: an actor is required (auth/actor.ts; any role) – it parses an uploaded file.
 *
 * Owner: forms-engine agent (formerly docgen).
 */
import { requireActor } from "../../auth/actor";
import { MAX_TEMPLATE_DOCX_BYTES } from "../../config.public";
import { validateDocxTemplate } from "../../docgen/docx-validate";
import { TemplatesValidateRequestSchema, type TemplatesValidateResponse } from "../contract";
import { json, logEvent, parseBody, problem, type MedreportHandler } from "../http";

export const handleTemplatesValidate: MedreportHandler = async (req, _ctx, deps) => {
  await requireActor(req, deps);
  const parsed = await parseBody(req, TemplatesValidateRequestSchema);
  if (!parsed.ok) return parsed.response;
  const b64 = parsed.data.docxBase64.replace(/^data:[^,]*,/, "");
  if (Math.floor((b64.length * 3) / 4) > MAX_TEMPLATE_DOCX_BYTES + 3) {
    return problem(413, "Template too large", { code: "PAYLOAD_TOO_LARGE", detail: `Word templates can be up to ${MAX_TEMPLATE_DOCX_BYTES / (1024 * 1024)} MB.` });
  }
  const started = Date.now();
  const body: TemplatesValidateResponse = validateDocxTemplate(new Uint8Array(Buffer.from(b64, "base64")));
  logEvent("templates_validate", { ok: body.ok, errors: body.errors.length, tags: body.tags.length, ms: Date.now() - started });
  return json(body);
};
