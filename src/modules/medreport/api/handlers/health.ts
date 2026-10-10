import "server-only";

/**
 * GET /api/reports/v1/health → HealthResponse {product, version, aiMode, liveAiAvailable, model, promptVersion,
 * pdfFromWord} (pdfFromWord, fix wave 2: whether a Word form's PDF copy can be made here).
 * Drives the Studio's mode badge. Never reveals whether individual secrets are set beyond liveAiAvailable.
 * promptVersion lists the three frozen prompts: built-in templates · referrer-form answers · form analysis
 * (e.g. "2 · forms-7 · form-analysis-4").
 *
 * Public (no caller needed). Wave 2:
 * - an anonymous caller gets no internals: model is always the neutral engine name ("drafting-service",
 *   whatever the disclosure setting) and promptVersion is empty;
 * - a caller (public-demo session or a clinic's signed-in member) gets the details, and aiMode /
 *   liveAiAvailable for THEM: the demo's passcode-gated live drafting, or the clinic's own
 *   (ai/live-gate.ts liveAvailableFor: deployment can draft + clinic_profile.drafting_enabled).
 *
 * Owner: ai agent. (Baseline implementation by the foundation; wave 2 caller rules: API slice.)
 */
import { PRODUCT } from "../../config.public";
import { aiModel } from "../../config.server";
import { liveAvailableFor } from "../../ai/live-gate";
import { optionalActor } from "../../auth/actor";
import { FORM_ANALYSIS_PROMPT_VERSION } from "../../ai/form-analysis";
import { FORM_DRAFT_PROMPT_VERSION } from "../../ai/form-prompts";
import { PROMPT_VERSION } from "../../ai/prompts";
import { NEUTRAL_ENGINE, publicEngineName } from "../../core/wording";
import { pdfConversionAvailable } from "../../forms/convert";
import type { HealthResponse } from "../contract";
import { json, type MedreportHandler } from "../http";

export const handleHealth: MedreportHandler = async (req, _ctx, deps) => {
  const actor = await optionalActor(req, deps);
  const live = await liveAvailableFor(actor, deps);
  const body: HealthResponse = {
    product: PRODUCT.name,
    version: PRODUCT.version,
    aiMode: live ? "live" : "demo",
    liveAiAvailable: live,
    // Public endpoint behind the Studio's mode badge: the engine is named neutrally while DISCLOSURE is
    // "neutral" (core/wording.ts) – and always for an anonymous caller; the configured model id
    // (MEDREPORT_MODEL) stays server-side.
    model: actor ? (publicEngineName(aiModel()) ?? aiModel()) : NEUTRAL_ENGINE,
    promptVersion: actor ? `${PROMPT_VERSION} · ${FORM_DRAFT_PROMPT_VERSION} · ${FORM_ANALYSIS_PROMPT_VERSION}` : "",
    // Fix wave 2: a Word form's PDF copy needs LibreOffice (forms/convert.ts) – none on a hosted deployment yet.
    pdfFromWord: pdfConversionAvailable(),
  };
  return json(body);
};
