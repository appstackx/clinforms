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

/**
 * "text" = several lines; "line" = one short line (e.g. "Consent recorded"); "checklist" = tick boxes from the
 * section's `options` (e.g. the red flags screened) – the note stores the ticked options, one per line.
 */
export const SECTION_KINDS = ["text", "line", "checklist"] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export const MAX_TEMPLATE_SECTIONS = 20;
/** Longest text of one section of a note. */
export const MAX_SECTION_CHARS = 20_000;
/** Longest one-line section. */
export const MAX_LINE_CHARS = 300;

export const SECTION_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/** Most tick boxes in one checklist section, and the longest option. */
export const MAX_CHECKLIST_OPTIONS = 12;
export const MAX_CHECKLIST_OPTION_CHARS = 80;

const ChecklistOptionsSchema = z
  .array(z.string().trim().min(1, "Every tick box needs words").max(MAX_CHECKLIST_OPTION_CHARS, `At most ${MAX_CHECKLIST_OPTION_CHARS} characters`).refine((v) => !/\n/.test(v), "One line per tick box"))
  .max(MAX_CHECKLIST_OPTIONS, `At most ${MAX_CHECKLIST_OPTIONS} tick boxes`);

const TemplateSectionObject = z.object({
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
  /** The tick boxes of a "checklist" section (ignored for the other kinds). */
  options: ChecklistOptionsSchema.optional(),
});

export const TemplateSectionSchema = TemplateSectionObject.transform((s) => {
  const { options, ...rest } = s;
  return s.kind === "checklist" ? { ...rest, options: options ?? [] } : rest;
}).superRefine((s, ctx) => {
  if (s.kind === "checklist" && (!("options" in s) || !s.options || s.options.length === 0)) ctx.addIssue({ code: "custom", path: ["options"], message: "A checklist needs at least one tick box" });
});
export type TemplateSection = { key: string; label: string; hint: string | null; kind: SectionKind; options?: string[] };

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
const checklist = (key: string, label: string, hint: string | null, options: string[]): TemplateSection => ({ key, label, hint, kind: "checklist", options });

/** The red flags screened at an initial assessment (design round 2: ticked = asked and none found). */
export const RED_FLAG_OPTIONS: readonly string[] = ["Weight loss", "Night pain unrelated to position", "Fever", "Trauma", "Neurological signs"];

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
    // Design round 2 (docs/clinic-system/design/round2/patients/NoteEditor): S, O, A, P with the red flags screened
    // under the subjective history. Notes started from the earlier, longer layout keep their own snapshot.
    sections: [
      s("subjective", "Subjective", "History, symptoms, goals"),
      checklist("red_flags", "Red flags screened", "Tick each one asked about and not present.", [...RED_FLAG_OPTIONS]),
      s("objective", "Objective", "Observation, range, tests"),
      s("assessment", "Assessment", "Clinical impression"),
      s("plan", "Plan", "Treatment given, home exercise, next steps"),
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
      s("subjective", "Subjective", "Change since the last session, response to treatment and exercises"),
      s("objective", "Objective", "Re-assessment findings"),
      s("assessment", "Assessment", "Progress against the goals"),
      s("plan", "Plan", "Treatment given, changes to the plan, next review"),
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
  return { id: t.id, name: t.name, noteType: t.noteType, sections: t.sections.map((x) => (x.options ? { ...x, options: [...x.options] } : { ...x })), bodyChart: t.bodyChart };
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

/** The ticked options of a checklist section's stored text (one per line), in the template's order. */
export function checkedOptions(section: Pick<TemplateSection, "options">, text: string | null | undefined): string[] {
  const ticked = new Set((text ?? "").split("\n").map((l) => l.trim()).filter(Boolean));
  return (section.options ?? []).filter((o) => ticked.has(o));
}

/** The letter shown beside a section (S, O, A, P for the SOAP headings; else the heading's first letter). */
export function sectionLetter(section: Pick<TemplateSection, "key" | "label">): string {
  const soap: Record<string, string> = { subjective: "S", objective: "O", assessment: "A", plan: "P" };
  return soap[section.key] ?? (section.label.trim().charAt(0).toUpperCase() || "•");
}
