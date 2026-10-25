/**
 * Display labels for contract enums (UK English). Pure; shared by the UI and docgen.
 */
import type {
  AnswerType,
  AppointmentStatus,
  ComputedFactFormat,
  DataCheckCode,
  FillSourceKind,
  FormAnalysisMode,
  FormFieldConfidence,
  FormKind,
  IncidentType,
  InstructingPartyType,
  NoteType,
  OutcomeInstrument,
  ParagraphBasis,
  ParagraphOrigin,
  ReferrerType,
  RegistrationPath,
  ReportFlagCode,
  SectionKind,
  SignoffPart,
} from "./types";
import { WORDING } from "./wording";

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  ATT: "Attended",
  DNA: "Did not attend",
  LCN: "Late cancellation",
  CNC: "Cancelled with notice",
  BOOKED: "Booked",
};

export const NOTE_TYPE_LABELS: Record<NoteType, string> = {
  initial_assessment: "Initial assessment",
  follow_up: "Follow-up",
  discharge: "Discharge",
  telephone: "Telephone consultation",
  other: "Other",
};

export const INSTRUMENT_LABELS: Record<OutcomeInstrument, string> = {
  NDI: "Neck Disability Index (NDI)",
  ODI: "Oswestry Disability Index (ODI)",
  NPRS: "Numeric Pain Rating Scale (NPRS)",
  PSFS: "Patient-Specific Functional Scale (PSFS)",
  QuickDASH: "QuickDASH",
};

export const INSTRUCTING_PARTY_LABELS: Record<InstructingPartyType, string> = {
  solicitor: "Solicitor",
  employer: "Employer",
  insurer: "Insurer",
  case_manager: "Case manager",
  mlc: "Medico-legal company",
  other: "Other referrer",
};

/** Referrer types share the instructing-party labels. */
export const REFERRER_TYPE_LABELS: Record<ReferrerType, string> = INSTRUCTING_PARTY_LABELS;

export const FORM_KIND_LABELS: Record<FormKind, string> = {
  docx: "Word form",
  pdf_acroform: "Fillable PDF",
  pdf_flat: "Flat PDF (best effort)",
  questions: "Portal questions",
};

export const ANSWER_TYPE_LABELS: Record<AnswerType, string> = {
  short_text: "Short text",
  long_text: "Long text",
  date: "Date",
  yes_no: "Yes / No",
  checkbox: "Tick box",
  single_choice: "Single choice",
  number: "Number",
  signature: "Signature",
  clinician_name: "Clinician name",
  hcpc_number: "HCPC number",
  date_signed: "Date signed",
  table: "Table (rows)",
};

/** A referrer the form analysis could not read off the form: the map is not confirmed until someone names it. */
export const REFERRER_TO_BE_CONFIRMED = "Referrer to be confirmed";

export const FILL_SOURCE_LABELS: Record<FillSourceKind, string> = {
  registration: "From TM3 registration – filled by code",
  computed_fact: "Computed from the record – filled by code",
  notes_narrative: WORDING.labels.fillSourceNotesNarrative,
  clinician_opinion: "Clinician opinion – only if recorded, else for the clinician",
  signoff: "Sign-off – filled on approval",
  leave_blank: "Leave blank",
  fixed: "Fixed answer – the same for every patient",
  appointments_table: "From the appointment record – one row per attended session, filled by code",
};

/**
 * Fix round 1 (B0-19): where a "record value" really comes from, in the staff's own words – a detail staff type on each
 * report, a choice the physiotherapist makes on each report, or the clinic's own details – instead of "the patient
 * record" (core/forms.ts recordSourceOf).
 */
export type RecordSource = "staff_entry" | "physio_choice" | "clinic";

export const RECORD_SOURCE_LABELS: Record<RecordSource, { short: string; long: string }> = {
  staff_entry: { short: "Entered by staff", long: "Entered by staff on each report – type it from your records" },
  physio_choice: { short: "Chosen by the physiotherapist", long: "Chosen by the physiotherapist on each report" },
  clinic: { short: "From your Clinic details", long: "From your Clinic details – change it here for this patient's site" },
};

/** Fix round 2 (B1-15): what staff do with a staff-entry question, by its answer type – tick it, choose it or type it. */
export function staffEntryVerb(answerType: AnswerType | null | undefined): "tick it" | "choose it" | "type it" {
  if (answerType === "checkbox") return "tick it";
  return answerType === "single_choice" || answerType === "yes_no" ? "choose it" : "type it";
}

/** RECORD_SOURCE_LABELS[source].long, with a staff entry's verb by its answer type ("…– tick it from your records"). */
export function recordSourceLong(source: RecordSource, answerType?: AnswerType | null): string {
  return source === "staff_entry" ? `Entered by staff on each report – ${staffEntryVerb(answerType)} from your records` : RECORD_SOURCE_LABELS[source].long;
}

