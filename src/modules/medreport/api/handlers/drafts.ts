import "server-only";

/**
 * POST /api/reports/v1/drafts   (route maxDuration = 60; the SDK timeout is ~10 s below it)
 * Body DraftsRequest {templateId, bundle, instructingParty, sectionKeys (1–2), prefer?, effort?, form?}
 *   → DraftsResponse {sections, gaps, flags, generation}.
 *
 * Referrer forms (Revision 2): with `form` (templateId "form:<id>"), sectionKeys are 1–4 field IDs
 * whose fill source is notes_narrative or clinician_opinion; the form must be confirmed with a valid
 * server attestation (409 FORM_NOT_CONFIRMED otherwise – auth/attestations.ts). Drafted sections carry `fieldId` and, for yes/no, tick box, choice,
 * date and number questions, the structured `answer`.
 *
 * Mode:
 * - prefer "demo"            → demo draft (404 NO_DEMO_DRAFT if none).
 * - prefer "live"            → live; 503 LIVE_AI_UNAVAILABLE if this deployment cannot run live AI.
 * - prefer "auto" (default)  → live when live AI is available AND an x-medreport-passcode header is
 *                              sent; otherwise demo.
 * - A live call that fails with AI_ERROR / AI_TIMEOUT falls back to the recorded answers for this
 *   exact patient and form when they exist (badged as recorded, never as live).
 * Live always needs a valid x-medreport-passcode (401 PASSCODE_REQUIRED / PASSCODE_INVALID) and a
 * free slot in the per-instance cap (429 RATE_LIMITED with retry-after).
 *
 * Draft failures map to problem+json with `code` and `retryable` (the Studio offers Retry / Use demo
 * draft): AI_REFUSAL 502, AI_MAX_TOKENS 502, AI_ERROR 502, AI_TIMEOUT 504, LIVE_AI_UNAVAILABLE 503,
 * NO_DEMO_DRAFT 404.
 *
 * Logs IDs, timings and token counts only.
 *
 * Owner: ai agent.
 */
import { assembleDraft } from "../../ai/assemble";
import { hasDemoDraft } from "../../ai/draft-demo";
import { DraftGenerationError, generateDraftGroup, type DraftErrorCode } from "../../ai/generate";
import { chooseAiMode } from "../../ai/live-gate";
import { MAX_SECTIONS_PER_DRAFT } from "../../config.public";
import { computeFacts } from "../../core/computed-facts";
import { formIdFromTemplateId } from "../../core/forms";
import { isDraftableKind } from "../../core/report-factory";
import type { FormDefinition } from "../../core/types";
import { getTemplate } from "../../templates/registry";
import { DraftsRequestSchema, type ProblemIssue } from "../contract";
import { publicEngineName, WORDING } from "../../core/wording";
import { json, logEvent, parseBody, problem, type MedreportHandler } from "../http";
import { requireAttestedForm, resolveTemplate } from "../resolve-template";

/** /drafts bodies carry a whole bundle; allow up to the platform limit. */
const MAX_DRAFT_BODY_BYTES = 4_000_000;

const ERROR_STATUS: Record<DraftErrorCode, number> = {
  AI_REFUSAL: 502,
  AI_MAX_TOKENS: 502,
  AI_ERROR: 502,
  AI_TIMEOUT: 504,
  LIVE_AI_UNAVAILABLE: 503,
  NO_DEMO_DRAFT: 404,
};

const ERROR_TITLE: Record<DraftErrorCode, string> = {
  AI_REFUSAL: WORDING.server.refusalTitle,
  AI_MAX_TOKENS: "The draft was cut off",
  AI_ERROR: "Drafting failed",
  AI_TIMEOUT: "Drafting timed out",
  LIVE_AI_UNAVAILABLE: WORDING.server.liveUnavailableTitle,
  NO_DEMO_DRAFT: "No demo draft for this case",
};

