/**
 * ClinForms – the "check the notes" step of a notes upload (production wave 3).
 *
 * When an upload is not in our documented import format (./format.ts), the general notes reader
 * (./general-notes.ts) reads it as ordinary clinic notes – printed to PDF, a Word document, a text file, a CSV
 * export or pasted text – and proposes a structure: the patient's registration details it could read, one entry
 * per dated note (date, time, clinician, type, the note's text exactly as written) and the outcome scores it
 * found. Staff check and correct that proposal in the Studio (dates, clinicians and registration details are
 * editable; a note's text is not), then confirm it; only then is the EpisodeBundle built (./review-bundle.ts),
 * exactly as for any other import. Nothing is drafted before that.
 *
 * BROWSER-SAFE on purpose (zod + core only): the Studio renders and edits a NotesReview and sends it back to
 * POST /connectors/file-import/confirm. The server re-checks everything it receives.
 *
 * Owner: integration agent.
 */
import { z } from "zod";
import {
  AppointmentStatusSchema,
  InstructingPartyTypeSchema,
  IsoDateSchema,
  NoteTypeSchema,
  OutcomeInstrumentSchema,
  TimeSchema,
} from "../../core/schemas";

export const NOTES_REVIEW_VERSION = 1 as const;

/** Limits of a review (the confirm request carries the notes' text back). */
export const NOTES_REVIEW_LIMITS = {
  entries: 500,
  /** Characters of one entry's text (heading + body). */
  entryChars: 40_000,
  /** Characters of every entry's text together. */
  totalChars: 2_000_000,
  outcomes: 1_000,
  warnings: 60,
} as const;

/** Where staff can type a value; empty = not found in the notes (or not known). */
const text = (max: number) => z.string().max(max);
const isoOrEmpty = z.union([z.literal(""), IsoDateSchema]);
const timeOrEmpty = z.union([z.literal(""), TimeSchema]);

/** The registration fields of the review, in the order the Studio shows them. */
export const NOTES_REVIEW_FIELDS = [
  "title",
  "firstName",
  "lastName",
  "dob",
  "sex",
  "address",
  "postcode",
  "phone",
  "email",
  "occupation",
  "employer",
  "instructingPartyName",
  "instructingPartyType",
  "reference",
  "insurerName",
  "membershipNumber",
  "authorisationNumber",
  "referredBy",
  "gpPractice",
  "incidentDate",
  "incidentMechanism",
  "consent",
  "consentDate",
] as const;
export type NotesReviewField = (typeof NOTES_REVIEW_FIELDS)[number];

export const NotesReviewRegistrationSchema = z.object({
  title: text(40),
  firstName: text(100),
  lastName: text(100),
  /** ISO date; a date of birth written with a two-digit year is never completed by the reader. */
  dob: isoOrEmpty,
  sex: z.enum(["", "female", "male", "other"]),
  /** The address as one line ("1 Example Road, Testtown"), without the postcode when that is known. */
  address: text(300),
  postcode: text(12),
  phone: text(40),
  email: text(254),
  occupation: text(120),
  employer: text(200),
  /** Who the completed form is for (the instructing party / referrer of the form). */
  instructingPartyName: text(200),
  instructingPartyType: z.union([z.literal(""), InstructingPartyTypeSchema]),
  /** The instructing party's own reference (claim number, case reference). */
  reference: text(100),
  insurerName: text(200),
  membershipNumber: text(60),
  authorisationNumber: text(60),
  /** Who referred the patient (a GP, consultant or other clinician), as written. */
  referredBy: text(200),
  gpPractice: text(200),
  incidentDate: isoOrEmpty,
  incidentMechanism: text(500),
  consent: z.enum(["", "yes", "no"]),
  consentDate: isoOrEmpty,
});
export type NotesReviewRegistration = z.infer<typeof NotesReviewRegistrationSchema>;

export const EMPTY_REVIEW_REGISTRATION: NotesReviewRegistration = {
  title: "",
  firstName: "",
  lastName: "",
  dob: "",
  sex: "",
  address: "",
  postcode: "",
  phone: "",
  email: "",
  occupation: "",
  employer: "",
  instructingPartyName: "",
  instructingPartyType: "",
  reference: "",
  insurerName: "",
  membershipNumber: "",
  authorisationNumber: "",
  referredBy: "",
  gpPractice: "",
  incidentDate: "",
  incidentMechanism: "",
  consent: "",
  consentDate: "",
};

export const NOTES_ENTRY_KEY_PATTERN = /^E-\d{1,4}$/;

