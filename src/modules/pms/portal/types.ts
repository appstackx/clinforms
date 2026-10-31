/** Portal records as the repositories return them (decrypted where noted, camelCase). Pure types – browser-safe. */
import type { Answers, FormDefinition } from "./forms";
import type { OutcomeMeasureId } from "../records/outcomes";
import type { IntakeFormKind, IntakeFormStatus, IntakeResponseKind, SendWhen } from "./schemas";

export interface BookingSettings {
  tenantId: string;
  rev: number;
  onlineBooking: boolean;
  portal: boolean;
  newPatients: boolean;
  minNoticeHours: number;
  maxDaysAhead: number;
  slotStepMinutes: number;
  cancelNoticeHours: number;
  patientCancel: boolean;
  introText: string | null;
  cancellationPolicy: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  updatedAt: string | null;
}

/** A site's online-booking settings (no row = online, no map position). */
export interface BookingSite {
  tenantId: string;
  siteId: string;
  rev: number;
  online: boolean;
  /** Decimal degrees, or null when the clinic has not set the site's position. */
  latitude: number | null;
  longitude: number | null;
}

export type BookingChannel = "booking_page" | "portal";
export type PatientMatch = "new" | "existing" | "portal";

/**
 * The online-booking record of a diary appointment booked online. The time, place, practitioner and status are the
 * diary appointment's (pms_appointments) – read them from the diary, never from here.
 */
export interface OnlineBooking {
  tenantId: string;
  id: string;
  rev: number;
  reference: string;
  patientId: string;
  appointmentId: string;
  channel: BookingChannel;
  /** How the booking found its patient record (staff only – never shown to the patient). */
  patientMatch: PatientMatch;
  manageExpiresAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PortalAccount {
  tenantId: string;
  id: string;
  patientId: string;
  status: "active" | "disabled";
  lastSignInAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PortalSession {
  tenantId: string;
  id: string;
  accountId: string;
  patientId: string;
  expiresAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface IntakeTemplate {
  tenantId: string;
  id: string;
  rev: number;
  version: number;
  name: string;
  kind: IntakeFormKind;
  description: string | null;
  status: IntakeFormStatus;
  sendWhen: SendWhen;
  requiresSignature: boolean;
  signatureStatement: string | null;
  setsTreatmentConsent: boolean;
  definition: FormDefinition;
  createdAt: string;
  updatedAt: string;
}

export type IntakeResponseStatus = "requested" | "submitted" | "cancelled";

/** Lists show this (nothing decrypted). */
export interface IntakeResponseSummary {
  tenantId: string;
  id: string;
  /** Null for an outcome questionnaire. */
  templateId: string | null;
  templateVersion: number;
  name: string;
  kind: IntakeResponseKind;
  patientId: string;
  /** The diary appointment it was sent for. */
  appointmentId: string | null;
  /** Outcome questionnaires: the records module's measure. */
  measure: OutcomeMeasureId | null;
  caseId: string | null;
  /** The outcome row its answers made (records module). */
  outcomeId: string | null;
  status: IntakeResponseStatus;
  requiresSignature: boolean;
  signedAt: string | null;
  /** "verified" = through the patient's own portal sign-in; "unverified" = through a booking link. */
  trust: "verified" | "unverified" | null;
  requestedAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  appliedAt: string | null;
  updatedAt: string;
}

export interface IntakeResponse extends IntakeResponseSummary {
  rev: number;
  form: FormDefinition;
  signatureStatement: string | null;
  setsTreatmentConsent: boolean;
  /** Decrypted (null until submitted). */
  answers: Answers | null;
  /** Decrypted typed name. */
  signatureName: string | null;
  contentSha256: string | null;
  requestedBy: string | null;
  reviewedBy: string | null;
}

export interface PortalShareSummary {
  tenantId: string;
  id: string;
  patientId: string;
  title: string;
  sharedBy: string | null;
  sharedAt: string;
  viewedAt: string | null;
  withdrawnAt: string | null;
}

export interface PortalShare extends PortalShareSummary {
  /** Decrypted. */
  body: string;
  /** The record's attached file this share hands to the patient (null for a written document). */
  attachmentId: string | null;
}
