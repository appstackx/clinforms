/**
 * ClinForms – OUR documented import format ("TM3 export upload – available now").
 *
 * BROWSER-SAFE on purpose (zod + core only, no "server-only"): the Studio imports IMPORT_FORMAT_GUIDE
 * to explain the format next to the upload box. The parser (./parser.ts) is server-only.
 *
 * Mapping a clinic's actual TM3 export waits for a real sample; until then clinics (or we) convert an
 * export into one of these three shapes. Fictional data only in the public demo.
 *
 * 1. JSON (`format: "json"`) – the same snake_case shape as the simulated clinic-system API
 *    (connectors/tm3-sim/wire.ts), gathered into one document:
 *
 *      {
 *        "format": "appstackx-reports.import", "version": 1,          // optional, checked if present
 *        "patient":  { id?, title?, first_name, last_name, date_of_birth, sex?, address?, phone?, email?,
 *                      occupation?, employer_name? },
 *        "episode":  { id?, title?, status, start_date?, end_date?,
 *                      referral: { source_type, organisation_name, reference?, contact_name?, address?,
 *                                  referral_date?, reason? },
 *                      incident?: { date?, mechanism, incident_type },
 *                      consent:  { disclosure_consent_recorded, recorded_on? },
 *                      primary_clinician?: { name, hcpc, role? } },
 *        "notes":            [ { id?, note_date, note_time?, note_type, author: { name, hcpc, role? },
 *                                subjective, objective, assessment, plan, free_text?,
 *                                past_medical_history?, social_history?, appointment_id? } ],
 *        "appointments":     [ { id?, date, start_time, duration_minutes?, status, status_reason?,
 *                                clinician?, note_id? } ],
 *        "outcome_measures": [ { id?, instrument, unit?, higher_is_worse?,
 *                                scores: [ { date, value, note_id? } ] } ]
 *      }
 *
 *    Payloads copied from the simulated API (with `_simulated`, `episode_id`, paging fields) are
 *    accepted too: unknown fields are ignored.
 *
 * 2. CSV (`format: "csv"`) – one row per clinical note or appointment, with the patient, referral,
 *    incident and consent as `# key: value` lines above the header row (keys: CSV_METADATA_KEYS).
 *    Required columns: date,type,author,hcpc,subjective,objective,assessment,plan.
 *    Optional columns: time, status (ATT|DNA|LCN|CNC|BOOKED), reason, free_text, past_medical_history,
 *    social_history, and one column per outcome instrument (NDI, ODI, NPRS, PSFS, QuickDASH) holding
 *    that day's score.
 *    With a `status` column, every row with a status is an appointment (time required); an ATT row with
 *    note text is also the note of that appointment; a DNA/LCN/CNC row may leave the note columns empty.
 *    Without a `status` column there is no attendance record.
 *
 * 3. Pasted anonymised notes (`format: "text"`) – free text split into notes at every line that
 *    STARTS with a date (DD/MM/YYYY, YYYY-MM-DD or "18 March 2026"), e.g.
 *      "18/03/2026 09:00 – Initial assessment – Sarah Reid (PH-DEMO-01)".
 *    The heading may name the note type (initial assessment, follow-up, discharge, telephone) and the
 *    author "Name (HCPC number)". Inside a note, lines starting "S:", "O:", "A:", "P:" (or Subjective:,
 *    Objective:, Assessment:, Plan:) fill the SOAP fields, "PMH:" / "SH:" the history fields; anything
 *    else is kept as free text.
 *    `Key: value` lines before the first dated note give the patient and referral (TEXT_HEADER_KEYS).
 *    Scores on a line starting "Outcome measures:" (or "Outcomes:" / "Scores:"), written like
 *    "NDI 42%", "ODI 30%", "NPRS 7/10", "QuickDASH 52" or "PSFS 6", become outcome measures.
 *    Pasted notes carry no attendance record (use CSV or JSON for appointments).
 *
 * Dates may be written YYYY-MM-DD or DD/MM/YYYY everywhere.
 *
 * Owner: integration agent.
 */
import { z } from "zod";
import { PRODUCT } from "../../config.public";

export const IMPORT_FORMAT_ID = "appstackx-reports.import" as const;
export const IMPORT_FORMAT_VERSION = 1 as const;

