import "server-only";

/**
 * Recorded form analyses: real Claude analyses of the bundled fictional sample forms, frozen into
 * ai/recorded/forms/<sampleId>.json by scripts/medreport/record-form-analyses.ts and stamped
 * "demo_recorded" (date, model, prompt version). POST /forms/analyse returns one in demo mode when the
 * uploaded file's SHA-256 matches; the forms engine's sample registry may offer it as a sample's map.
 *
 * Owner: ai agent.
 */
import { z } from "zod";
import { FormOutlineSummarySchema } from "../api/contract";
import { AiEffortSchema, FormDefinitionSchema, IsoDateTimeSchema, Sha256HexSchema, TokenUsageSchema } from "../core/schemas";
import type { FormDefinition } from "../core/types";
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

/** Every recorded analysis that parses (invalid files are ignored, never served). */
export function listRecordedFormAnalyses(): RecordedFormAnalysis[] {
  if (cache) return cache;
  cache = Object.values(RECORDED_FORM_ANALYSIS_SOURCES)
    .map((raw) => RecordedFormAnalysisSchema.safeParse(raw))
    .filter((r): r is { success: true; data: RecordedFormAnalysis } => r.success)
    .map((r) => r.data)
    .filter((r) => r.form.file.sha256 === r.fileSha256);
  return cache;
}

/** The recorded analysis of exactly this file (by SHA-256), or null. */
export function getRecordedFormAnalysis(sha256: string): RecordedFormAnalysis | null {
  return listRecordedFormAnalyses().find((r) => r.fileSha256 === sha256) ?? null;
}

/**
 * The recorded form map for a bundled sample (for forms/samples/registry.ts `loadForm`), with
 * `builtIn` and `sampleId` set. Status as recorded ("proposed"); the sample registry decides whether
 * to offer it pre-confirmed.
 */
export function getRecordedFormMap(sampleId: string): FormDefinition | undefined {
  const rec = listRecordedFormAnalyses().find((r) => r.sampleId === sampleId);
  return rec ? { ...rec.form, builtIn: true, sampleId } : undefined;
}
