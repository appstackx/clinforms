/**
 * Our assumed shape for a simulated clinic system; not TM3's real schema.
 *
 * Wire types of the SIMULATED TM3 API, sandbox side. Duplicates (by design) the module's
 * src/modules/medreport/connectors/tm3-sim/wire.ts – the sandbox may not import the module.
 * Keep the two in step. These shapes are our assumption, not TM3's schema.
 *
 * Owner: sandbox agent.
 */

export type SimSex = "female" | "male" | "other" | "not_recorded";
export type SimReferralSourceType = "solicitor" | "employer" | "insurer" | "case_manager" | "self" | "gp";
export type SimIncidentType = "road_traffic_accident" | "workplace" | "slip_trip_fall" | "sport" | "other";
export type SimNoteType = "initial_assessment" | "follow_up" | "discharge" | "telephone" | "other";
export type SimAppointmentStatus = "ATT" | "DNA" | "LCN" | "CNC" | "BOOKED";
export type SimInstrument = "NDI" | "ODI" | "NPRS" | "PSFS" | "QuickDASH";

export interface SimClinician {
  name: string;
  /** Demo format only, e.g. "PH-DEMO-01". */
  hcpc: string;
  role: string | null;
}

export interface SimAddress {
  line1: string;
  line2: string | null;
  town: string;
  postcode: string;
}

export interface SimPatient {
  id: string;
  title: string | null;
  first_name: string;
  last_name: string;
  /** YYYY-MM-DD */
  date_of_birth: string;
  sex: SimSex;
  address: SimAddress;
  phone: string | null;
  email: string | null;
  occupation: string | null;
  employer_name: string | null;
  /** ISO date-time */
  registered_at: string;
  episode_count: number;
  _simulated: true;
}

export interface SimReferral {
  source_type: SimReferralSourceType;
  organisation_name: string;
  reference: string | null;
  contact_name: string | null;
  address: string | null;
  referral_date: string | null;
  reason: string | null;
}

export interface SimIncident {
  date: string | null;
  mechanism: string;
  incident_type: SimIncidentType;
}

export interface SimEpisode {
  id: string;
  patient_id: string;
  title: string;
  status: "open" | "discharged";
  start_date: string;
  end_date: string | null;
  referral: SimReferral;
  incident: SimIncident | null;
  consent: { disclosure_consent_recorded: boolean; recorded_on: string | null };
  primary_clinician: SimClinician;
  _simulated: true;
}

export interface SimNote {
  id: string;
  episode_id: string;
  note_date: string;
  /** HH:mm */
  note_time: string | null;
  note_type: SimNoteType;
  author: SimClinician;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  free_text: string | null;
  past_medical_history: string | null;
  social_history: string | null;
  appointment_id: string | null;
  _simulated: true;
}

export interface SimAppointment {
  id: string;
  episode_id: string;
  date: string;
  /** HH:mm */
  start_time: string;
  duration_minutes: number;
  status: SimAppointmentStatus;
  status_reason: string | null;
  clinician: SimClinician;
  note_id: string | null;
  _simulated: true;
}

export interface SimOutcomeMeasure {
  id: string;
  episode_id: string;
  instrument: SimInstrument;
  unit: string;
  higher_is_worse: boolean;
  scores: { date: string; value: number; note_id: string | null }[];
  _simulated: true;
}

/** Every list endpoint: ?page=1&page_size=50 (max 100). */
export interface SimPage<T> {
  data: T[];
  page: number;
  page_size: number;
  total: number;
  next_page: number | null;
  _simulated: true;
}

export interface SimAttachDocumentRequest {
  episode_id: string;
  title: string;
  file_name: string;
  mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" | "application/pdf";
  content_base64: string;
  sha256: string;
  sign_receipt: {
    report_id: string;
    content_sha256: string;
    signer_name: string;
    signer_hcpc: string;
    signed_at: string;
    mac: string;
  };
}

export interface SimAttachDocumentResponse {
  external_document_id: string;
  received_at: string;
  sha256: string;
  _simulated: true;
}

export interface SimError {
  error: { code: string; message: string };
  _simulated: true;
}
