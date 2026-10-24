/**
 * Addresses of the clinic's public pages (booking, patient portal) and of the staff pages of the portal module.
 * Pure – used by server pages, client components and the links written into emails. Every public page of one
 * clinic lives under /clinics/<clinic id>, so the portal's sign-in cookie can be limited to that path.
 */
import { CLINIC_BASE_PATH } from "../core/modules";

export const PUBLIC_CLINIC_BASE = "/clinics";

export function clinicPublicPaths(tenantId: string) {
  const root = `${PUBLIC_CLINIC_BASE}/${encodeURIComponent(tenantId)}`;
  return {
    root,
    book: `${root}/book`,
    details: `${root}/book/details`,
    portal: `${root}/portal`,
    signIn: `${root}/portal/sign-in`,
    signInLink: (token: string) => `${root}/portal/link/${encodeURIComponent(token)}`,
    portalBooking: (bookingId: string) => `${root}/portal/appointments/${encodeURIComponent(bookingId)}`,
    portalForm: (responseId: string) => `${root}/portal/forms/${encodeURIComponent(responseId)}`,
    portalDocument: (shareId: string) => `${root}/portal/documents/${encodeURIComponent(shareId)}`,
    manage: (token: string) => `${root}/booking/${encodeURIComponent(token)}`,
    manageForm: (token: string, responseId: string) => `${root}/booking/${encodeURIComponent(token)}/forms/${encodeURIComponent(responseId)}`,
  };
}

export const STAFF_PORTAL_PATHS = {
  onlineBooking: `${CLINIC_BASE_PATH}/online-booking`,
  settings: `${CLINIC_BASE_PATH}/online-booking/settings`,
  hours: `${CLINIC_BASE_PATH}/online-booking/hours`,
  outbox: `${CLINIC_BASE_PATH}/online-booking/messages`,
  outboxMessage: (id: string) => `${CLINIC_BASE_PATH}/online-booking/messages/${encodeURIComponent(id)}`,
  intake: `${CLINIC_BASE_PATH}/intake`,
  intakeForm: (id: string) => `${CLINIC_BASE_PATH}/intake/${encodeURIComponent(id)}`,
  intakeNew: `${CLINIC_BASE_PATH}/intake/new`,
  patientForms: (patientId: string) => `${CLINIC_BASE_PATH}/patients/${encodeURIComponent(patientId)}/forms`,
  patientResponse: (patientId: string, responseId: string) => `${CLINIC_BASE_PATH}/patients/${encodeURIComponent(patientId)}/forms/${encodeURIComponent(responseId)}`,
} as const;

/** The secret part of a link: 43 base64url characters (32 random bytes). */
export const LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
