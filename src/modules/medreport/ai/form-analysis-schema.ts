import "server-only";

/**
 * Structured output schema of a form analysis call (one per chunk of the form). Deliberately flat for
 * structured outputs: no optional fields, no unions of objects, "none" sentinels instead of absent
 * values, plain enums. form-postvalidate.ts turns it into FormFields (anchors checked against the
 * outline, identifiers forced to registration, IDs assigned in document order).
 *
 * Owner: ai agent.
 */
import { z } from "zod";
import {
  AnswerTypeSchema,
  ComputedFactFormatSchema,
  FormFieldConfidenceSchema,
  OutcomeInstrumentSchema,
  PartySchema,
  ReferrerTypeSchema,
  MERGE_CODE_ONLY_PATHS,
  RegistrationPathSchema,
  SignoffPartSchema,
} from "../core/schemas";
import type { Party, RegistrationPath } from "../core/types";

/**
 * The registration paths the form reading may propose: every path except those only a clinic system's merge codes
 * use (10/2026, MERGE_CODE_ONLY_PATHS – bound by code in ai/practice-merge-binding.ts), so the live analysis's
 * output schema is unchanged.
 */
export const ANALYSIS_REGISTRATION_PATHS = RegistrationPathSchema.options.filter(
  (p) => !(MERGE_CODE_ONLY_PATHS as readonly string[]).includes(p),
  // The type stays every path (the outputs flow into code that takes any RegistrationPath); only the values differ.
) as unknown as readonly [RegistrationPath, ...RegistrationPath[]];

export const ANCHOR_TARGETS = [
  "table_cell",
  "after_paragraph",
  "replace_placeholder",
  "content_control",
  "checkbox_glyph",
  "legacy_form_field",
  // form-analysis-5 (10/2026): a "mark the column" table cell, a "delete as necessary" list.
  "mark_cell",
  "delete_options",
  "pdf_field",
  "pdf_overlay",
] as const;

/**
 * Fill sources the analysis may propose. "appointments_table" (form-analysis-4): a table of fields that
 * lists the treatments and fees – post-validation makes it one table question filled from the attended
 * appointments (form-tables.ts); anywhere else it is drafted from the notes. "fixed" is never proposed: a
 * fixed answer is set by staff.
 */
export const FILL_KINDS = ["registration", "computed_fact", "notes_narrative", "clinician_opinion", "signoff", "leave_blank", "appointments_table"] as const;

export const FACT_ID_OPTIONS = [
  "FACT-attendance",
  "FACT-age",
  "FACT-episode",
  ...OutcomeInstrumentSchema.options.map((i) => `FACT-outcomes-${i}` as const),
] as const;

/**
 * Answer types the analysis may propose: every type except "table" – tables are found from the layout
 * by code (form-tables.ts). The analysis maps a table of fields once, at its first cell (fill source
 * "appointments_table" for a list of treatments and fees), and post-validation makes it the table question.
 */
export const AnalysisAnswerTypeSchema = AnswerTypeSchema.exclude(["table"]);

export const AnalysisOptionAnchorSchema = z.object({
  option: z.string().describe("The option exactly as printed."),
  ref: z
    .string()
    .describe("Word checkbox_glyph: the block ID holding this option's tick box. mark_cell: the cell ID to mark for this option. delete_options (one option per line): the block ID printing this option. Fillable PDF: the check box field name for this option."),
  glyphIndex: z.number().int().describe("Word checkbox_glyph: 0-based index of this option's tick box among the tick boxes in that block. Otherwise 0."),
});

