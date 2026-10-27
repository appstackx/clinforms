/**
 * Clinical note templates: the sections a note is written in (pure, browser-safe).
 *
 * - Three built-in templates (fixed ids, no database row): initial assessment in SOAP order, follow-up (SOAP) and
 *   discharge summary. A clinic copies one to make its own (pms_note_templates) and edits it in the template editor.
 * - A template is plain configuration (labels and hints – never patient data), so it is stored unencrypted.
 * - A note keeps a SNAPSHOT of the template it was started from: editing a template later never changes the
 *   structure of notes already written.
 */
import { z } from "zod";
import { BUILTIN_TEMPLATE_PREFIX } from "./ids";

export const NOTE_TYPES = ["initial", "follow_up", "discharge", "general"] as const;
export type NoteType = (typeof NOTE_TYPES)[number];
export const NoteTypeSchema = z.enum(NOTE_TYPES);

export const NOTE_TYPE_LABELS: Readonly<Record<NoteType, string>> = {
  initial: "Initial assessment",
  follow_up: "Follow-up",
  discharge: "Discharge",
  general: "General note",
};

/** "text" = several lines; "line" = one short line (e.g. "Consent recorded"). */
export const SECTION_KINDS = ["text", "line"] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export const MAX_TEMPLATE_SECTIONS = 20;
/** Longest text of one section of a note. */
export const MAX_SECTION_CHARS = 20_000;
/** Longest one-line section. */
export const MAX_LINE_CHARS = 300;

export const SECTION_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

export const TemplateSectionSchema = z.object({
  /** Stable key the note's text is stored under ("subjective"). */
  key: z.string().regex(SECTION_KEY_PATTERN, "Lower-case letters, digits and _ (starting with a letter)"),
  label: z.string().trim().min(1, "Every section needs a heading").max(80, "At most 80 characters"),
  /** What to write here (shown under the heading). */
  hint: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : (v ?? null)))
    .refine((v) => v === null || v.length <= 200, "At most 200 characters"),
  kind: z.enum(SECTION_KINDS).default("text"),
});
export type TemplateSection = z.output<typeof TemplateSectionSchema>;

export const TemplateSectionsSchema = z
  .array(TemplateSectionSchema)
  .min(1, "A template needs at least one section")
  .max(MAX_TEMPLATE_SECTIONS, `At most ${MAX_TEMPLATE_SECTIONS} sections`)
  .superRefine((sections, ctx) => {
    const seen = new Set<string>();
    sections.forEach((s, i) => {
      if (seen.has(s.key)) ctx.addIssue({ code: "custom", path: [i, "key"], message: "Two sections have the same key" });
      seen.add(s.key);
    });
  });

const templateShape = {
  name: z.string().trim().min(1, "Give the template a name").max(80, "At most 80 characters"),
  noteType: NoteTypeSchema,
  sections: TemplateSectionsSchema,
  /** Show the body chart in notes written with this template. */
  bodyChart: z.boolean(),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(10_000),
};

export const NoteTemplateInputSchema = z.object({
  ...templateShape,
  bodyChart: templateShape.bodyChart.default(false),
  active: templateShape.active.default(true),
  sortOrder: templateShape.sortOrder.default(100),
});
export type NoteTemplateInput = z.input<typeof NoteTemplateInputSchema>;
/** A change: only the fields given (no defaults – a patch never resets a field it does not name). */
export const NoteTemplatePatchSchema = z.object(templateShape).partial();
export type NoteTemplatePatch = z.input<typeof NoteTemplatePatchSchema>;

/** What a note stores about its template (the snapshot). */
export interface TemplateSnapshot {
  id: string;
  name: string;
  noteType: NoteType;
  sections: TemplateSection[];
  bodyChart: boolean;
  /** The template's revision when the note was started (a clinic template's version; built-in ones are 1). */
  version?: number;
}

export interface NoteTemplate extends TemplateSnapshot {
  builtin: boolean;
  active: boolean;
  sortOrder: number;
  rev: number;
  updatedAt: string | null;
}

const s = (key: string, label: string, hint: string | null = null, kind: SectionKind = "text"): TemplateSection => ({ key, label, hint, kind });

