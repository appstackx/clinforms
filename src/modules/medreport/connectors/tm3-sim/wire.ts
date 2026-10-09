import "server-only";

/**
 * Wire format of the SIMULATED TM3 API (/api/tm3-sim/v1). snake_case, paged.
 *
 * Our assumed shape for a simulated clinic system; not TM3's real schema.
 *
 * These shapes are OUR ASSUMPTION for the demo, not TM3's schema. The sandbox side duplicates them as
 * plain types in src/sandbox/tm3-sim/wire-types.ts (the sandbox may not import the module); keep the two
 * in step. The mapper (./mapper.ts) turns these into an EpisodeBundle.
 *
 * Owner: sandbox/fixtures agent (may add optional fields; must mirror them in wire-types.ts).
 */
import { z } from "zod";

const Simulated = z.literal(true);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const SimClinicianSchema = z.object({
  name: z.string(),
  hcpc: z.string(),
  role: z.string().nullable(),
});

export const SimAddressSchema = z.object({
  line1: z.string(),
  line2: z.string().nullable(),
  town: z.string(),
  postcode: z.string(),
});

export const SimPatientSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  first_name: z.string(),
  last_name: z.string(),
  date_of_birth: IsoDate,
  sex: z.enum(["female", "male", "other", "not_recorded"]),
  address: SimAddressSchema,
  phone: z.string().nullable(),
  email: z.string().nullable(),
  occupation: z.string().nullable(),
  employer_name: z.string().nullable(),
  registered_at: z.string(),
  /** Number of episodes; 0 for registration-only patients. */
  episode_count: z.number().int().nonnegative(),
  _simulated: Simulated,
});

export const SimReferralSchema = z.object({
  source_type: z.enum(["solicitor", "employer", "insurer", "case_manager", "self", "gp"]),
  organisation_name: z.string(),
  reference: z.string().nullable(),
  contact_name: z.string().nullable(),
  address: z.string().nullable(),
  referral_date: IsoDate.nullable(),
  reason: z.string().nullable(),
});

export const SimIncidentSchema = z.object({
  date: IsoDate.nullable(),
  mechanism: z.string(),
  incident_type: z.enum(["road_traffic_accident", "workplace", "slip_trip_fall", "sport", "other"]),
});

export const SimEpisodeSchema = z.object({
  id: z.string(),
  patient_id: z.string(),
  title: z.string(),
  status: z.enum(["open", "discharged"]),
  start_date: IsoDate,
  end_date: IsoDate.nullable(),
  referral: SimReferralSchema,
  incident: SimIncidentSchema.nullable(),
  consent: z.object({
    disclosure_consent_recorded: z.boolean(),
    recorded_on: IsoDate.nullable(),
  }),
  primary_clinician: SimClinicianSchema,
  _simulated: Simulated,
});

export const SimNoteSchema = z.object({
  id: z.string(),
  episode_id: z.string(),
  note_date: IsoDate,
  note_time: z.string().nullable(),
  note_type: z.enum(["initial_assessment", "follow_up", "discharge", "telephone", "other"]),
  author: SimClinicianSchema,
  subjective: z.string(),
  objective: z.string(),
  assessment: z.string(),
  plan: z.string(),
  free_text: z.string().nullable(),
  past_medical_history: z.string().nullable(),
  social_history: z.string().nullable(),
  appointment_id: z.string().nullable(),
  _simulated: Simulated,
});

export const SimAppointmentSchema = z.object({
  id: z.string(),
  episode_id: z.string(),
  date: IsoDate,
  start_time: z.string(),
  duration_minutes: z.number().int().positive(),
  status: z.enum(["ATT", "DNA", "LCN", "CNC", "BOOKED"]),
  status_reason: z.string().nullable(),
  clinician: SimClinicianSchema,
  note_id: z.string().nullable(),
  _simulated: Simulated,
});

export const SimOutcomeMeasureSchema = z.object({
  id: z.string(),
  episode_id: z.string(),
  instrument: z.enum(["NDI", "ODI", "NPRS", "PSFS", "QuickDASH"]),
  unit: z.string(),
  higher_is_worse: z.boolean(),
  scores: z.array(
    z.object({
      date: IsoDate,
      value: z.number(),
      note_id: z.string().nullable(),
    }),
  ),
  _simulated: Simulated,
});

/** Every list endpoint is paged: ?page=1&page_size=50 (max 100). */
export function simPageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    page: z.number().int().positive(),
    page_size: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    next_page: z.number().int().positive().nullable(),
    _simulated: Simulated,
  });
}

export const SimPatientsPageSchema = simPageSchema(SimPatientSchema);
export const SimEpisodesPageSchema = simPageSchema(SimEpisodeSchema);
export const SimNotesPageSchema = simPageSchema(SimNoteSchema);
export const SimAppointmentsPageSchema = simPageSchema(SimAppointmentSchema);
export const SimOutcomeMeasuresPageSchema = simPageSchema(SimOutcomeMeasureSchema);

/** POST /patients/{id}/documents */
export const SimAttachDocumentRequestSchema = z.object({
  episode_id: z.string(),
  title: z.string(),
  file_name: z.string(),
  mime_type: z.enum([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/pdf",
  ]),
  content_base64: z.string(),
  sha256: z.string(),
  sign_receipt: z.object({
    report_id: z.string(),
    content_sha256: z.string(),
    signer_name: z.string(),
    signer_hcpc: z.string(),
    signed_at: z.string(),
    mac: z.string(),
  }),
});

export const SimAttachDocumentResponseSchema = z.object({
  external_document_id: z.string(),
  received_at: z.string(),
  sha256: z.string(),
  _simulated: Simulated,
});

/** Error body of the simulated API (401 without/with a wrong Bearer TM3_SIM_TOKEN, 404, 422). */
export const SimErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
  _simulated: Simulated,
});

export type SimClinician = z.infer<typeof SimClinicianSchema>;
export type SimAddress = z.infer<typeof SimAddressSchema>;
export type SimPatient = z.infer<typeof SimPatientSchema>;
export type SimReferral = z.infer<typeof SimReferralSchema>;
export type SimIncident = z.infer<typeof SimIncidentSchema>;
export type SimEpisode = z.infer<typeof SimEpisodeSchema>;
export type SimNote = z.infer<typeof SimNoteSchema>;
export type SimAppointment = z.infer<typeof SimAppointmentSchema>;
export type SimOutcomeMeasure = z.infer<typeof SimOutcomeMeasureSchema>;
export type SimPage<T> = {
  data: T[];
  page: number;
  page_size: number;
  total: number;
  next_page: number | null;
  _simulated: true;
};
export type SimAttachDocumentRequest = z.infer<typeof SimAttachDocumentRequestSchema>;
export type SimAttachDocumentResponse = z.infer<typeof SimAttachDocumentResponseSchema>;
export type SimError = z.infer<typeof SimErrorSchema>;
