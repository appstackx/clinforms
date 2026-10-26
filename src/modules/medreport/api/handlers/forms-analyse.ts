import "server-only";

/**
 * POST /api/reports/v1/forms/analyse   (route maxDuration = 60)
 * Body FormsAnalyseRequest {fileBase64, fileName, referrer?, title?, prefer?, effort?}
 *   → FormsAnalyseResponse {form (status "proposed"), outlineSummary, trace}.
 *
 * 1. forms/file.ts decodeFormFile() (413 / 422 FORM_INVALID), type from the bytes. An RTF file is converted
 *    to Word there first (10/2026; `convertRtf`), and the conversion's notes for staff (what was left out)
 *    are added to the proposed map's analysis warnings, with a "Converted the RTF file to Word" trace step.
 *    Mail-merge fields (10/2026, forms/merge-scan.ts) left in any file are recorded on the map
 *    (analysis.mergeFields) with a warning: approval is blocked until each is answered or replaced.
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
 * Wave 2: an actor is required (auth/actor.ts; any role). The proposed map is stamped with the actor's
 * clinic (form.tenantId). Live: the same gate as /drafts (ai/live-gate.ts chooseAiModeForActor – the
 * passcode for the public demo, the clinic's own limits for a member); the extra parallel calls of a long
 * form count against the same limits. A clinic's live analysis is written to its audit trail.
 *
 * Usage (25/10/2026): a clinic's form reading is counted (api/usage.ts recordUsage): every reading, its live calls and
 * their tokens, and a live call that failed (estimated cost on the platform page only). The public demo never counts.
 *
 * bh2 WA2: a form converted from RTF records the converter's version (analysis.convertedWith = core/rtf
 * RTF_CONVERTER_VERSION, plan WA2 design 7 – the stamp WE's re-load checks), and a proposed map larger than the request
 * caps (forms/request-caps.ts: 400 questions, 20 sharing a place) is refused 422 FORM_TOO_COMPLEX – it could never be
 * confirmed or filled.
 *
 * Owner: WA2 (forms engine) – docs/bh2-ownership.json.
 */
import { analyseFormFile } from "../../ai/analyse-form";
import { chooseAiModeForActor, takeLiveCallsFor } from "../../ai/live-gate";
import { AUDIT_ACTIONS, auditActor, requireActor } from "../../auth/actor";
import { assertClinicMayCreate } from "../../auth/clinic-access";
import { DraftGenerationError } from "../../ai/types";
import { MAX_FORM_REQUEST_BYTES } from "../../config.public";
import { decodeFormFile } from "../../forms/file";
import { formRequestCapIssues } from "../../forms/request-caps";
import { RTF_CONVERTER_VERSION } from "../../core/rtf";
import { findFormMergeFields } from "../../forms/merge-scan";
import { listMergeTokens } from "../../core/merge-fields";
import { FormsAnalyseRequestSchema, type FormsAnalyseResponse } from "../contract";
import { publicEngineName, WORDING } from "../../core/wording";
import { json, logEvent, parseBody, problem, type MedreportHandler } from "../http";
import { recordUsage, usageOfError } from "../usage";

export const handleFormsAnalyse: MedreportHandler = async (req, _ctx, deps) => {
  const actor = await requireActor(req, deps);
  await assertClinicMayCreate(actor, deps, "analyse"); // 10/2026: nothing new once a clinic's trial has ended
  const parsed = await parseBody(req, FormsAnalyseRequestSchema, { maxBytes: MAX_FORM_REQUEST_BYTES });
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const file = decodeFormFile(body.fileBase64, { convertRtf: true }); // throws HttpError (413 / 422)

  const gate = await chooseAiModeForActor(req, actor, deps, body.prefer, {
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
      reserveExtraLiveCalls: async (n) => (await takeLiveCallsFor(actor, deps, n)).ok,
      tenantId: actor.tenantId,
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
    const live = result.form.analysis.mode === "live";
    const failure = result.liveFailure;
    const countedUsage = live ? usage : failure?.usage;
    const countedModel = live ? result.form.analysis.model : failure?.model;
    await recordUsage(deps, actor, {
      kind: "form_read",
      read: true,
      liveCalls: live ? (result.live?.chunks ?? 1) : 0,
      failedCalls: failure ? 1 : 0,
      ...(countedModel ? { model: countedModel } : {}),
      ...(countedUsage ? { usage: countedUsage } : {}),
    });
    if (live) {
      await auditActor(deps, actor, {
        action: AUDIT_ACTIONS.formAnalyseLive,
        targetType: "form",
        targetId: result.form.id,
        detail: {
          kind: result.form.kind,
          fields: result.form.fields.length,
          chunks: result.live?.chunks ?? null,
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
        },
      });
    }
    // The map is stored in the forms library and shown in the Studio: the engine is named neutrally
    // (core/wording.ts); the real model id stays in the log line above.
    const analysis = { ...result.form.analysis, model: publicEngineName(result.form.analysis.model) };
    let trace = result.trace;
    const mergeFields = await findFormMergeFields(file);
    if (mergeFields.length > 0) {
      analysis.mergeFields = mergeFields;
      const fixed = mergeFields.filter((m) => m.fixed);
      analysis.warnings = [
        `This form contains ${mergeFields.length === 1 ? "a mail-merge field" : `${mergeFields.length} mail-merge fields`} (${listMergeTokens(mergeFields.map((m) => m.text))}). A form is never approved with one left on it: check that a question replaces each one${fixed.length ? `; ${fixed.length === 1 ? "one is" : `${fixed.length} are`} in ${listMergeTokens(fixed.map((m) => m.where), 2)}, which cannot be completed here – ask the referrer for the form without ${fixed.length === 1 ? "it" : "them"}` : ""}.`,
        ...analysis.warnings,
      ];
      logEvent("form_merge_fields", { form: result.form.id, count: mergeFields.length, fixed: fixed.length });
    }
    if (file.convertedFrom) {
      // An RTF upload converted to Word (forms/file.ts): staff see what the conversion left out, and the map records which
      // converter made its Word file (plan WA2 design 7).
      analysis.convertedWith = RTF_CONVERTER_VERSION;
      const notes = file.convertedFrom.notes;
      analysis.warnings = [...notes, ...analysis.warnings.filter((w) => !notes.includes(w))];
      trace = [
        {
          label: "Converted the RTF file to Word",
          status: notes.length ? "warning" : "ok",
          ms: file.convertedFrom.ms,
          detail: notes.length ? `${notes.length} note${notes.length === 1 ? "" : "s"} below` : "Text, tables and tick boxes carried over",
        },
        ...trace,
      ];
      logEvent("form_rtf_converted", { form: result.form.id, rtfBytes: file.convertedFrom.sizeBytes, bytes: file.sizeBytes, notes: notes.length, ms: file.convertedFrom.ms });
    }
    const capIssues = formRequestCapIssues(result.form);
    if (capIssues.length > 0) return problem(422, "This form is too complex to fill", { code: "FORM_TOO_COMPLEX", detail: capIssues[0].message, issues: capIssues });
    const response: FormsAnalyseResponse = { form: { ...result.form, analysis }, outlineSummary: result.outlineSummary, trace };
    return json(response);
  } catch (err) {
    if (err instanceof DraftGenerationError) {
      // A live reading that failed after the drafting service answered still cost tokens.
      if (gate.mode === "live" && err.code !== "LIVE_AI_UNAVAILABLE") {
        await recordUsage(deps, actor, { kind: "form_read", read: false, liveCalls: 0, failedCalls: 1, ...usageOfError(err) });
      }
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