/** One dated block of the notes (one note, or one appointment of a CSV export). */
export const NotesReviewEntrySchema = z.object({
  /** "E-1", "E-2"… in the order the entries appear in the upload. */
  key: z.string().regex(NOTES_ENTRY_KEY_PATTERN),
  /** "" = no date found (the entry is left out until staff give it one). */
  date: isoOrEmpty,
  time: timeOrEmpty,
  /** "" = no clinician found (staff choose one before confirming). */
  clinicianName: text(120),
  clinicianHcpc: text(40),
  type: NoteTypeSchema,
  /** Attendance as written ("" = none). Becomes an appointment only when the review has an attendance record. */
  status: z.union([z.literal(""), AppointmentStatusSchema]),
  /** The reason recorded for a missed or cancelled appointment ("" = none). */
  reason: text(300),
  /** The heading line(s) exactly as read (date, time, clinician, type lines). */
  heading: text(4_000),
  /** The note's own text exactly as read – never rewritten. Labelled S/O/A/P sections are kept on confirm. */
  body: text(NOTES_REVIEW_LIMITS.entryChars),
  /** Where the entry starts in the upload, e.g. "line 12" or "row 4". */
  where: text(40),
  /** false = left out of the record (the reader leaves blocks without a date out until staff give them one). */
  include: z.boolean(),
});
export type NotesReviewEntry = z.infer<typeof NotesReviewEntrySchema>;

export const NotesReviewOutcomeSchema = z.object({
  instrument: OutcomeInstrumentSchema,
  value: z.number().finite(),
  /** "" = the date of its entry (when staff change the entry's date, the score moves with it). */
  date: isoOrEmpty,
  entryKey: z.string().regex(NOTES_ENTRY_KEY_PATTERN),
});
export type NotesReviewOutcome = z.infer<typeof NotesReviewOutcomeSchema>;

export const NotesReviewWarningCodeSchema = z.enum([
  "NO_DATE",
  "NO_CLINICIAN",
  "DOB_TWO_DIGIT_YEAR",
  "DOB_UNCLEAR",
  "AMBIGUOUS_SCORE",
  "PARTIAL_ATTENDANCE",
  "ROW_SKIPPED",
  "EMPTY_DATE_LINE",
  "VALUE_UNCLEAR",
  "NOT_CONSTANT",
  "TRUNCATED",
]);
export type NotesReviewWarningCode = z.infer<typeof NotesReviewWarningCodeSchema>;

export const NotesReviewWarningSchema = z.object({
  code: NotesReviewWarningCodeSchema,
  message: text(400),
  entryKeys: z.array(z.string()).max(NOTES_REVIEW_LIMITS.entries).optional(),
});
export type NotesReviewWarning = z.infer<typeof NotesReviewWarningSchema>;

export const NotesReviewSchema = z
  .object({
    version: z.literal(NOTES_REVIEW_VERSION),
    /** How the structure was proposed: "general" = the general notes reader. */
    layout: z.literal("general"),
    format: z.enum(["pdf", "docx", "text", "csv"]),
    fileName: text(200).optional(),
    /** Pages of a PDF (0 otherwise). */
    pages: z.number().int().nonnegative().max(1_000),
    registration: NotesReviewRegistrationSchema,
    /** The registration fields the reader found in the notes (the rest were not found). */
    detected: z.array(z.enum(NOTES_REVIEW_FIELDS)).max(NOTES_REVIEW_FIELDS.length),
    /** A hint shown under a field, e.g. "Taken from the insurer line – check it". */
    fieldNotes: z.partialRecord(z.enum(NOTES_REVIEW_FIELDS), text(200)).optional(),
    entries: z.array(NotesReviewEntrySchema).max(NOTES_REVIEW_LIMITS.entries),
    outcomes: z.array(NotesReviewOutcomeSchema).max(NOTES_REVIEW_LIMITS.outcomes),
    /** The entries' statuses form an attendance record (each status becomes an appointment on confirm). */
    attendance: z.boolean(),
    warnings: z.array(NotesReviewWarningSchema).max(NOTES_REVIEW_LIMITS.warnings),
  })
  .superRefine((review, ctx) => {
    const total = review.entries.reduce((n, e) => n + e.heading.length + e.body.length, 0);
    if (total > NOTES_REVIEW_LIMITS.totalChars) {
      ctx.addIssue({ code: "custom", path: ["entries"], message: "The notes are too long (over 2 million characters)." });
    }
    const keys = new Set<string>();
    review.entries.forEach((e, i) => {
      if (keys.has(e.key)) ctx.addIssue({ code: "custom", path: ["entries", i, "key"], message: `Entry ${e.key} is listed twice.` });
      keys.add(e.key);
    });
    review.outcomes.forEach((o, i) => {
      if (!keys.has(o.entryKey)) ctx.addIssue({ code: "custom", path: ["outcomes", i, "entryKey"], message: `Score for an unknown entry ${o.entryKey}.` });
    });
  });
export type NotesReview = z.infer<typeof NotesReviewSchema>;

