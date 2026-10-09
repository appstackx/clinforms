import "server-only";

/**
 * GET /api/reports/v1/templates → TemplatesListResponse {templates}.
 *
 * Owner: forms-engine agent (formerly docgen). (Baseline implementation by the foundation.)
 */
import { listTemplates } from "../../templates/registry";
import type { TemplatesListResponse } from "../contract";
import { json, type MedreportHandler } from "../http";

export const handleTemplatesList: MedreportHandler = async () => {
  const body: TemplatesListResponse = { templates: listTemplates() };
  return json(body);
};