/** The built-in templates every clinic has (read-only; copy one to change it). */
export const BUILTIN_TEMPLATES: readonly NoteTemplate[] = [
  {
    id: `${BUILTIN_TEMPLATE_PREFIX}initial-soap`,
    name: "Initial assessment (SOAP)",
    noteType: "initial",
    bodyChart: true,
    builtin: true,
    active: true,
    sortOrder: 10,
    rev: 1,
    updatedAt: null,
    sections: [
      s("presenting_complaint", "Presenting complaint", "In the patient's words: what, where, since when."),
      s("history", "History of the presenting condition", "Onset, mechanism, behaviour over 24 hours, aggravating and easing factors."),
      s("past_history", "Past medical history", "Relevant conditions, operations, investigations."),
      s("medication", "Medication", "Current medicines and allergies."),
      s("screening", "Screening questions", "Serious pathology screening asked and the answers."),
      s("social", "Social history and goals", "Work, sport, home, what the patient wants to get back to."),
      s("objective", "Objective examination", "Observation, movement, strength, neurological and special tests."),
      s("assessment", "Assessment", "Clinical impression and working diagnosis."),
      s("plan", "Plan and treatment given", "Treatment today, advice, home exercises, review plan."),
      s("consent", "Consent", "How consent to assessment and treatment was given.", "line"),
    ],
  },
  {
    id: `${BUILTIN_TEMPLATE_PREFIX}follow-up-soap`,
    name: "Follow-up (SOAP)",
    noteType: "follow_up",
    bodyChart: false,
    builtin: true,
    active: true,
    sortOrder: 20,
    rev: 1,
    updatedAt: null,
    sections: [
      s("subjective", "Subjective", "Change since the last session, response to treatment and exercises."),
      s("objective", "Objective", "Re-assessment findings."),
      s("assessment", "Assessment", "Progress against the goals."),
      s("plan", "Plan and treatment given", "Treatment today, changes to the plan, next review."),
    ],
  },
  {
    id: `${BUILTIN_TEMPLATE_PREFIX}discharge`,
    name: "Discharge summary",
    noteType: "discharge",
    bodyChart: false,
    builtin: true,
    active: true,
    sortOrder: 30,
    rev: 1,
    updatedAt: null,
    sections: [
      s("reason", "Reason for discharge", "Goals met, self-managing, referred on, did not return…"),
      s("summary", "Summary of treatment", "Number of sessions, main treatment given."),
      s("outcome", "Outcome at discharge", "Symptoms, function and outcome measures compared with the start."),
      s("advice", "Advice and home programme"),
      s("onward", "Onward referral and letters", "GP letter, referral to another service."),
    ],
  },
];

export function isBuiltinTemplateId(id: string): boolean {
  return id.startsWith(BUILTIN_TEMPLATE_PREFIX);
}

export function builtinTemplate(id: string): NoteTemplate | null {
  return BUILTIN_TEMPLATES.find((t) => t.id === id) ?? null;
}

export function toSnapshot(t: TemplateSnapshot): TemplateSnapshot {
  return { id: t.id, name: t.name, noteType: t.noteType, sections: t.sections.map((x) => ({ ...x })), bodyChart: t.bodyChart };
}

/** A section key made from a heading ("Plan & treatment" → "plan_treatment"), unique among `taken`. */
export function sectionKeyFor(label: string, taken: readonly string[]): string {
  let base = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  if (!/^[a-z]/.test(base)) base = `section_${base}`.replace(/_+$/, "");
  if (!base) base = "section";
  let key = base;
  for (let i = 2; taken.includes(key); i++) key = `${base}_${i}`;
  return key;
}

/** Parses a stored snapshot (JSON) defensively; null when it is not a valid snapshot. */
export function parseSnapshot(json: string | null | undefined): TemplateSnapshot | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as Partial<TemplateSnapshot>;
    const sections = TemplateSectionsSchema.safeParse(raw.sections);
    const type = NoteTypeSchema.safeParse(raw.noteType);
    if (!sections.success || !type.success || typeof raw.id !== "string" || typeof raw.name !== "string") return null;
    const out: TemplateSnapshot = { id: raw.id, name: raw.name, noteType: type.data, sections: sections.data, bodyChart: raw.bodyChart === true };
    if (typeof raw.version === "number" && Number.isInteger(raw.version) && raw.version > 0) out.version = raw.version;
    return out;
  } catch {
    return null;
  }
}
