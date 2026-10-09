import "server-only";

/**
 * Recorded form analyses: real Claude analyses of the bundled fictional sample forms, frozen into
 * ai/recorded/forms/<sampleId>.json by scripts/medreport/record-form-analyses.ts and stamped
 * "demo_recorded" (date, model, prompt version). POST /forms/analyse returns one in demo mode when the
 * uploaded file's SHA-256 matches; the forms engine's sample registry may offer it as a sample's map.
 *
 * Also the pre-written maps of local demonstration forms (ai/demo-assets.ts, dev/demo only, off in
 * production): same file format, matched by SHA-256 like the bundled ones (a bundled map of the same
 * file wins), read again on every call, never offered as a bundled sample's map, and always carrying
 * a demonstration footer (FormDefinition.demoNotice – the map's own, else core/wording.ts
 * demoFormNotice(referrer)).
 *
 * Owner: ai agent.
 */
import { z } from "zod";
import { FormOutlineSummarySchema } from "../api/contract";
import { AiEffortSchema, FormDefinitionSchema, IsoDateTimeSchema, Sha256HexSchema, TokenUsageSchema } from "../core/schemas";
import type { FormDefinition } from "../core/types";
import { demoFormNotice } from "../core/wording";
import { demoAssetFileSha256s, readDemoAssetMaps } from "./demo-assets";
import { RECORDED_FORM_ANALYSIS_SOURCES } from "./recorded/forms";

export const RECORDED_FORM_ANALYSIS_FORMAT = "appstackx-reports.form-analysis" as const;

export const RecordedFormAnalysisSchema = z.object({
  format: z.literal(RECORDED_FORM_ANALYSIS_FORMAT),
  formatVersion: z.literal(1),
  sampleId: z.string().min(1),
  fileSha256: Sha256HexSchema,
  fileName: z.string().min(1),
  mode: z.enum(["demo_recorded", "demo_prewritten"]),
  recordedAt: IsoDateTimeSchema,
  model: z.string().optional(),
  promptVersion: z.string().min(1),
  effort: AiEffortSchema.optional(),
  /** Wall time of the live analysis (parallel chunks). */
  durationMs: z.number().nonnegative().optional(),
  chunks: z.number().int().positive().optional(),
  usage: TokenUsageSchema.optional(),
  /** The analysed form map after post-validation (status "proposed"). */
  form: FormDefinitionSchema,
  outlineSummary: FormOutlineSummarySchema,
  note: z.string().optional(),
});
export type RecordedFormAnalysis = z.infer<typeof RecordedFormAnalysisSchema>;

let cache: RecordedFormAnalysis[] | null = null;

/** Parse stored analyses: invalid files, and files whose map is bound to another file, are ignored (never served). */
function parseAll(raws: unknown[]): RecordedFormAnalysis[] {
  return raws
    .map((raw) => RecordedFormAnalysisSchema.safeParse(raw))
    .filter((r): r is { success: true; data: RecordedFormAnalysis } => r.success)
    .map((r) => r.data)
    .filter((r) => r.form.file.sha256 === r.fileSha256);
}

/** The recorded analyses bundled with the app (ai/recorded/forms), parsed once per instance. */
function bundledRecordedFormAnalyses(): RecordedFormAnalysis[] {
  if (!cache) cache = parseAll(Object.values(RECORDED_FORM_ANALYSIS_SOURCES));
  return cache;
}

/**
 * The pre-written maps of the local demonstration forms (ai/demo-assets.ts), read fresh on every call
 * ([] when the demo assets are off). A file the bundle already has a map for is left out, and every
 * map carries a demonstration footer.
 */
export function listDemoAssetFormAnalyses(): RecordedFormAnalysis[] {
  const bundled = new Set(bundledRecordedFormAnalyses().map((r) => r.fileSha256));
  const seen = new Set<string>();
  const out: RecordedFormAnalysis[] = [];
  for (const rec of parseAll(readDemoAssetMaps().map((m) => m.data))) {
    if (bundled.has(rec.fileSha256) || seen.has(rec.fileSha256)) continue;
    seen.add(rec.fileSha256);
    const notice = rec.form.demoNotice?.trim() || demoFormNotice(rec.form.referrer.name);
    out.push({ ...rec, form: { ...rec.form, demoNotice: notice } });
  }
  return out;
}

/** Every recorded analysis that parses: the bundled ones, then the local demonstration maps (when on). */
export function listRecordedFormAnalyses(): RecordedFormAnalysis[] {
  return [...bundledRecordedFormAnalyses(), ...listDemoAssetFormAnalyses()];
}

/** The recorded analysis of exactly this file (by SHA-256), or null. */
export function getRecordedFormAnalysis(sha256: string): RecordedFormAnalysis | null {
  return bundledRecordedFormAnalyses().find((r) => r.fileSha256 === sha256) ?? listDemoAssetFormAnalyses().find((r) => r.fileSha256 === sha256) ?? null;
}

/**
 * The demonstration footer for an uploaded file, or undefined for an ordinary form: the local demo map's
 * notice for this exact file, else – for a form file that sits in the demo-assets folder without a map –
 * the standard notice naming `publisher` (when known). Always undefined when the demo assets are off.
 */
export function demoAssetNotice(sha256: string, publisher?: string): string | undefined {
  const mapped = listDemoAssetFormAnalyses().find((r) => r.fileSha256 === sha256);
  if (mapped) return mapped.form.demoNotice;
  return demoAssetFileSha256s().has(sha256) ? demoFormNotice(publisher) : undefined;
}

/**
 * The recorded form map for a bundled sample (for forms/samples/registry.ts `loadForm`), with
 * `builtIn` and `sampleId` set. Status as recorded ("proposed"); the sample registry decides whether
 * to offer it pre-confirmed.
 */
export function getRecordedFormMap(sampleId: string): FormDefinition | undefined {
  // Bundled recordings only: a local demonstration map never stands in for a bundled sample's map.
  const rec = bundledRecordedFormAnalyses().find((r) => r.sampleId === sampleId);
  return rec ? { ...rec.form, builtIn: true, sampleId } : undefined;
}
