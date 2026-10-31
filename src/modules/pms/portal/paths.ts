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
    portalBook: `${root}/portal/book`,
    portalAppointment: (appointmentId: string) => `${root}/portal/appointments/${encodeURIComponent(appointmentId)}`,
    portalForm: (responseId: string) => `${root}/portal/forms/${encodeURIComponent(responseId)}`,
    portalDocument: (shareId: string) => `${root}/portal/documents/${encodeURIComponent(shareId)}`,
    /**
     * The "manage this booking" link (shown once after booking). M10 L7: opening it swaps the secret for a cookie
     * (limited to `${root}/booking`) and redirects to manageHome, so the secret leaves the address bar and history.
     */
    manage: (token: string) => `${root}/booking/${encodeURIComponent(token)}`,
    /** The link that opens one of the booking's forms (swaps the secret for the cookie first). */
    manageForm: (token: string, responseId: string) => `${root}/booking/${encodeURIComponent(token)}?form=${encodeURIComponent(responseId)}`,
    /** The booking's own pages, read with the manage cookie. */
    manageHome: `${root}/booking/manage`,
    manageMove: `${root}/booking/manage/move`,
    manageFormPage: (responseId: string) => `${root}/booking/manage/forms/${encodeURIComponent(responseId)}`,
    manageCookiePath: `${root}/booking`,
    /** A clinic device showing one form handed to the patient (its cookie is limited to this path). */
    device: `${root}/device`,
    portalDocumentFile: (shareId: string) => `${root}/portal/documents/${encodeURIComponent(shareId)}/file`,
  };
}

export const STAFF_PORTAL_PATHS = {
  /** Set-up → Online booking (settings, sites, what is offered) and the latest online bookings. */
  onlineBooking: `${CLINIC_BASE_PATH}/online-booking`,
  /** Set-up → Intake forms (list and builder). */
  intake: `${CLINIC_BASE_PATH}/intake`,
  intakeForm: (id: string) => `${CLINIC_BASE_PATH}/intake/${encodeURIComponent(id)}`,
  patientForms: (patientId: string) => `${CLINIC_BASE_PATH}/patients/${encodeURIComponent(patientId)}/forms`,
  patientResponse: (patientId: string, responseId: string) => `${CLINIC_BASE_PATH}/patients/${encodeURIComponent(patientId)}/forms/${encodeURIComponent(responseId)}`,
  /** The sealed copy as a PDF. */
  patientResponsePdf: (patientId: string, responseId: string) => `${CLINIC_BASE_PATH}/patients/${encodeURIComponent(patientId)}/forms/${encodeURIComponent(responseId)}/pdf`,
  /** A form handed to the patient on a clinic device: staff verify (or end) it here. */
  handoff: (handoffId: string) => `${CLINIC_BASE_PATH}/intake/device/${encodeURIComponent(handoffId)}`,
} as const;

/** The secret part of a link: 43 base64url characters (32 random bytes). */
export const LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
