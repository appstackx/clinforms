import "server-only";

/**
 * Form analysis end to end (POST /forms/analyse and scripts/medreport/record-form-analyses.ts):
 *
 * 1. Deterministic parsing by the forms engine: buildDocxOutline() (Word) or readPdfForm() (PDF,
 *    classified as fillable or flat).
 * 2. The proposed map:
 *    - live: Claude (form-analysis.ts, chunks in parallel) – if Claude fails, the stored map of this
 *      exact file (recorded analysis / pre-written sample map) takes over, else rules; either says so;
 *    - demo: the recorded Claude analysis of this exact file (SHA-256) – or the pre-written map of a
 *      local demonstration form (ai/demo-assets.ts) – else the bundled sample's pre-written map, else
 *      rules only (no AI call). A stored map keeps its own mode ("demo_recorded" / "demo_prewritten").
 * 3. Deterministic post-validation (form-postvalidate.ts): anchors exist, no shared answer spaces,
 *    tick boxes match, identifiers by code, opinions for the clinician, IDs in document order.
 * 4. A FormDefinition with status "proposed" – staff check it and confirm it once. A local
 *    demonstration form (ai/demo-assets.ts) always carries its demonstration footer (demoNotice),
 *    whichever way it was mapped.
 *
 * Logs nothing itself; the handler logs IDs, sizes, timings and token counts only.
 *
 * Owner: ai agent.
 */
import type { FormAnalysisStep, FormOutlineSummary } from "../api/contract";
import { DEMO_TENANT_ID } from "../config.public";
import { createId } from "../core/ids";
import { REFERRER_TO_BE_CONFIRMED } from "../core/labels";
import type { AiEffort, FormAnalysis, FormDefinition, FormField, ReferrerInfo, ReferrerType, TenantId } from "../core/types";
import { publicEngineName, WORDING } from "../core/wording";
import { buildDocxOutline } from "../forms/docx-outline";
import type { DecodedFormFile } from "../forms/file";
import { readPdfForm } from "../forms/pdf-outline";
import { findSampleBySha256, listSampleForms } from "../forms/samples/registry";
import type { ClaudeClient } from "./claude";
import { DEFAULT_ANALYSIS_EFFORT, FORM_ANALYSIS_PROMPT_VERSION, analyseFormLive, type AnalyseFormLiveResult } from "./form-analysis";
import type { AnalysisOutput } from "./form-analysis-schema";
import { asksForBlockCapitals } from "./form-boxes";
import { chunkParsedForm, summariseParsedForm, type ParsedForm } from "./form-outline";
import { postValidateFields } from "./form-postvalidate";
import { guessTitle, proposeFieldsByRules } from "./form-rules";
import { prefilledWarning, redactParsedForm } from "./form-redact";
import { demoAssetNotice, getRecordedFormAnalysis } from "./recorded-forms";
import { blankPdfFormValues } from "../forms/pdf-blank";
import { DraftGenerationError } from "./types";

/**
 * Version of the rules-mode reader. "rules-2" (RED wave 1): printed option labels, option-box groups and
 * one-character date boxes, tables of fields, flat-PDF printed boxes, form sections and who completes
 * each part.
 */
export const RULES_PROMPT_VERSION = "rules-2" as const;

export interface AnalyseFormFileInput {
  file: DecodedFormFile;
  fileName: string;
  referrer?: ReferrerInfo;
  title?: string;
  /** "live" only after the live gate (passcode + rate cap). */
  mode: "live" | "demo";
  effort?: AiEffort;
  signal?: AbortSignal;
  now?: Date;
  client?: ClaudeClient;
  /** Scripts: skip the recorded / pre-written lookup in demo mode (always rules). */
  rulesOnly?: boolean;
  /**
   * Live: take rate-limit slots for the extra parallel calls of a long form (the gate took one).
   * Returns false when the per-minute cap has no room – the stored map or rules are used instead.
   * Wave 2: may be async (the limits are shared across server instances).
   */
  reserveExtraLiveCalls?: (n: number) => boolean | Promise<boolean>;
  /** Wave 2: the clinic the proposed map belongs to (the caller's). Default: the demo tenant. */
  tenantId?: TenantId;
}

export interface AnalyseFormFileResult {
  form: FormDefinition;
  outlineSummary: FormOutlineSummary;
  trace: FormAnalysisStep[];
  /** Live runs: raw output and measurements (scripts / logs). */
  live?: AnalyseFormLiveResult;
  /** Post-validation counts. */
  dropped: number;
  repaired: number;
}