/** Largest import accepted (characters of content). Keeps the request well under 4.5 MB. */
export const MAX_IMPORT_CHARS = 2_000_000;
export const MAX_IMPORT_NOTES = 500;
export const MAX_IMPORT_ROWS = 2_000;

/* ------------------------------------------------------------------------------------------------
 * Shared field schemas
 * ----------------------------------------------------------------------------------------------*/

/** YYYY-MM-DD or DD/MM/YYYY (normalised to ISO by the parser). */
export const ImportDateSchema = z
  .string()
  .trim()
  .regex(/^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})$/, "Use a date like 2026-03-18 or 18/03/2026");

const optionalText = z.string().nullish();
const optionalDate = ImportDateSchema.nullish();

export const ImportClinicianSchema = z.object({
  name: z.string().trim().min(1, "The clinician's name is missing"),
  hcpc: z.string().trim().min(1, "The clinician's HCPC registration number is missing"),
  role: optionalText,
});

const ImportAddressSchema = z.union([
  z.string(),
  z.object({
    line1: z.string(),
    line2: optionalText,
    town: z.string().nullish(),
    postcode: z.string().nullish(),
  }),
]);

export const ReferralTypeSchema = z.enum(["solicitor", "employer", "insurer", "case_manager", "self", "gp"]);
export const NoteTypeImportSchema = z.enum(["initial_assessment", "follow_up", "discharge", "telephone", "other"]);
export const AppointmentStatusImportSchema = z.enum(["ATT", "DNA", "LCN", "CNC", "BOOKED"]);
export const InstrumentImportSchema = z.enum(["NDI", "ODI", "NPRS", "PSFS", "QuickDASH"]);
export const IncidentTypeImportSchema = z.enum(["road_traffic_accident", "workplace", "slip_trip_fall", "sport", "other"]);

/* ------------------------------------------------------------------------------------------------
 * JSON import document
 * ----------------------------------------------------------------------------------------------*/

export const ImportPatientSchema = z.object({
  id: optionalText,
  title: optionalText,
  first_name: z.string().trim().min(1, "The patient's first name is missing"),
  last_name: z.string().trim().min(1, "The patient's last name is missing"),
  date_of_birth: ImportDateSchema,
  sex: z.enum(["female", "male", "other", "not_recorded"]).nullish(),
  address: ImportAddressSchema.nullish(),
  phone: optionalText,
  email: optionalText,
  occupation: optionalText,
  employer_name: optionalText,
});

export const ImportEpisodeSchema = z.object({
  id: optionalText,
  title: optionalText,
  status: z.enum(["open", "discharged"]),
  start_date: optionalDate,
  end_date: optionalDate,
  referral: z.object({
    source_type: ReferralTypeSchema,
    organisation_name: z.string().trim().min(1, "The instructing party's name is missing"),
    reference: optionalText,
    contact_name: optionalText,
    address: optionalText,
    referral_date: optionalDate,
    reason: optionalText,
  }),
  incident: z
    .object({
      date: optionalDate,
      mechanism: z.string(),
      incident_type: IncidentTypeImportSchema,
    })
    .nullish(),
  consent: z.object({
    disclosure_consent_recorded: z.boolean(),
    recorded_on: optionalDate,
  }),
  primary_clinician: ImportClinicianSchema.nullish(),
});

export const ImportNoteSchema = z.object({
  id: optionalText,
  note_date: ImportDateSchema,
  note_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time like 09:30")
    .nullish(),
  note_type: NoteTypeImportSchema,
  author: ImportClinicianSchema,
  subjective: z.string(),
  objective: z.string(),
  assessment: z.string(),
  plan: z.string(),
  free_text: optionalText,
  past_medical_history: optionalText,
  social_history: optionalText,
  appointment_id: optionalText,
});

export const ImportAppointmentSchema = z.object({
  id: optionalText,
  date: ImportDateSchema,
  start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time like 09:30"),
  duration_minutes: z.number().int().positive().nullish(),
  status: AppointmentStatusImportSchema,
  status_reason: optionalText,
  clinician: ImportClinicianSchema.nullish(),
  note_id: optionalText,
});

