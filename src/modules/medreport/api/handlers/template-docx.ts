import "server-only";

/**
 * GET /api/reports/v1/templates/[id]/docx
 * → the tagged Word template as a .docx download (404 NOT_FOUND). Serves the built-in report templates
 * (by template ID) and the sample "upload your own template" files (templates/extensions.ts).
 *
 * Owner: forms-engine agent (formerly docgen).
 */
import { PRODUCT } from "../../config.public";
import { getBuiltinTemplateDocx } from "../../docgen/docx";
import { getSampleTemplateUpload } from "../../templates/extensions";
import { getTemplate } from "../../templates/registry";
import { CONTENT_TYPES } from "../contract";
import { fileResponse, problem, type MedreportHandler } from "../http";

export const handleTemplateDocx: MedreportHandler = async (_req, ctx) => {
  const id = ctx.params.id ?? "";
  const template = getTemplate(id);
  const sample = template ? undefined : getSampleTemplateUpload(id);
  const docxId = template?.docxTemplateId ?? sample?.docxTemplateId;
  const bytes = docxId ? getBuiltinTemplateDocx(docxId) : null;
  if (!bytes) return problem(404, "Template not found", { code: "NOT_FOUND", detail: "There is no Word template with that ID." });
  const fileName = sample?.fileName ?? `${PRODUCT.name.replace(/[^A-Za-z0-9]+/g, "-")}_${(template?.documentTitle ?? id).replace(/[^A-Za-z0-9]+/g, "-")}_template.docx`;
  return fileResponse(bytes, { contentType: CONTENT_TYPES.docx, fileName });
};