/** Deterministic parsing by the forms engine. */
export async function parseFormFile(file: DecodedFormFile): Promise<ParsedForm> {
  if (file.mimeType === "application/pdf") {
    const pdf = await readPdfForm(file.bytes);
    const { classification, warnings, ...outline } = pdf;
    const kind = classification === "acroform" ? "pdf_acroform" : "pdf_flat";
    const extra = kind === "pdf_flat" ? ["This PDF has no fillable fields, so answers are written at estimated positions (best effort). Check every answer in the preview."] : [];
    return { kind, pdf: outline, warnings: [...warnings, ...extra] };
  }
  const outline = buildDocxOutline(file.bytes);
  return { kind: "docx", blocks: outline.blocks, warnings: outline.warnings };
}

function describeOutline(s: FormOutlineSummary): string {
  if (s.kind === "docx") {
    return `${s.paragraphs ?? 0} paragraphs, ${s.tables ?? 0} tables, ${s.answerSpaces} answer spaces${s.fillableFields ? `, ${s.fillableFields} form fields` : ""}`;
  }
  return `${s.pages ?? 0} page${s.pages === 1 ? "" : "s"}, ${s.kind === "pdf_acroform" ? `${s.fillableFields ?? 0} fillable fields` : `no fillable fields, ${s.answerSpaces} answer lines found`}`;
}

function referrerOf(input: AnalyseFormFileInput, output: Pick<AnalysisOutput, "referrerName" | "referrerType"> | null): ReferrerInfo {
  if (input.referrer) return input.referrer;
  const name = output?.referrerName.trim();
  const type: ReferrerType = output?.referrerType ?? "other";
  return { name: name || REFERRER_TO_BE_CONFIRMED, type };
}

function newForm(input: AnalyseFormFileInput, parsed: ParsedForm, fields: FormField[], analysis: FormAnalysis, meta: { title: string; referrer: ReferrerInfo; versionLabel?: string; sampleId?: string }): FormDefinition {
  const at = analysis.at;
  return {
    id: createId("frm"),
    tenantId: input.tenantId ?? DEMO_TENANT_ID,
    referrer: meta.referrer,
    title: meta.title.slice(0, 200) || "Referrer form",
    ...(meta.versionLabel && { versionLabel: meta.versionLabel.slice(0, 60) }),
    file: { fileName: input.fileName, mimeType: input.file.mimeType, sha256: input.file.sha256, sizeBytes: input.file.sizeBytes },
    kind: parsed.kind,
    fields,
    status: "proposed",
    analysis,
    createdAt: at,
    updatedAt: at,
    ...(meta.sampleId && { sampleId: meta.sampleId }),
    // A flat form that asks for BLOCK CAPITALS gets its answers printed in capitals (form-boxes.ts).
    ...(asksForBlockCapitals(parsed) && { uppercase: true }),
  };
}

/** A copy of a stored map (recorded / pre-written) as a fresh proposal for this upload. */
function asProposal(input: AnalyseFormFileInput, stored: FormDefinition, analysis: FormAnalysis, sampleId: string | undefined): FormDefinition {
  const { confirmed: _confirmed, builtIn: _builtIn, ...rest } = stored;
  void _confirmed;
  void _builtIn;
  return {
    ...rest,
    id: createId("frm"),
    tenantId: input.tenantId ?? DEMO_TENANT_ID,
    ...(input.referrer && { referrer: input.referrer }),
    ...(input.title && { title: input.title }),
    file: { ...stored.file, fileName: input.fileName },
    status: "proposed",
    analysis,
    createdAt: analysis.at,
    updatedAt: analysis.at,
    ...(sampleId && { sampleId }),
  };
}

