/**
 * Clinical notes (pure): what a note holds, the sign-and-lock rule and amendments.
 *
 * Life of a note
 *   draft      – written and saved by its author (only the author edits it; revision-checked saves);
 *   signed     – signed by its author: the content is LOCKED (the repository refuses changes and a database trigger
 *                backs it up); from then on it changes only through amendments, which are themselves locked and
 *                shown with the note (who, when, why);
 *   discarded  – a draft its author threw away (kept, hidden by default – nothing clinical is deleted).
 * A signed note can be marked "entered in error" by an amendment: it stays readable, struck through.
 *
 * Amendments: "addendum" (more information), "correction" (a section corrected – the original stays visible),
 * "entered_in_error" (the whole note was written for the wrong patient or in error). A correction or an
 * error marking needs a reason.
 */
import { z } from "zod";
import { BodyChartSchema, type BodyChart } from "./body-chart";
import { MAX_LINE_CHARS, MAX_SECTION_CHARS, SECTION_KEY_PATTERN, type TemplateSnapshot } from "./templates";

export const NOTE_STATUSES = ["draft", "signed", "discarded"] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];

export const AMENDMENT_KINDS = ["addendum", "correction", "entered_in_error"] as const;
export type AmendmentKind = (typeof AMENDMENT_KINDS)[number];

export const AMENDMENT_KIND_LABELS: Readonly<Record<AmendmentKind, string>> = {
  addendum: "Addendum",
  correction: "Correction",
  entered_in_error: "Marked as entered in error",
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date as YYYY-MM-DD");

/** A new draft: which patient, case, template and consultation date. */
export const NoteDraftInputSchema = z.object({
  patientId: z.string().min(1),
  caseId: z.union([z.string().min(1), z.null()]).optional(),
  /** The diary appointment the note is about (optional). */
  appointmentId: z.union([z.string().regex(/^[a-z]{2,6}_[0-9A-HJKMNP-TV-Z]{26}$/, "Not an appointment"), z.null()]).optional(),
  templateId: z.string().min(1, "Choose a template"),
  /** The date of the consultation the note is about. */
  seenOn: isoDate,
  practitionerId: z.union([z.string().min(1), z.null()]).optional(),
  importRef: z.union([z.string().trim().max(80), z.null()]).optional(),
});
export type NoteDraftInput = z.input<typeof NoteDraftInputSchema>;

/** The text of each section (section key → text). Empty sections are dropped. */
export const NoteSectionsSchema = z
  .record(z.string().regex(SECTION_KEY_PATTERN), z.string())
  .transform((rec) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(rec)) {
      const text = v.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
      if (text) out[k] = text;
    }
    return out;
  })
  .refine((rec) => Object.values(rec).every((v) => v.length <= MAX_SECTION_CHARS), `A section can hold at most ${MAX_SECTION_CHARS.toLocaleString("en-GB")} characters`);

export const NoteContentSchema = z.object({
  sections: NoteSectionsSchema,
  bodyChart: z.union([BodyChartSchema, z.null()]).optional(),
  seenOn: isoDate.optional(),
  caseId: z.union([z.string().min(1), z.null()]).optional(),
});
export type NoteContentInput = z.input<typeof NoteContentSchema>;
export type NoteContent = z.output<typeof NoteContentSchema>;

export const AmendmentInputSchema = z
  .object({
    kind: z.enum(AMENDMENT_KINDS),
    /** The section a correction is about (null = the note as a whole). */
    sectionKey: z.union([z.string().regex(SECTION_KEY_PATTERN), z.null()]).optional(),
    text: z
      .string()
      .transform((v) => v.replace(/\r\n/g, "\n").trim())
      .refine((v) => v.length <= MAX_SECTION_CHARS, "Too long"),
    reason: z
      .union([z.string(), z.null()])
      .optional()
      .transform((v) => (typeof v === "string" ? v.trim() || null : null))
      .refine((v) => v === null || v.length <= 500, "At most 500 characters"),
  })
  .superRefine((v, ctx) => {
    if (v.kind !== "entered_in_error" && !v.text) ctx.addIssue({ code: "custom", path: ["text"], message: "Write the amendment" });
    if (v.kind === "correction" && !v.sectionKey) ctx.addIssue({ code: "custom", path: ["sectionKey"], message: "Choose the section you are correcting" });
    if (v.kind !== "addendum" && !v.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "Give the reason" });
  });
export type AmendmentInput = z.input<typeof AmendmentInputSchema>;

/** Sections that are filled and belong to the template (others are dropped – a template change cannot smuggle text in). */
export function sectionsForTemplate(template: TemplateSnapshot, sections: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of template.sections) {
    const text = sections[s.key];
    if (!text) continue;
    out[s.key] = s.kind === "line" ? text.replace(/\s+/g, " ").slice(0, MAX_LINE_CHARS) : text;
  }
  return out;
}

export function noteHasContent(sections: Record<string, string>, chart: BodyChart | null | undefined): boolean {
  return Object.values(sections).some((t) => t.trim() !== "") || Boolean(chart && chart.markers.length > 0);
}

export type SignCheck = { ok: true } | { ok: false; error: string };

/** Whether `userId` may sign the note now (the repository asks the same in its UPDATE). */
export function canSign(note: { status: NoteStatus; authorUserId: string | null; seenOn: string }, userId: string | null, today: string, hasContent: boolean): SignCheck {
  if (note.status === "signed") return { ok: false, error: "This note is already signed." };
  if (note.status === "discarded") return { ok: false, error: "This draft was discarded." };
  if (!userId || note.authorUserId !== userId) return { ok: false, error: "Only the note's author can sign it." };
  if (note.seenOn > today) return { ok: false, error: "The consultation date is in the future." };
  if (!hasContent) return { ok: false, error: "Write the note before signing it." };
  return { ok: true };
}

/**
 * The canonical text the content fingerprint is taken from (sha256 on the server): stable key order, the template
 * id and the consultation date, so the same content always gives the same fingerprint.
 */
export function canonicalNoteContent(input: { templateId: string; seenOn: string; sections: Record<string, string>; bodyChart: BodyChart | null }): string {
  const sections = Object.keys(input.sections)
    .sort()
    .map((k) => [k, input.sections[k]]);
  const markers = (input.bodyChart?.markers ?? []).map((m) => [m.view, m.x, m.y, m.kind, m.intensity ?? null, m.label ?? null]);
  return JSON.stringify({ v: 1, templateId: input.templateId, seenOn: input.seenOn, sections, markers });
}

/** The status shown on screen. */
export function noteStatusLabel(note: { status: NoteStatus; enteredInError: boolean; amendmentCount: number }): string {
  if (note.status === "draft") return "Draft";
  if (note.status === "discarded") return "Discarded draft";
  if (note.enteredInError) return "Entered in error";
  return note.amendmentCount > 0 ? "Signed, amended" : "Signed";
}

/** First 8 characters of a fingerprint, grouped for reading aloud ("3f2a 9c01"). */
export function shortFingerprint(hex: string | null): string {
  if (!hex || !/^[0-9a-f]{64}$/.test(hex)) return "";
  return `${hex.slice(0, 4)} ${hex.slice(4, 8)}`;
}