const AnalysisFieldOutputBaseSchema = z.object({
  label: z.string().describe("The question or label exactly as printed on the form."),
  section: z.string().describe('The form\'s own heading this question sits under, exactly as printed, or "".'),
  guidance: z.string().describe("One plain-English sentence for the clinic: what the referrer wants here."),
  answerType: AnalysisAnswerTypeSchema,
  options: z.array(z.string()).describe("yes_no / single_choice / checkbox: the options exactly as printed, in order. [] otherwise."),
  anchorTarget: z.enum(ANCHOR_TARGETS),
  anchorRef: z
    .string()
    .describe('Word: the block ID of the answer space (see the rules). Fillable PDF: the field name exactly as listed. Flat PDF: "".'),
  placeholderText: z
    .string()
    .describe('replace_placeholder: the placeholder exactly as it appears in that block. delete_options on one line: the whole list exactly as printed. "" otherwise.'),
  optionAnchors: z
    .array(AnalysisOptionAnchorSchema)
    .describe("checkbox_glyph, mark_cell, delete_options with one option per line (and PDF tick boxes per option): one entry per option, same order as options. [] otherwise."),
  overlay: z
    .object({ page: z.number().int(), x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .describe("pdf_overlay only: the answer box in PDF points, origin bottom-left, page 1-based. All zeros otherwise."),
  fillSource: z.enum(FILL_KINDS),
  registrationPath: z.enum([...ANALYSIS_REGISTRATION_PATHS, "none"]),
  computedFact: z.enum([...FACT_ID_OPTIONS, "none"]),
  computedFormat: z.enum([...ComputedFactFormatSchema.options, "none"]),
  signoffPart: z.enum([...SignoffPartSchema.options, "none"]),
  required: z.boolean(),
  confidence: FormFieldConfidenceSchema,
  note: z.string().describe('Short note for the staff member when something is uncertain, else "".'),
});

/**
 * Live output: also says who fills in each answer space (multi-party insurer forms). Added after
 * "form-analysis-3" was recorded; post-validation also works it out from the form's own headings, and an
 * output without it (lenient) counts as "unknown".
 */
export const AnalysisFieldOutputSchema = AnalysisFieldOutputBaseSchema.extend({
  completedBy: PartySchema.describe(
    'Who fills in this answer space according to the form\'s own wording (e.g. a section "to be completed by the policyholder", or the policyholder\'s signature): clinic (the treating physiotherapist, therapist or practitioner), patient, policyholder, doctor (GP, specialist or other medical practitioner), insurer (office use), or unknown when the form does not say.',
  ),
});

export const AnalysisOutputSchema = z.object({
  title: z.string().describe("The form's title as printed."),
  referrerName: z.string().describe('The organisation that issued the form, as printed on it, or "".'),
  referrerType: ReferrerTypeSchema,
  versionLabel: z.string().describe('The form\'s own version or date label (e.g. "v3 (2026)"), or "".'),
  fields: z.array(AnalysisFieldOutputSchema),
  warnings: z.array(z.string()).describe("Plain-English caveats for the staff member reviewing the map."),
});

/** One proposed field (live, recorded or rules); `completedBy` is optional outside the live schema. */
export type AnalysisFieldOutput = z.infer<typeof AnalysisFieldOutputBaseSchema> & { completedBy?: Party };
export type AnalysisOutput = Omit<z.infer<typeof AnalysisOutputSchema>, "fields"> & { fields: AnalysisFieldOutput[] };

/** Lenient version: same shape, defaults instead of failures (post-validation checks everything). */
export const LenientAnalysisOutputSchema: z.ZodType<AnalysisOutput> = z.object({
  title: z.string().catch(""),
  referrerName: z.string().catch(""),
  referrerType: ReferrerTypeSchema.catch("other"),
  versionLabel: z.string().catch(""),
  fields: z.array(
    z.object({
      label: z.string(),
      section: z.string().catch(""),
      guidance: z.string().catch(""),
      answerType: AnalysisAnswerTypeSchema.catch("long_text"),
      options: z.array(z.string()).catch([]),
      anchorTarget: z.enum(ANCHOR_TARGETS).catch("after_paragraph"),
      anchorRef: z.string().catch(""),
      placeholderText: z.string().catch(""),
      optionAnchors: z.array(AnalysisOptionAnchorSchema).catch([]),
      overlay: z.object({ page: z.number(), x: z.number(), y: z.number(), width: z.number(), height: z.number() }).catch({ page: 0, x: 0, y: 0, width: 0, height: 0 }),
      fillSource: z.enum(FILL_KINDS).catch("notes_narrative"),
      registrationPath: z.enum([...ANALYSIS_REGISTRATION_PATHS, "none"]).catch("none"),
      computedFact: z.enum([...FACT_ID_OPTIONS, "none"]).catch("none"),
      computedFormat: z.enum([...ComputedFactFormatSchema.options, "none"]).catch("none"),
      signoffPart: z.enum([...SignoffPartSchema.options, "none"]).catch("none"),
      required: z.boolean().catch(true),
      confidence: FormFieldConfidenceSchema.catch("low"),
      note: z.string().catch(""),
      completedBy: PartySchema.catch("unknown"),
    }),
  ),
  warnings: z.array(z.string()).catch([]),
});