export const handleDrafts: MedreportHandler = async (req) => {
  const parsed = await parseBody(req, DraftsRequestSchema, { maxBytes: MAX_DRAFT_BODY_BYTES });
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Built-in template, or formToTemplate(form) for a report that completes a referrer's form.
  let template;
  let form: FormDefinition | undefined;
  if (formIdFromTemplateId(body.templateId) !== null) {
    const resolved = resolveTemplate({ templateId: body.templateId, form: body.form });
    if (!resolved.ok) return resolved.response;
    template = resolved.template;
    form = resolved.form ?? undefined;
    // Confirmed AND attested by the server for exactly this map (never just the browser's claim).
    const unconfirmed = form ? requireAttestedForm(form) : null;
    if (unconfirmed) return unconfirmed;
  } else {
    template = getTemplate(body.templateId);
    if (!template) {
      return problem(404, "Template not found", { code: "NOT_FOUND", detail: `No template "${body.templateId}".` });
    }
  }

  // Section keys: draftable sections of this template, no duplicates.
  const issues: ProblemIssue[] = [];
  body.sectionKeys.forEach((key, i) => {
    const spec = template.sections.find((s) => s.key === key);
    if (!spec) issues.push({ path: `sectionKeys.${i}`, message: `"${key}" is not a section of ${template.id}.` });
    else if (!isDraftableKind(spec.kind)) issues.push({ path: `sectionKeys.${i}`, message: `"${key}" is filled from the records, not drafted.` });
    if (body.sectionKeys.indexOf(key) !== i) issues.push({ path: `sectionKeys.${i}`, message: `"${key}" is listed twice.` });
  });
  if (!form && body.sectionKeys.length > MAX_SECTIONS_PER_DRAFT) {
    issues.push({ path: "sectionKeys", message: `Draft at most ${MAX_SECTIONS_PER_DRAFT} sections of a built-in template per call.` });
  }
  if (issues.length) return problem(422, "Request body is invalid", { code: "VALIDATION_FAILED", issues });

  // Choose the mode (passcode + rate cap for live).
  const gate = chooseAiMode(req, body.prefer, {
    action: WORDING.server.gateActionDraft,
    alternative: form ? "use the demo answers" : "use the demo draft",
    rateTitle: "Too many live drafts",
  });
  if (!gate.ok) return gate.response;
  const mode = gate.mode;

  const computedFacts = computeFacts(body.bundle);
  const started = Date.now();
  const run = (m: typeof mode) =>
    generateDraftGroup({
      template,
      bundle: body.bundle,
      instructingParty: body.instructingParty,
      sectionKeys: body.sectionKeys,
      computedFacts,
      mode: m,
      effort: body.effort,
      signal: req.signal,
      form,
      ...(form && body.author ? { author: body.author } : {}),
    });
  try {
    let result;
    try {
      result = await run(mode);
    } catch (err) {
      // Live Claude unreachable or failing (outage, timeout, account limits): when this deployment holds
      // recorded answers for this exact patient and form, return those – badged as recorded, never as live.
      const fallback =
        mode === "live" &&
        err instanceof DraftGenerationError &&
        (err.code === "AI_ERROR" || err.code === "AI_TIMEOUT") &&
        hasDemoDraft(body.bundle, template.id, form);
      if (!fallback) throw err;
      logEvent("draft_live_fallback", { template: template.id, sections: body.sectionKeys.join("+"), code: err.code, ms: Date.now() - started });
      result = await run("demo");
    }
    const response = assembleDraft({
      template,
      bundle: body.bundle,
      instructingParty: body.instructingParty,
      sectionKeys: body.sectionKeys,
      computedFacts,
      output: result.output,
      meta: result.meta,
      form,
    });
    const usage = result.meta.usage;
    logEvent("draft_ok", {
      template: template.id,
      form: form ? form.id : undefined,
      sections: body.sectionKeys.join("+"),
      mode: result.meta.mode,
      model: result.meta.model,
      effort: result.meta.effort,
      ms: Date.now() - started,
      aiMs: result.meta.durationMs,
      inTok: usage?.inputTokens,
      outTok: usage?.outputTokens,
      cacheReadTok: usage?.cacheReadInputTokens,
      cacheWriteTok: usage?.cacheCreationInputTokens,
      paragraphs: response.sections.reduce((n, s) => n + s.paragraphs.length, 0),
      gaps: response.gaps.length,
      blocking: response.flags.filter((f) => f.severity === "blocking").length,
    });
    // The Studio stores and shows generation meta (and a clinic can export it): the engine is named
    // neutrally (core/wording.ts); the real model id stays in the log line above.
    return json({ ...response, generation: { ...response.generation, model: publicEngineName(response.generation.model) } });
  } catch (err) {
    if (err instanceof DraftGenerationError) {
      logEvent("draft_failed", {
        template: template.id,
        sections: body.sectionKeys.join("+"),
        mode,
        code: err.code,
        ms: Date.now() - started,
      });
      return problem(ERROR_STATUS[err.code], ERROR_TITLE[err.code], {
        code: err.code,
        detail: err.message,
        retryable: err.retryable,
      });
    }
    throw err;
  }
};