export async function analyseFormFile(input: AnalyseFormFileInput): Promise<AnalyseFormFileResult> {
  const at = (input.now ?? new Date()).toISOString();
  // A clinic's own upload (fix wave 2): production wording, never "demo" (core/wording.ts analysis.clinic*).
  const clinic = Boolean(input.tenantId) && input.tenantId !== DEMO_TENANT_ID;
  const trace: FormAnalysisStep[] = [];

  let t = Date.now();
  const parsed = await parseFormFile(input.file);
  const outlineSummary = summariseParsedForm(parsed);
  trace.push({ label: "Read the document structure", status: parsed.warnings.length ? "warning" : "ok", ms: Date.now() - t, detail: describeOutline(outlineSummary) });

  // Data minimisation: the analysis needs the blank form, never a patient's details (ai/form-redact.ts).
  t = Date.now();
  const redaction = redactParsedForm(parsed);
  const blanked = parsed.kind === "pdf_acroform" ? await blankPdfFormValues(input.file.bytes) : { bytes: input.file.bytes, prefilled: [] as string[] };
  const minimisation = prefilledWarning(redaction.findings, blanked.prefilled.length);
  trace.push({
    label: "Removed any patient details before analysis",
    status: minimisation ? "warning" : "ok",
    ms: Date.now() - t,
    detail: minimisation
      ? "The uploaded copy was already filled in: identifying details were removed, and only the blank layout is analysed."
      : "No patient details found – the form is blank. Dates, phone numbers, e-mail addresses and postcodes printed on it are masked anyway.",
  });
  const extraWarnings = minimisation ? [minimisation] : [];

  // A recorded Claude analysis or a pre-written map of this exact file (demo mode, or when live
  // Claude fails part-way – better than rules for a file we already know).
  const storedMap = async (afterLiveError?: DraftGenerationError): Promise<AnalyseFormFileResult | null> => {
    t = Date.now();
    const fallbackNote = afterLiveError
      ? WORDING.server.analysis.fallbackNote(afterLiveError.code)
      : null;
    const recorded = getRecordedFormAnalysis(input.file.sha256);
    if (recorded) {
      // A stored map keeps its own mode: a pre-written map (e.g. of a local demonstration form) is never
      // labelled as a recorded reading.
      const prewritten = recorded.mode === "demo_prewritten";
      const recordedOn = recorded.recordedAt.slice(0, 10).split("-").reverse().join("/");
      const detail = !prewritten
        ? clinic
          ? WORDING.server.analysis.clinicRecordedDetail(recordedOn)
          : WORDING.server.analysis.recordedDetail(recordedOn, recorded.model)
        : (await findSampleBySha256(input.file.sha256))
          ? WORDING.server.analysis.prewrittenDetail
          : WORDING.server.analysis.uploadedPrewrittenDetail;
      const analysis: FormAnalysis = {
        mode: recorded.mode,
        ...(recorded.model && { model: publicEngineName(recorded.model) }),
        promptVersion: recorded.promptVersion,
        ...(recorded.durationMs !== undefined && { durationMs: recorded.durationMs }),
        ...(recorded.usage && { usage: recorded.usage }),
        at,
        warnings: [...extraWarnings, ...(fallbackNote ? [fallbackNote] : []), ...recorded.form.analysis.warnings],
      };
      trace.push({
        label: "Proposed the form map",
        status: afterLiveError ? "warning" : "ok",
        ms: Date.now() - t,
        detail: `${fallbackNote ? `${fallbackNote} ` : ""}${detail}`,
      });
      return { form: asProposal(input, recorded.form, analysis, recorded.sampleId), outlineSummary, trace, dropped: 0, repaired: 0 };
    }
    let sample = (await listSampleForms()).find((s) => s.file.sha256 === input.file.sha256 && s.form);
    if (!sample) {
      // A bundled sample kept out of the library on purpose (the "upload a new form" demo): its
      // pre-written map, offered as a proposal to check and confirm.
      const entry = await findSampleBySha256(input.file.sha256);
      const prewritten = await entry?.loadPrewrittenAnalysis?.();
      if (entry && prewritten && prewritten.file.sha256 === input.file.sha256) {
        const listed = (await listSampleForms()).find((s) => s.id === entry.id);
        if (listed) sample = { ...listed, form: { ...prewritten, sampleId: entry.id } };
      }
    }
    if (sample?.form) {
      const analysis: FormAnalysis = {
        mode: "demo_prewritten",
        promptVersion: sample.form.analysis.promptVersion,
        at,
        warnings: [...extraWarnings, ...(fallbackNote ? [fallbackNote] : []), ...sample.form.analysis.warnings],
      };
      trace.push({
        label: "Proposed the form map",
        status: afterLiveError ? "warning" : "ok",
        ms: Date.now() - t,
        detail: `${fallbackNote ? `${fallbackNote} ` : ""}${WORDING.server.analysis.prewrittenDetail}`,
      });
      return { form: asProposal(input, sample.form, analysis, sample.id), outlineSummary, trace, dropped: 0, repaired: 0 };
    }
    return null;
  };

  if (input.mode === "demo" && !input.rulesOnly) {
    const stored = await storedMap();
    if (stored) return stored;
  }

  // Live Claude, or rules.
  let live: AnalyseFormLiveResult | undefined;
  let liveError: DraftGenerationError | null = null;
  if (input.mode === "live") {
    t = Date.now();
    try {
      const calls = chunkParsedForm(parsed).length;
      if (calls > 1 && input.reserveExtraLiveCalls && !(await input.reserveExtraLiveCalls(calls - 1))) {
        throw new DraftGenerationError("AI_ERROR", WORDING.server.analysis.tooManyCalls(calls));
      }
      live = await analyseFormLive({
        parsed: redaction.parsed,
        fileBytes: blanked.bytes,
        // A flat PDF cannot be emptied: if it looks filled in, Claude gets the redacted text only.
        attachPdf: !(parsed.kind === "pdf_flat" && redaction.findings.length > 0),
        fileName: input.fileName,
        referrer: input.referrer,
        title: input.title,
        effort: input.effort ?? DEFAULT_ANALYSIS_EFFORT,
        signal: input.signal,
        client: input.client,
      });
      trace.push({
        label: "Proposed the form map",
        status: live.lenient ? "warning" : "ok",
        ms: Date.now() - t,
        detail: clinic
          ? WORDING.server.analysis.clinicLiveDetail(live.output.fields.length)
          : WORDING.server.analysis.liveDetail({ model: live.model, chunks: live.chunks, effort: live.effort, questions: live.output.fields.length }),
      });
    } catch (err) {
      if (!(err instanceof DraftGenerationError) || err.code === "LIVE_AI_UNAVAILABLE") throw err;
      liveError = err;
      const stored = input.rulesOnly ? null : await storedMap(err);
      if (stored) return stored;
      trace.push({ label: "Proposed the form map", status: "warning", ms: Date.now() - t, detail: WORDING.server.analysis.liveFailedRules(err.code) });
    }
  }

  t = Date.now();
  const raws = live ? live.output.fields : proposeFieldsByRules(parsed);
  const checked = postValidateFields(parsed, raws, live ? {} : { confidenceCap: "low" });
  trace.push({
    label: "Checked every answer space against the document",
    status: checked.dropped || checked.repaired ? "warning" : "ok",
    ms: Date.now() - t,
    detail: `${checked.fields.length} questions kept${checked.repaired ? `, ${checked.repaired} corrected` : ""}${checked.dropped ? `, ${checked.dropped} left out` : ""}`,
  });
  if (!live && !liveError) {
    trace.splice(1, 0, { label: "Proposed the form map", status: "ok", ms: 0, detail: clinic ? WORDING.server.analysis.clinicRulesOnlyTrace : WORDING.server.analysis.rulesOnlyTrace });
  }

  const warnings = [
    ...extraWarnings,
    ...parsed.warnings,
    ...(live?.output.warnings ?? []),
    ...(liveError ? [WORDING.server.analysis.liveErrorWarning(liveError.message)] : []),
    ...(!live ? [WORDING.server.analysis.rulesOnlyWarning] : []),
    ...checked.warnings,
  ];
  const analysis: FormAnalysis = live
    ? {
        mode: "live",
        model: live.model,
        promptVersion: FORM_ANALYSIS_PROMPT_VERSION,
        durationMs: live.durationMs,
        usage: live.usage,
        at,
        warnings,
      }
    : { mode: "rules", promptVersion: RULES_PROMPT_VERSION, at, warnings };

  const form = newForm(input, parsed, checked.fields, analysis, {
    title: input.title ?? (live?.output.title.trim() || guessTitle(parsed, input.fileName)),
    referrer: referrerOf(input, live?.output ?? null),
    versionLabel: live?.output.versionLabel.trim() || undefined,
  });
  // A local demonstration form read live or by rules is labelled as such too (ai/demo-assets.ts).
  const notice = demoAssetNotice(input.file.sha256, input.referrer?.name ?? live?.output.referrerName.trim());
  if (notice) form.demoNotice = notice;
  return { form, outlineSummary, trace, live, dropped: checked.dropped, repaired: checked.repaired };
}
