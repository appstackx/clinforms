import "server-only";

/**
 * Helpers for the hand-authored, pre-confirmed form maps of the bundled sample forms. Each map is bound
 * to its file's SHA-256 through the generated manifest (scripts/medreport/build-demo-forms.mjs), and the
 * forms-engine tests check that every anchor still lands in the right place on that exact file.
 *
 * The ai agent may replace these with recorded live analyses (scripts/medreport/record-form-analyses.ts)
 * when those match; these stay as the reliable fallback.
 *
 * Owner: forms-engine agent.
 */
import { DEMO_TENANT_ID } from "../../../config.public";
import type { AnswerType, FillSource, FormAnchor, FormDefinition, FormField, ReferrerInfo } from "../../../core/types";
import { SAMPLE_FORM_FILES, type SampleFormFileId } from "../generated/manifest";

/** When the sample maps were written and confirmed (fixed, so the samples are deterministic). */
export const SAMPLE_MAP_AT = "2026-10-06T09:00:00.000Z";
export const SAMPLE_MAP_PROMPT_VERSION = "hand-mapped-2026-10";
export const SAMPLE_MAP_CONFIRMED_BY = "Practice manager – Riverside Physiotherapy (fictional)";

export interface FieldSpec {
  label: string;
  section?: string;
  guidance: string;
  answerType: AnswerType;
  options?: string[];
  anchor: FormAnchor;
  fillSource: FillSource;
  required?: boolean;
  confidence?: FormField["confidence"];
  note?: string;
}

/** Number the fields F-01, F-02… in the order given (document order). */
export function numberFields(specs: FieldSpec[]): FormField[] {
  return specs.map((s, i) => ({
    id: `F-${String(i + 1).padStart(2, "0")}`,
    label: s.label,
    ...(s.section && { section: s.section }),
    guidance: s.guidance,
    answerType: s.answerType,
    ...(s.options && { options: s.options }),
    anchor: s.anchor,
    fillSource: s.fillSource,
    required: s.required ?? s.fillSource.kind !== "leave_blank",
    confidence: s.confidence ?? "high",
    ...(s.note && { note: s.note }),
  }));
}

export function sampleFormDefinition(input: {
  id: string;
  sampleId: SampleFormFileId;
  /** Default: "pdf_acroform" for a PDF, "docx" for Word. */
  kind?: FormDefinition["kind"];
  referrer: ReferrerInfo;
  title: string;
  versionLabel: string;
  fields: FieldSpec[];
  warnings?: string[];
}): FormDefinition {
  const file = SAMPLE_FORM_FILES[input.sampleId];
  const kind = input.kind ?? (file.mimeType === "application/pdf" ? "pdf_acroform" : "docx");
  return {
    id: input.id,
    tenantId: DEMO_TENANT_ID,
    referrer: input.referrer,
    title: input.title,
    versionLabel: input.versionLabel,
    file: { fileName: file.fileName, mimeType: file.mimeType, sha256: file.sha256, sizeBytes: file.sizeBytes },
    kind,
    fields: numberFields(input.fields),
    status: "confirmed",
    analysis: { mode: "demo_prewritten", promptVersion: SAMPLE_MAP_PROMPT_VERSION, at: SAMPLE_MAP_AT, warnings: input.warnings ?? [] },
    confirmed: { by: SAMPLE_MAP_CONFIRMED_BY, at: SAMPLE_MAP_AT },
    createdAt: SAMPLE_MAP_AT,
    updatedAt: SAMPLE_MAP_AT,
    builtIn: true,
    sampleId: input.sampleId,
  };
}

/* Anchor shorthands ------------------------------------------------------------------------------- */

export const cell = (blockId: string): FormAnchor => ({ kind: "docx", target: "table_cell", blockId });
export const after = (blockId: string): FormAnchor => ({ kind: "docx", target: "after_paragraph", blockId });
export const placeholder = (blockId: string, placeholderText: string): FormAnchor => ({
  kind: "docx",
  target: "replace_placeholder",
  blockId,
  placeholderText,
});
export const ticks = (blockId: string, options: string[]): FormAnchor => ({
  kind: "docx",
  target: "checkbox_glyph",
  blockId,
  optionGlyphs: options.map((option, glyphIndex) => ({ option, blockId, glyphIndex })),
});
export const pdfText = (fieldName: string): FormAnchor => ({ kind: "pdf_field", fieldName, fieldType: "text" });

/* Fill-source shorthands -------------------------------------------------------------------------- */

export const reg = (path: Extract<FillSource, { kind: "registration" }>["path"]): FillSource => ({ kind: "registration", path });
export const NARRATIVE: FillSource = { kind: "notes_narrative" };
export const OPINION: FillSource = { kind: "clinician_opinion" };
export const BLANK: FillSource = { kind: "leave_blank" };
export const signoff = (part: Extract<FillSource, { kind: "signoff" }>["part"]): FillSource => ({ kind: "signoff", part });
export const sessionsAttended: FillSource = { kind: "computed_fact", factId: "FACT-attendance", format: "sessions_attended" };
export const sessionsMissed: FillSource = { kind: "computed_fact", factId: "FACT-attendance", format: "dna_count" };
