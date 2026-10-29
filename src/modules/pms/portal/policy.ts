/**
 * Booking rules a patient meets online (pure): the clinic's notice periods, cancelling and changing a booking
 * within policy, booking references and how long a "manage this booking" link lasts.
 */

export interface BookingPolicy {
  /** A booking must start at least this many hours from now. */
  minNoticeHours: number;
  /** How far ahead patients may book (days). */
  maxDaysAhead: number;
  /** Patients may cancel or change online up to this many hours before the start. */
  cancelNoticeHours: number;
  /** Whether patients may cancel or change online at all. */
  patientCancel: boolean;
}

export const DEFAULT_BOOKING_POLICY: BookingPolicy = { minNoticeHours: 24, maxDaysAhead: 42, cancelNoticeHours: 24, patientCancel: true };

export type PatientChangeRefusal = "not_booked" | "started" | "too_late" | "not_allowed";

/** What the patient may do with a booked appointment online now (the diary's status and start). */
export interface PatientChangeRights {
  /** Cancel online: always while booked and in the future (when the clinic allows changes online). */
  cancel: { ok: true; late: boolean } | { ok: false; reason: PatientChangeRefusal };
  /** Move online: only outside the notice period (inside it the patient calls the clinic). */
  move: { ok: true } | { ok: false; reason: PatientChangeRefusal };
  /** The last moment a change is free of charge (start − notice). */
  freeUntil: string;
}

/**
 * Whether the patient may cancel or move a booked appointment online now. A cancellation inside the clinic's
 * notice period is allowed but is a LATE cancellation (the diary flags the fee); a move inside it is not offered.
 */
export function patientChangeRights(
  policy: Pick<BookingPolicy, "cancelNoticeHours" | "patientCancel">,
  appointment: { status: string; startsAt: string },
  nowMs: number,
): PatientChangeRights {
  const start = Date.parse(appointment.startsAt);
  const freeUntil = new Date(start - policy.cancelNoticeHours * 3_600_000).toISOString();
  const refuse = (reason: PatientChangeRefusal) => ({ cancel: { ok: false as const, reason }, move: { ok: false as const, reason }, freeUntil });
  if (appointment.status !== "booked") return refuse("not_booked");
  if (!(start > nowMs)) return refuse("started");
  if (!policy.patientCancel) return refuse("not_allowed");
  const late = isLateCancellation(policy, appointment.startsAt, nowMs);
  return { cancel: { ok: true, late }, move: late ? { ok: false, reason: "too_late" } : { ok: true }, freeUntil };
}

/** A cancellation inside the notice period (the clinic may charge for it – the diary flags the fee). */
export function isLateCancellation(policy: Pick<BookingPolicy, "cancelNoticeHours">, startsAt: string, nowMs: number): boolean {
  const start = Date.parse(startsAt);
  return start > nowMs && start - nowMs < policy.cancelNoticeHours * 3_600_000;
}

/** What a patient reads when they cannot change a booking online. */
export function changeRefusalMessage(reason: PatientChangeRefusal, contact: string | null): string {
  const call = contact ? ` Please call the clinic on ${contact}.` : " Please contact the clinic.";
  switch (reason) {
    case "not_booked":
      return "This appointment is no longer booked.";
    case "started":
      return "This appointment has already started or taken place.";
    case "not_allowed":
      return `Appointments cannot be changed online.${call}`;
    default:
      return `It is too close to the appointment to move it online.${call}`;
  }
}

/** Letters for references: no 0/O, 1/I/L or U (easy to read out on the phone). */
const REFERENCE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A booking reference from random bytes: "K7M3-Q9TX" (8 characters, ~39 bits). */
export function bookingReference(bytes: Uint8Array): string {
  if (bytes.length < 8) throw new Error("bookingReference needs 8 random bytes");
  let out = "";
  for (let i = 0; i < 8; i++) out += REFERENCE_ALPHABET[bytes[i] % REFERENCE_ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export const BOOKING_REFERENCE_PATTERN = /^[2-9A-HJ-NP-TV-Z]{4}-[2-9A-HJ-NP-TV-Z]{4}$/;

/** The "manage this booking" link works until a day after the appointment's start. */
export function manageLinkExpiry(startsAt: string): string {
  return new Date(Date.parse(startsAt) + 86_400_000).toISOString();
}

/**
 * One-time sign-in links the patient asks for last 15 minutes (design: "It works for 15 minutes"); a link staff
 * send with a form or questionnaire lasts 72 hours (still single use). Portal sessions: 4 hours, or 30 minutes
 * without activity.
 */
export const PORTAL_TIMINGS = {
  signInLinkMinutes: 15,
  staffLinkHours: 72,
  sessionHours: 4,
  idleMinutes: 30,
  /** last_seen_at is written at most this often (fewer writes on every page). */
  touchEveryMinutes: 5,
  /** A form handed to the patient on a clinic device can be completed for this long. */
  handoffMinutes: 30,
} as const;

/** Whether a portal session is still usable. */
export function sessionUsable(session: { expiresAt: string; lastSeenAt: string; revokedAt: string | null }, nowMs: number): boolean {
  if (session.revokedAt) return false;
  if (Date.parse(session.expiresAt) <= nowMs) return false;
  return nowMs - Date.parse(session.lastSeenAt) < PORTAL_TIMINGS.idleMinutes * 60_000;
}
