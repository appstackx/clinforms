/** Portal records as the repositories return them (decrypted where noted, camelCase). Pure types – browser-safe. */
import type { Answers, FormDefinition } from "./forms";
import type { BookingStatus } from "./policy";
import type { CancelReason, IntakeFormKind, IntakeFormStatus, SendWhen } from "./schemas";

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

export interface BookingHours {
  tenantId: string;
  id: string;
  practitionerId: string;
  siteId: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
  validFrom: string | null;
  validTo: string | null;
  createdAt: string;
  updatedAt: string;
}

export type BookingChannel = "booking_page" | "portal" | "clinic";
export type PatientMatch = "new" | "existing" | "portal";

export interface OnlineBooking {
  tenantId: string;
  id: string;
  rev: number;
  reference: string;
  patientId: string;
  siteId: string;
  practitionerId: string;
  serviceId: string;
  startsAt: string;
  endsAt: string;
  blocksUntil: string;
  status: BookingStatus;
  channel: BookingChannel;
  /** How the booking found its patient record (staff only – never shown to the patient). */
  patientMatch: PatientMatch;
  cancelledBy: "patient" | "clinic" | null;
  cancelReason: CancelReason | null;
  cancelledAt: string | null;
  lateCancellation: boolean;
  rebookedFromId: string | null;
  /** The diary's appointment once the diary is connected (null while online bookings stand alone). */
  appointmentId: string | null;
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

export type PortalMessageKind = "sign_in_link" | "booking_confirmed" | "booking_cancelled" | "booking_changed" | "form_request" | "document_shared";

/** A message the portal would send (outbox). Recipient and body decrypted only in getPortalMessage. */
export interface PortalMessageSummary {
  tenantId: string;
  id: string;
  patientId: string | null;
  kind: PortalMessageKind;
  channel: "email";
  subject: string;
  status: "outbox" | "sent" | "failed";
  provider: string;
  createdAt: string;
}

export interface PortalMessage extends PortalMessageSummary {
  recipient: string | null;
  body: string | null;
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
  templateId: string;
  templateVersion: number;
  name: string;
  kind: IntakeFormKind;
  patientId: string;
  bookingId: string | null;
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
}
