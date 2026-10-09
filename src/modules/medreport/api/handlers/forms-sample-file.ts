import "server-only";

/**
 * GET /api/reports/v1/forms/samples/[id]/file → the sample's original file (.docx or .pdf) as a
 * download (404 NOT_FOUND for an unknown ID).
 *
 * Owner: forms-engine agent.
 */
import { getSampleForm } from "../../forms/samples/registry";
import { fileResponse, problem, type MedreportHandler } from "../http";

export const handleFormSampleFile: MedreportHandler = async (_req, ctx) => {
  const sample = getSampleForm(ctx.params.id ?? "");
  if (!sample) return problem(404, "Sample form not found", { code: "NOT_FOUND", detail: "There is no bundled sample form with that ID." });
  const bytes = await sample.loadFile();
  return fileResponse(bytes, { contentType: sample.mimeType, fileName: sample.fileName });
};
