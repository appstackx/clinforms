import "server-only";

/**
 * File format of the demo drafts in ai/demo-drafts/*.json, written by
 * scripts/medreport/record-demo-drafts.ts (recorded Claude output) or by hand (pre-written).
 *
 * Built-in templates: `{externalPatientId}__{templateId}.json`.
 * Referrer forms (Revision 2): `{externalPatientId}__form-{sampleId or formId}.json`, with `formSha256`
 * (the referrer file the field IDs belong to) – a draft is only used for that exact file.
 *
 * `groups` is keyed by section group ("incident_history+presenting_complaints", "F-07+F-08"); each
 * value has the same shape as the raw model output (DraftGroupOutput, or FormDraftGroupOutput with an
 * `answer` per field: "[CLAIMANT]" placeholders, unassigned IDs), plus how it was recorded.
 * Fictional data only.
 *
 * Owner: ai agent.
 */
import { z } from "zod";
import {
  AiEffortSchema,
  AnswerTypeSchema,
  DraftGapOutputSchema,
  DraftSectionOutputSchema,
  IsoDateTimeSchema,
  Sha256HexSchema,
  TokenUsageSchema,
} from "../core/schemas";

export const DEMO_DRAFT_FORMAT = "appstackx-reports.demo-draft" as const;

export const DemoDraftGroupSchema = z.object({
  sections: z.array(DraftSectionOutputSchema.extend({ answer: z.string().optional() })),
  gaps: z.array(DraftGapOutputSchema),
  /** Provenance of a recorded group (live call it came from). */
  recording: z
    .object({
      model: z.string(),
      effort: AiEffortSchema,
      durationMs: z.number().nonnegative(),
      usage: TokenUsageSchema,
      stopReason: z.string().optional(),
    })
    .optional(),
});

export const DemoDraftFileSchema = z.object({
  format: z.literal(DEMO_DRAFT_FORMAT),
  formatVersion: z.literal(1),
  /** externalPatientId of the bundle (e.g. "sim-pat-001"). */
  patientId: z.string().min(1),
  /**
   * ai/bundle-fingerprint.ts bundleNotesFingerprint() of the bundle the draft was recorded from. The
   * draft is only replayed for a simulated-TM3 bundle with exactly these notes.
   */
  bundleFingerprint: Sha256HexSchema.optional(),
  /** Built-in template ID, or formTemplateId(formId) ("form:<id>") for a referrer's form. */
  templateId: z.string().min(1),
  templateVersion: z.string().min(1),
  /** Referrer forms: the bundled sample the form map came from (FormDefinition.sampleId). */
  sampleId: z.string().optional(),
  /** Referrer forms: SHA-256 of the referrer file whose field IDs these answers belong to. */
  formSha256: Sha256HexSchema.optional(),
  /**
   * Referrer forms: each recorded field's answer space (core/forms.ts formAnchorKeys) and answer type,
   * so the answers can be matched to a map of the same file whose field IDs differ (e.g. a staff-
   * confirmed analysis instead of the bundled map). Answers whose answer space is not in the map are
   * not used.
   */
  fields: z.record(z.string(), z.object({ anchor: z.string(), answerType: AnswerTypeSchema, label: z.string() })).optional(),
  mode: z.enum(["demo_prewritten", "demo_recorded"]),
  /** demo_recorded: when the live output was recorded, with which model and prompt version. */
  recordedAt: IsoDateTimeSchema.optional(),
  model: z.string().optional(),
  promptVersion: z.string().min(1),
  effort: AiEffortSchema.optional(),
  /** Free-text provenance note (never shown as AI output). */
  note: z.string().optional(),
  groups: z.record(z.string(), DemoDraftGroupSchema),
});

export type DemoDraftGroup = z.infer<typeof DemoDraftGroupSchema>;
export type DemoDraftFile = z.infer<typeof DemoDraftFileSchema>;

export function demoDraftKey(patientId: string, templateId: string): string {
  return `${patientId}__${templateId}`;
}

/** File-name-safe key of a form's demo draft: the sample ID when the map came from a sample, else the form ID. */
export function demoFormDraftKey(patientId: string, form: { id: string; sampleId?: string }): string {
  const id = (form.sampleId ?? form.id).replace(/[^A-Za-z0-9_-]+/g, "-");
  return `${patientId}__form-${id}`;
}

export function groupKey(sectionKeys: string[]): string {
  return sectionKeys.join("+");
}