/* ------------------------------------------------------------------------------------------------
 * Plain-English copy of the review step (both Studios). Neutral: no technology or vendor names
 * (checked with core/wording.ts BANNED_TERM_PATTERNS in connectors/file-import/general-notes.test.ts).
 * ----------------------------------------------------------------------------------------------*/

export const NOTES_REVIEW_FIELD_LABELS: Record<NotesReviewField, string> = {
  title: "Title",
  firstName: "First name",
  lastName: "Last name",
  dob: "Date of birth",
  sex: "Sex",
  address: "Address",
  postcode: "Postcode",
  phone: "Phone",
  email: "Email",
  occupation: "Occupation",
  employer: "Employer",
  instructingPartyName: "Who the form is for",
  instructingPartyType: "Type",
  reference: "Their reference",
  insurerName: "Insurer",
  membershipNumber: "Membership or policy number",
  authorisationNumber: "Authorisation number",
  referredBy: "Referred by",
  gpPractice: "GP practice",
  incidentDate: "Date of accident or injury",
  incidentMechanism: "How it happened",
  consent: "Consent to share the report",
  consentDate: "Consent date",
};

/** Fields the record cannot be built without. */
export const NOTES_REVIEW_REQUIRED: readonly NotesReviewField[] = ["firstName", "lastName", "dob", "instructingPartyName", "instructingPartyType"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const NOTES_REVIEW_COPY = {
  title: "Check the notes before they are used",
  intro:
    "These notes are not in the documented import layout, so they were read as ordinary clinic notes. Check what was found: correct the dates, clinicians and patient details where needed. The notes' own text is used exactly as written. Nothing is drafted until you confirm.",
  summary: (entries: number, clinicians: number, scores: number) =>
    `${plural(entries, "entry", "entries")} · ${plural(clinicians, "clinician")} · ${plural(scores, "outcome score")}`,
  patientHeading: "Patient and referral details",
  patientHint: "Found in the notes where marked. Anything the notes did not state clearly is left blank – fill it in or leave it empty.",
  foundTag: "From the notes",
  notFoundTag: "Not found",
  requiredTag: "Required",
  entriesHeading: "Notes",
  entriesHint: "One entry per dated note. Change a date or clinician if it was read wrongly; untick an entry to leave it out.",
  include: "Include",
  showText: "Show the full text",
  hideText: "Hide the full text",
  noText: "(no text under this heading)",
  clinicianNone: "Choose a clinician",
  clinicianOther: "Someone else…",
  clinicianNotRecorded: "Not recorded",
  clinicianNameLabel: "Clinician's name",
  clinicianHcpcLabel: "HCPC number (optional)",
  scoresHeading: "Outcome scores found",
  scoresNone: "No outcome scores (such as NPRS 7/10 or QuickDASH 52.3) were found.",
  attendanceOn: "Attendance is taken from the status of each entry.",
  attendanceOff: "These notes carry no attendance record.",
  bulkClinicianLabel: "Clinician for these entries",
  bulkApply: "Apply",
  confirm: "Use these notes",
  confirming: "Building the patient record…",
  back: "Choose another file",
  blockedPrefix: "Before you continue:",
  missingField: (label: string) => `enter the ${label.toLowerCase()}`,
  noClinician: (n: number) => `${plural(n, "entry", "entries")} without a clinician – choose one`,
  noDate: (n: number) => `no date found for ${plural(n, "block")} – give ${n === 1 ? "it" : "them"} a date to include ${n === 1 ? "it" : "them"}, or leave ${n === 1 ? "it" : "them"} out`,
  includedNoDate: (n: number) => `${plural(n, "included entry", "included entries")} without a date – give ${n === 1 ? "it" : "them"} a date or untick ${n === 1 ? "it" : "them"}`,
  nothingIncluded: "include at least one dated note",
  fromInsurer: "Taken from the insurer line – check it",
  fromReferrer: "Taken from the referral line – check it",
} as const;

/** Every fixed string and a sample of every function's output, for the wording guard. */
export function notesReviewCopyStrings(): string[] {
  const out: string[] = [];
  for (const v of Object.values(NOTES_REVIEW_COPY)) {
    if (typeof v === "string") out.push(v);
  }
  out.push(
    NOTES_REVIEW_COPY.summary(1, 1, 1),
    NOTES_REVIEW_COPY.summary(12, 2, 5),
    NOTES_REVIEW_COPY.missingField("Date of birth"),
    NOTES_REVIEW_COPY.noClinician(1),
    NOTES_REVIEW_COPY.noClinician(3),
    NOTES_REVIEW_COPY.noDate(1),
    NOTES_REVIEW_COPY.noDate(2),
    NOTES_REVIEW_COPY.includedNoDate(1),
    NOTES_REVIEW_COPY.includedNoDate(4),
    ...Object.values(NOTES_REVIEW_FIELD_LABELS),
  );
  return out;
}
