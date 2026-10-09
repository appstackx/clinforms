import "server-only";

/**
 * GET /api/reports/v1/health → HealthResponse {product, version, aiMode, liveAiAvailable, model, promptVersion}.
 * Drives the Studio's mode badge. Never reveals whether individual secrets are set beyond liveAiAvailable.
 * promptVersion lists the three frozen prompts: built-in templates · referrer-form answers · form analysis
 * (e.g. "2 · forms-7 · form-analysis-3").
 *
 * Owner: ai agent. (Baseline implementation by the foundation.)
 */
import { PRODUCT } from "../../config.public";
import { aiModel, liveAiAvailable, resolveAiMode } from "../../config.server";
import { FORM_ANALYSIS_PROMPT_VERSION } from "../../ai/form-analysis";
import { FORM_DRAFT_PROMPT_VERSION } from "../../ai/form-prompts";
import { PROMPT_VERSION } from "../../ai/prompts";
import { publicEngineName } from "../../core/wording";
import type { HealthResponse } from "../contract";
import { json, type MedreportHandler } from "../http";

export const handleHealth: MedreportHandler = async () => {
  const body: HealthResponse = {
    product: PRODUCT.name,
    version: PRODUCT.version,
    aiMode: resolveAiMode(),
    liveAiAvailable: liveAiAvailable(),
    // Public endpoint behind the Studio's mode badge: the engine is named neutrally while DISCLOSURE is
    // "neutral" (core/wording.ts); the configured model id (MEDREPORT_MODEL) stays server-side.
    model: publicEngineName(aiModel()) ?? aiModel(),
    promptVersion: `${PROMPT_VERSION} · ${FORM_DRAFT_PROMPT_VERSION} · ${FORM_ANALYSIS_PROMPT_VERSION}`,
  };
  return json(body);
};