export const ImportOutcomeMeasureSchema = z.object({
  id: optionalText,
  instrument: InstrumentImportSchema,
  unit: optionalText,
  higher_is_worse: z.boolean().nullish(),
  scores: z
    .array(z.object({ date: ImportDateSchema, value: z.number(), note_id: optionalText }))
    .min(1, "An outcome measure needs at least one score"),
});

export const ImportDocumentSchema = z.object({
  format: z.literal(IMPORT_FORMAT_ID).optional(),
  version: z.literal(IMPORT_FORMAT_VERSION).optional(),
  patient: ImportPatientSchema,
  episode: ImportEpisodeSchema,
  notes: z.array(ImportNoteSchema).min(1, "The export has no clinical notes").max(MAX_IMPORT_NOTES),
  appointments: z.array(ImportAppointmentSchema).max(MAX_IMPORT_ROWS).default([]),
  outcome_measures: z.array(ImportOutcomeMeasureSchema).max(50).default([]),
});

export type ImportDocument = z.infer<typeof ImportDocumentSchema>;

/* ------------------------------------------------------------------------------------------------
 * Instrument defaults (unit and direction) when an import does not say
 * ----------------------------------------------------------------------------------------------*/

export const INSTRUMENT_DEFAULTS: Record<z.infer<typeof InstrumentImportSchema>, { unit: string; higherIsWorse: boolean }> = {
  NDI: { unit: "%", higherIsWorse: true },
  ODI: { unit: "%", higherIsWorse: true },
  NPRS: { unit: "/10", higherIsWorse: true },
  PSFS: { unit: "/10", higherIsWorse: false },
  QuickDASH: { unit: "/100", higherIsWorse: true },
};

/* ------------------------------------------------------------------------------------------------
 * CSV and text documentation (also used by the parser)
 * ----------------------------------------------------------------------------------------------*/

export const CSV_REQUIRED_COLUMNS = ["date", "type", "author", "hcpc", "subjective", "objective", "assessment", "plan"] as const;
export const CSV_OPTIONAL_COLUMNS = [
  "time",
  "status",
  "reason",
  "free_text",
  "past_medical_history",
  "social_history",
  "NDI",
  "ODI",
  "NPRS",
  "PSFS",
  "QuickDASH",
] as const;

/** `# key: value` lines above the CSV header row. Required keys are marked. */
export const CSV_METADATA_KEYS: ReadonlyArray<{ key: string; required: boolean; example: string }> = [
  { key: "patient.first_name", required: true, example: "Priya" },
  { key: "patient.last_name", required: true, example: "Nair" },
  { key: "patient.date_of_birth", required: true, example: "14/09/1984" },
  { key: "patient.sex", required: false, example: "female" },
  { key: "patient.title", required: false, example: "Mrs" },
  { key: "patient.id", required: false, example: "CLINIC-30117" },
  { key: "patient.occupation", required: false, example: "Primary school teacher" },
  { key: "patient.employer_name", required: false, example: "Oakfield Primary School (fictional)" },
  { key: "episode.id", required: false, example: "EP-30117-1" },
  { key: "episode.title", required: false, example: "Right shoulder pain after a fall" },
  { key: "episode.status", required: false, example: "discharged" },
  { key: "referral.type", required: true, example: "solicitor" },
  { key: "referral.name", required: true, example: "Calder & Moss Solicitors (fictional)" },
  { key: "referral.reference", required: false, example: "CM/PI/0815" },
  { key: "referral.contact_name", required: false, example: "Daniel Shaw" },
  { key: "referral.address", required: false, example: "8 Market Row (fictional), Milton Keynes" },
  { key: "referral.date", required: false, example: "08/04/2026" },
  { key: "referral.reason", required: false, example: "Treatment and report following a fall" },
  { key: "incident.date", required: false, example: "03/04/2026" },
  { key: "incident.type", required: false, example: "slip_trip_fall" },
  { key: "incident.mechanism", required: false, example: "Slipped on a wet floor and fell onto an outstretched right arm" },
  { key: "consent.recorded", required: true, example: "yes" },
  { key: "consent.date", required: false, example: "10/04/2026" },
];

