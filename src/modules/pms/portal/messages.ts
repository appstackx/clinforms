/**
 * The words of the emails the portal sends (pure). Service messages only: they carry the date, time, place and
 * practitioner – never the reason for the visit, the appointment type or any other clinical detail (PECR and
 * confidentiality: an email can be read by someone else). Plain text; the clinic's name signs them.
 */
import type { PortalMessageKind } from "./types";
import { PORTAL_TIMINGS } from "./policy";
import { formatUkDateTime } from "./time";

export interface MessageText {
  kind: PortalMessageKind;
  subject: string;
  body: string;
}

interface Visit {
  startsAt: string;
  siteName: string;
  practitionerName: string;
  reference: string;
}

const sign = (clinic: string) => `\n\n${clinic}\n\nThis email was sent by ${clinic} about your appointments. Please do not reply to it.`;

export function bookingConfirmedMessage(input: { clinicName: string; firstName: string; visit: Visit; manageUrl: string; cancellationPolicy: string | null; formsToComplete: number }): MessageText {
  const forms = input.formsToComplete > 0 ? `\nPlease complete ${input.formsToComplete === 1 ? "the form" : `the ${input.formsToComplete} forms`} for your visit before you arrive, from the same link.` : "";
  const policy = input.cancellationPolicy ? `\n\n${input.cancellationPolicy}` : "";
  return {
    kind: "booking_confirmed",
    subject: `Your appointment at ${input.clinicName} is booked`,
    body:
      `Hello ${input.firstName},\n\nYour appointment is booked for ${formatUkDateTime(input.visit.startsAt)} with ${input.visit.practitionerName} at ${input.visit.siteName}.` +
      `\nBooking reference: ${input.visit.reference}\n\nTo see, change or cancel your booking: ${input.manageUrl}${forms}${policy}${sign(input.clinicName)}`,
  };
}

export function bookingChangedMessage(input: { clinicName: string; firstName: string; visit: Visit; manageUrl: string }): MessageText {
  return {
    kind: "booking_changed",
    subject: `Your appointment at ${input.clinicName} has moved`,
    body:
      `Hello ${input.firstName},\n\nYour appointment is now on ${formatUkDateTime(input.visit.startsAt)} with ${input.visit.practitionerName} at ${input.visit.siteName}.` +
      `\nBooking reference: ${input.visit.reference}\n\nTo see, change or cancel your booking: ${input.manageUrl}${sign(input.clinicName)}`,
  };
}

export function bookingCancelledMessage(input: { clinicName: string; firstName: string; visit: Visit; byClinic: boolean; contactPhone: string | null }): MessageText {
  const who = input.byClinic ? "The clinic has cancelled" : "You cancelled";
  const call = input.contactPhone ? ` or call us on ${input.contactPhone}` : "";
  return {
    kind: "booking_cancelled",
    subject: `Your appointment at ${input.clinicName} is cancelled`,
    body: `Hello ${input.firstName},\n\n${who} your appointment on ${formatUkDateTime(input.visit.startsAt)} at ${input.visit.siteName} (reference ${input.visit.reference}).\n\nTo book again, visit our booking page${call}.${sign(input.clinicName)}`,
  };
}

export function signInLinkMessage(input: { clinicName: string; firstName: string; url: string }): MessageText {
  return {
    kind: "sign_in_link",
    subject: `Your sign-in link for ${input.clinicName}`,
    body:
      `Hello ${input.firstName},\n\nUse this link to sign in to your patient portal. It works once, for ${PORTAL_TIMINGS.signInLinkMinutes} minutes:\n${input.url}` +
      `\n\nIf you did not ask for this link, you can ignore this email – nobody can sign in without it.${sign(input.clinicName)}`,
  };
}

export function formRequestMessage(input: { clinicName: string; firstName: string; count: number; url: string }): MessageText {
  const what = input.count === 1 ? "a form" : `${input.count} forms`;
  return {
    kind: "form_request",
    subject: `Please complete ${what} for ${input.clinicName}`,
    body: `Hello ${input.firstName},\n\n${input.clinicName} has asked you to complete ${what} before your visit. Sign in to your patient portal to fill ${input.count === 1 ? "it" : "them"} in:\n${input.url}${sign(input.clinicName)}`,
  };
}

export function documentSharedMessage(input: { clinicName: string; firstName: string; url: string }): MessageText {
  return {
    kind: "document_shared",
    subject: `${input.clinicName} has shared a document with you`,
    body: `Hello ${input.firstName},\n\n${input.clinicName} has shared a document with you. Sign in to your patient portal to read it:\n${input.url}${sign(input.clinicName)}`,
  };
}

export const MESSAGE_KIND_LABELS: Readonly<Record<PortalMessageKind, string>> = {
  sign_in_link: "Sign-in link",
  booking_confirmed: "Booking confirmed",
  booking_cancelled: "Booking cancelled",
  booking_changed: "Booking moved",
  form_request: "Forms to complete",
  document_shared: "Document shared",
};
