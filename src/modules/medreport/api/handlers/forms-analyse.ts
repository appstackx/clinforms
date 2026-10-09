import "server-only";

/**
 * POST /api/reports/v1/forms/analyse   (route maxDuration = 60)
 * Body FormsAnalyseRequest {fileBase64, fileName, referrer?, title?, prefer?, effort?}
 *   → FormsAnalyseResponse {form (status "proposed"), outlineSummary, trace}.
 *
 * 1. forms/file.ts decodeFormFile() (413 / 422 FORM_INVALID), type from the bytes.
 * 2. Deterministic parsing: forms/docx-outline.ts buildDocxOutline() or forms/pdf-outline.ts readPdfForm().
 * 3. Mapping (ai/analyse-form.ts): live Claude (passcode + rate cap, same rules as /drafts; form text is
 *    DATA, never instructions; long forms in parallel chunks), else the recorded analysis for a bundled
 *    sample (matched by SHA-256, mode "demo_recorded") or its pre-written map, else rules only (mode
 *    "rules", low confidence). If live Claude fails part-way, rules take over and the trace says so.
 * 4. Post-validation: every field's anchor exists in the outline, no shared answer spaces, tick boxes
 *    match their options; identifiers are always "registration" (code), opinions "clinician_opinion".
 *
 * Errors: 413 / 422 FORM_INVALID, PASSCODE_*, RATE_LIMITED, LIVE_AI_UNAVAILABLE (as /drafts), 501 while
 * a forms-engine parser is not built. Logs IDs, sizes, timings and token counts only – never form or
 * note text.
 *
 * Owner: ai agent.
 */
import { analyseFormFile } from "../../ai/analyse-form";
import { chooseAiMode } from "../../ai/live-gate";
import { takeLiveCalls } from "../../auth/passcode";
import { DraftGenerationError } from "../../ai/types";
import { MAX_FORM_REQUEST_BYTES } from "../../config.public";
import { decodeFormFile } from "../../forms/file";
import { FormsAnalyseRequestSchema, type FormsAnalyseResponse } from "../contract";
import { publicEngineName, WORDING } from "../../core/wording";
import { json, logEvent, parseBody, problem, type MedreportHandler } from "../http";

export const handleFormsAnalyse: MedreportHandler = async (req) => {
  const parsed = await parseBody(req, FormsAnalyseRequestSchema, { maxBytes: MAX_FORM_REQUEST_BYTES });
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const file = decodeFormFile(body.fileBase64); // throws HttpError (413 / 422)

  const gate = chooseAiMode(req, body.prefer, {
    action: WORDING.server.gateActionAnalyse,
    alternative: WORDING.server.analyseAlternative,
    rateTitle: "Too many live form analyses",
  });
  if (!gate.ok) return gate.response;

  const started = Date.now();
  try {
    const result = await analyseFormFile({
      file,
      fileName: body.fileName,
      referrer: body.referrer,
      title: body.title,
      mode: gate.mode,
      effort: body.effort,
      signal: req.signal,
      // Each parallel chunk counts against the live cap, not just the request.
      reserveExtraLiveCalls: (n) => takeLiveCalls(n).ok,
    });
    const usage = result.form.analysis.usage;
    logEvent("form_analysed", {
      form: result.form.id,
      kind: result.form.kind,
      bytes: file.sizeBytes,
      mode: result.form.analysis.mode,
      model: result.form.analysis.model,
      chunks: result.live?.chunks,
      fields: result.form.fields.length,
      dropped: result.dropped,
      repaired: result.repaired,
      ms: Date.now() - started,
      aiMs: result.form.analysis.durationMs,
      inTok: usage?.inputTokens,
      outTok: usage?.outputTokens,
      cacheReadTok: usage?.cacheReadInputTokens,
      cacheWriteTok: usage?.cacheCreationInputTokens,
    });
    // The map is stored in the forms library and shown in the Studio: the engine is named neutrally
    // (core/wording.ts); the real model id stays in the log line above.
    const analysis = { ...result.form.analysis, model: publicEngineName(result.form.analysis.model) };
    const response: FormsAnalyseResponse = { form: { ...result.form, analysis }, outlineSummary: result.outlineSummary, trace: result.trace };
    return json(response);
  } catch (err) {
    if (err instanceof DraftGenerationError) {
      logEvent("form_analysis_failed", { kind: file.mimeType, bytes: file.sizeBytes, code: err.code, ms: Date.now() - started });
      return problem(err.code === "LIVE_AI_UNAVAILABLE" ? 503 : 502, "Form analysis failed", {
        code: err.code,
        detail: err.message,
        retryable: err.retryable,
      });
    }
    throw err;
  }
};