export const REGISTRATION_PATH_LABELS: Record<RegistrationPath, string> = {
  "patient.fullName": "Patient full name",
  "patient.firstName": "Patient first name",
  "patient.lastName": "Patient surname",
  "patient.dob": "Date of birth",
  "patient.age": "Age",
  "patient.sex": "Sex",
  "patient.address": "Address",
  "patient.addressLines": "Address without the postcode, one part per line",
  "patient.postcode": "Postcode",
  "patient.occupation": "Occupation",
  "patient.employer": "Employer",
  "referral.referrerName": "Referrer name",
  "referral.reference": "Referrer reference",
  "incident.date": "Date of incident",
  "incident.mechanism": "Mechanism of injury",
  "episode.firstSeen": "First seen",
  "episode.lastSeen": "Last seen",
  "episode.dischargeDate": "Discharge date",
  "clinic.name": "Clinic name",
  "clinic.address": "Clinic address",
  "clinic.addressLines": "Clinic address without the postcode, one part per line",
  "clinic.postcode": "Clinic postcode",
  "staff.entry": "Not held in the record – entered by staff for each report",
  "episode.firstSeenTime": "First attended appointment – time",
  "episode.attendedDate": "An attended appointment (1st, 2nd…) – date",
  "episode.attendedTime": "An attended appointment (1st, 2nd…) – time",
  "report.date": "Date of report",
  "clinician.name": "Treating clinician",
  "clinician.hcpc": "Treating clinician HCPC number",
  "clinician.profession": "Treating clinician profession",
  "patient.title": "Patient title",
  "patient.phone": "Patient phone number",
  "patient.email": "Patient email address",
  "clinic.phone": "Clinic phone number",
  "clinic.email": "Clinic email address",
  "referral.insurerName": "Insurer name",
  "referral.membershipNumber": "Insurer membership number",
  "referral.authorisationNumber": "Insurer authorisation number",
};

export const COMPUTED_FACT_FORMAT_LABELS: Record<ComputedFactFormat, string> = {
  sessions_attended: "Number of sessions attended",
  dna_count: "Number of missed appointments (DNA)",
  summary: "Summary",
  first_score: "First recorded score (outcome measures)",
  latest_score: "Latest recorded score (outcome measures)",
  first_scores: "First recorded score of every outcome measure",
  latest_scores: "Latest recorded score of every outcome measure",
};

export const SIGNOFF_PART_LABELS: Record<SignoffPart, string> = {
  signature: "Signature",
  name: "Name of approving clinician",
  hcpc: "HCPC number of approving clinician",
  date: "Date signed",
};

export const FORM_FIELD_CONFIDENCE_LABELS: Record<FormFieldConfidence, string> = {
  high: "High confidence",
  medium: "Check",
  low: "Needs review",
};

/** How a form map was produced (customer-facing wording: core/wording.ts). */
export const FORM_ANALYSIS_MODE_LABELS: Record<FormAnalysisMode, string> = WORDING.labels.analysisMode;

export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  road_traffic_accident: "Road traffic accident",
  workplace: "Workplace injury",
  slip_trip_fall: "Slip, trip or fall",
  sport: "Sports injury",
  other: "Other",
};

export const SECTION_KIND_LABELS: Record<SectionKind, string> = {
  from_records: WORDING.labels.sectionKindFromRecords,
  ai_narrative: WORDING.labels.sectionKindNarrative,
  clinician_opinion: "Clinician opinion",
  declaration: "Declaration",
};

export const PARAGRAPH_ORIGIN_LABELS: Record<ParagraphOrigin, string> = {
  ai: WORDING.labels.paragraphOriginAi,
  edited: "Edited",
  clinician: "Clinician",
  from_records: "From records",
};

export const PARAGRAPH_BASIS_LABELS: Record<ParagraphBasis, string> = {
  patient_reported: "Patient reported",
  clinician_observed: "Clinician observed",
  clinician_opinion_recorded: "Opinion recorded in notes",
  record: "Record",
};

export const FLAG_CODE_LABELS: Record<ReportFlagCode, string> = {
  UNKNOWN_SOURCE_ID: "Unknown source ID",
  UNCITED_PARAGRAPH: "Paragraph has no source",
  FIGURE_NOT_IN_SOURCE: "Date or figure not in the cited source",
  TERM_NOT_IN_SOURCE: "Clinical term not as the record writes it",
  OPINION_LANGUAGE: "Opinion language not in the cited note",
  OTHER_CLINICIAN_VOICE: "Another clinician's note written as yours",
  SCOPE_TERM: "Out-of-scope information",
  MISSING_PLACEHOLDER: "Missing field",
  OPEN_GAP: "Open gap",
  DATA_CHECK: "Data check",
  DRAFT_FIT: "Check where it goes on the form",
  NOT_APPLICABLE_ANSWERED: "Answered, but the box does not apply",
};

export const DATA_CHECK_LABELS: Record<DataCheckCode, string> = {
  NO_PRE_INCIDENT_HISTORY: "No pre-incident history recorded",
  DNA_WITHOUT_REASON: "Missed appointment without a recorded reason",
  EPISODE_STILL_OPEN: "Episode still open",
  NO_DISCHARGE_NOTE: "No discharge note",
  SINGLE_TIMEPOINT_OUTCOME: "Outcome measure recorded only once",
  CONSENT_NOT_RECORDED: "Disclosure consent not recorded",
  INCIDENT_DATE_MISSING: "Incident date missing",
  MULTIPLE_CLINICIANS: "Notes written by more than one clinician",
};

/**
 * Fix round 3 (B2-33): punctuation doubled where a printed label or option that ends in a full stop or colon is quoted
 * or listed before more punctuation – "brief details.”." → "brief details”.", "current symptoms.." → "current
 * symptoms.", "comments.:" → "comments:". An ellipsis ("…", "...") is kept.
 */
export function tidyPunctuation(text: string): string {
  return text
    .replace(/([.;:])([”"’])([.,;:!?])/g, "$2$3")
    .replace(/(?<!\.)\.\.(?!\.)/g, ".")
    .replace(/(?<!\.)\.([:;,])/g, "$1");
}

/** A printed label or option without the full stop, colon or semicolon it ends with ("…brief details." → "…brief details"). */
export function withoutEndPunctuation(label: string): string {
  return label.trim().replace(/\s*[.:;]+$/, "");
}
