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

export const REGISTRATION_PATH_LABELS: Record<RegistrationPath, string> = {
  "patient.fullName": "Patient full name",
  "patient.firstName": "Patient first name",
  "patient.lastName": "Patient surname",
  "patient.dob": "Date of birth",
  "patient.age": "Age",
  "patient.sex": "Sex",
  "patient.address": "Address",
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
  SCOPE_TERM: "Out-of-scope information",
  MISSING_PLACEHOLDER: "Missing field",
  OPEN_GAP: "Open gap",
  DATA_CHECK: "Data check",
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
