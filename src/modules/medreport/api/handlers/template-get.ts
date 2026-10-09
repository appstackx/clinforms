import "server-only";

/**
 * GET /api/reports/v1/templates/[id] → TemplateGetResponse {template} (404 NOT_FOUND).
 *
 * Owner: forms-engine agent (formerly docgen). (Baseline implementation by the foundation.)
 */
import { getTemplate } from "../../templates/registry";
import type { TemplateGetResponse } from "../contract";
import { json, problem, type MedreportHandler } from "../http";

export const handleTemplateGet: MedreportHandler = async (_req, ctx) => {
  const template = getTemplate(ctx.params.id ?? "");
  if (!template) return problem(404, "Template not found", { code: "NOT_FOUND" });
  const body: TemplateGetResponse = { template };
  return json(body);
};
