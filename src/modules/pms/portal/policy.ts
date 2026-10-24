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

export type BookingStatus = "booked" | "cancelled";

export type PatientChangeRefusal = "not_booked" | "started" | "too_late" | "not_allowed";

/** Whether the patient may cancel or move this booking online now. */
export function patientMayChange(
  policy: Pick<BookingPolicy, "cancelNoticeHours" | "patientCancel">,
  booking: { status: BookingStatus; startsAt: string },
  nowMs: number,
): { ok: true } | { ok: false; reason: PatientChangeRefusal } {
  if (booking.status !== "booked") return { ok: false, reason: "not_booked" };
  const start = Date.parse(booking.startsAt);
  if (!(start > nowMs)) return { ok: false, reason: "started" };
  if (!policy.patientCancel) return { ok: false, reason: "not_allowed" };
  if (start - nowMs < policy.cancelNoticeHours * 3_600_000) return { ok: false, reason: "too_late" };
  return { ok: true };
}

/** A cancellation inside the notice period (the clinic may charge for it – the billing module decides). */
export function isLateCancellation(policy: Pick<BookingPolicy, "cancelNoticeHours">, startsAt: string, nowMs: number): boolean {
  const start = Date.parse(startsAt);
  return start > nowMs && start - nowMs < policy.cancelNoticeHours * 3_600_000;
}

/** What a patient reads when they cannot change a booking online. */
export function changeRefusalMessage(reason: PatientChangeRefusal, contact: string | null): string {
  const call = contact ? ` Please call the clinic on ${contact}.` : " Please contact the clinic.";
  switch (reason) {
    case "not_booked":
      return "This booking has already been cancelled.";
    case "started":
      return "This appointment has already started or taken place.";
    case "not_allowed":
      return `Bookings cannot be changed online.${call}`;
    default:
      return `It is too close to the appointment to change it online.${call}`;
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

/** One-time sign-in links last 20 minutes; portal sessions 4 hours, or 30 minutes without activity. */
export const PORTAL_TIMINGS = {
  signInLinkMinutes: 20,
  sessionHours: 4,
  idleMinutes: 30,
  /** last_seen_at is written at most this often (fewer writes on every page). */
  touchEveryMinutes: 5,
} as const;

/** Whether a portal session is still usable. */
export function sessionUsable(session: { expiresAt: string; lastSeenAt: string; revokedAt: string | null }, nowMs: number): boolean {
  if (session.revokedAt) return false;
  if (Date.parse(session.expiresAt) <= nowMs) return false;
  return nowMs - Date.parse(session.lastSeenAt) < PORTAL_TIMINGS.idleMinutes * 60_000;
}