/** `Key: value` lines at the top of pasted notes (case-insensitive; synonyms accepted). */
export const TEXT_HEADER_KEYS: ReadonlyArray<{ key: string; synonyms: string[]; required: boolean; example: string }> = [
  { key: "Patient", synonyms: ["Name", "Patient name"], required: false, example: "Anonymised Patient" },
  { key: "Date of birth", synonyms: ["DOB"], required: true, example: "14/09/1984" },
  { key: "Sex", synonyms: ["Gender"], required: false, example: "female" },
  { key: "Occupation", synonyms: [], required: false, example: "Teacher" },
  { key: "Instructing party", synonyms: ["Solicitor", "Insurer", "Case manager", "Instructed by"], required: true, example: "Calder & Moss Solicitors (fictional)" },
  { key: "Instructing party type", synonyms: ["Referral type"], required: false, example: "solicitor" },
  { key: "Reference", synonyms: ["Ref", "Instructing reference"], required: false, example: "CM/PI/0815" },
  { key: "Incident date", synonyms: ["Date of incident", "Date of accident", "Accident date", "Injury date"], required: false, example: "03/04/2026" },
  { key: "Incident", synonyms: ["Mechanism", "Accident", "Mechanism of injury"], required: false, example: "Slipped on a wet floor" },
  { key: "Incident type", synonyms: [], required: false, example: "slip_trip_fall" },
  { key: "Consent", synonyms: ["Disclosure consent", "Consent to disclose"], required: false, example: "yes (10/04/2026)" },
  { key: "Clinician", synonyms: ["Physiotherapist", "Author"], required: false, example: "Sarah Reid (PH-DEMO-01)" },
  { key: "Episode status", synonyms: ["Status"], required: false, example: "discharged" },
  { key: "Title", synonyms: ["Episode", "Condition"], required: false, example: "Right shoulder pain after a fall" },
];

/** Plain data for the Studio's "About the import format" panel. */
export const IMPORT_FORMAT_GUIDE = {
  title: `${PRODUCT.name} import format (v1)`,
  summary:
    "Upload the patient's notes as your clinic system prints or exports them – a PDF printed or saved from the system, a Word document, a CSV export or a text file – or paste them. Notes in the documented layout below are used straight away; other layouts are read and shown to you to check (dates, clinicians, attendance, patient details) before they are used.",
  formats: [
    {
      id: "general" as const,
      label: "Notes in any other layout",
      description:
        'Each note under a line that starts with its date ("18/03/2026", "18 March 2026", "2026-03-18", optionally with a time), patient details as "Label: value" lines at the top, a CSV or Word table with a date column. The clinician is taken from the heading or the signature; scores such as "NPRS 7/10" or "QuickDASH 52.3" become outcome measures. Scanned notes cannot be read.',
    },
    {
      id: "pdf" as const,
      label: "Printed notes (PDF)",
      description:
        'The patient\'s clinical notes printed or saved as a PDF from the clinic system (a text PDF, not a scan): patient lines such as "Date of birth:" and "Instructing party:" at the top, then each note under a dated heading with its author, e.g. "18/03/2026 – Initial assessment – Sarah Reid (PH-DEMO-01)", and labelled S/O/A/P lines. No attendance record.',
    },
    {
      id: "json" as const,
      label: "JSON",
      description:
        "Patient, episode (referral, incident, consent), notes with authors, appointments with attendance and outcome scores, in one document.",
    },
    {
      id: "csv" as const,
      label: "CSV",
      description: `One row per note or appointment. Columns: ${CSV_REQUIRED_COLUMNS.join(", ")} (required) and ${CSV_OPTIONAL_COLUMNS.join(", ")} (optional). Patient and referral details go in "# key: value" lines above the header row.`,
    },
    {
      id: "text" as const,
      label: "Pasted notes",
      description:
        'Paste anonymised notes. A new note starts at each line beginning with a date, e.g. "18/03/2026 – Initial assessment – Sarah Reid (PH-DEMO-01)". Put "Date of birth:" and "Instructing party:" lines at the top. Scores on an "Outcome measures:" line become outcome measures. No attendance record.',
    },
  ],
  dates: "Dates may be written as DD/MM/YYYY or YYYY-MM-DD.",
  privacy: "Fictional data only. Do not upload real patient information to the public demo.",
} as const;
