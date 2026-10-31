/**
 * Booking flows of the public booking page and the patient portal. Every booking is a DIARY appointment
 * (./diary-port.ts – one appointment store, one clash rule); the portal adds its online-booking record (reference,
 * how the record was found, the "manage this booking" link's hash) and the forms sent with a booking IN THE SAME
 * atomic batch as the appointment. Messages (confirmation, cancellation, "moved") go through comms – the diary's
 * hook plans them and the message run puts them in the outbox (outbox / test providers only).
 *
 * Public booking (a new or an existing patient – the answer NEVER says which):
 *   honeypot → validation → rate limits (client, email, clinic) → bot check (when switched on) → the slot is
 *   recomputed from the diary and must still be free → the patient is matched (same email, date of birth and last
 *   name, active record) or registered → the diary books it (refusing a clash) → the "manage this booking" link,
 *   shown once (only its hash is stored).
 * Portal booking: the signed-in patient's own record, no details asked.
 * Cancel / move: the clinic's notice period (src/modules/pms/portal/policy.ts) – a cancellation inside it is a LATE
 * cancellation (the diary flags the fee); a move inside it is not offered. Revision-checked.
 */
import "server-only";
import { fieldErrors } from "../../../modules/pms/core/schemas";
import { searchKey, ukToday } from "../../../modules/pms/core/text";
import type { PatientSummary, PmsActor } from "../../../modules/pms/core/types";
import { clinicPublicPaths } from "../../../modules/pms/portal/paths";
import { changeRefusalMessage, manageLinkExpiry, patientChangeRights } from "../../../modules/pms/portal/policy";
import { PortalBookingSchema, publicBookingSchema } from "../../../modules/pms/portal/schemas";
import { londonParts } from "../../../modules/pms/portal/time";
import type { BatchQuery } from "../../db/batch";
import { classifyDbError } from "../../db/errors";
import { logAuthEvent } from "../../email/log";
import type { RepoContext } from "../../repos/context";
import { createPatient, getPatientSummaries, searchPatients } from "../../repos/pms/patients";
import { onlineBookingQueries } from "../../repos/pms/portal/bookings";
import { formsToSendWithBooking, intakeRequestQueries } from "../../repos/pms/portal/intake";
import { diaryDispatchDeps } from "../diary/message-sync";
import { runDueMessages } from "../comms/dispatch";
import { bookingCatalogue, findSlots, pickSlot } from "./availability";
import { portalDiary, type PortalAppointment, type PortalSlot } from "./diary-port";
import { bookingNeedsHumanCheck, verifyHumanCheck } from "./human-check";
import { paddedMs } from "./timing";
import type { PublicClinic } from "./public-clinic";
import { publicLimits, tooManyMessage, type PublicLimit } from "./rate-limit";
import { hashSecret, newSecret } from "./tokens";

/** Writes made by a patient online: no staff member; the portal session when signed in. */
export function patientActor(sessionId: string | null = null): PmsActor {
  return { userId: null, sessionId };
}

export interface FlowDeps {
  ctx: RepoContext;
  now: Date;
  /** The app's own origin for links (never taken from a forged Host header). */
  origin: string;
  clientIp: string | null;
  humanToken?: string | null;
  /** Rate-limit key secret (tests pass one; default BETTER_AUTH_SECRET). */
  limitSecret?: string;
  /** Tests: skip the immediate message run. */
  skipMessageRun?: boolean;
  /**
   * M10 M4: a public booking answers no sooner than this (ms, real time) – a booking matched to an existing record
   * and one that creates a record take the same time. The app sets it (public-page.ts flowDeps); tests leave it 0.
   */
  minResponseMs?: number;
  /** Environment for the production rules (tests pass one; default process.env). */
  env?: Readonly<Record<string, string | undefined>>;
}

const GENERIC = "We could not take this booking. Please try again or contact the clinic.";
const SLOT_GONE = "Sorry – that time has just been taken. Please choose another time.";
const CLOSED = "Online booking is closed at the moment. Please contact the clinic.";
const CHANGED = "This appointment changed in the meantime. Please reload the page.";

/**
 * The diary's planned messages that are due now (the booking confirmation, a cancellation notice) go to the outbox
 * straight away rather than at the next scheduled run. Never throws; at most a few messages.
 */
async function sendDueNow(deps: FlowDeps, tenantId: string): Promise<void> {
  if (deps.skipMessageRun) return;
  try {
    await runDueMessages(deps.ctx, tenantId, diaryDispatchDeps(), { limit: 10 });
  } catch (err) {
    logAuthEvent("pms.portal.message_run_failed", { error: err instanceof Error ? err.name : "error" });
  }
}

function limitChecks(deps: FlowDeps, email: string | null, perClient: PublicLimit, perEmail: PublicLimit | null, perClinic: PublicLimit | null): [PublicLimit, string | null][] {
  const checks: [PublicLimit, string | null][] = [];
  if (deps.clientIp) checks.push([perClient, deps.clientIp]);
  if (perEmail && email) checks.push([perEmail, email]);
  if (perClinic) checks.push([perClinic, null]);
  return checks;
}

/** Active patients with this email, date of birth and last name (the first by patient number), or null. */
export async function findPatientForBooking(ctx: RepoContext, tenantId: string, who: { email: string; dateOfBirth: string; lastName: string }): Promise<PatientSummary | null> {
  const candidates = await searchPatients(ctx, tenantId, { q: who.email, status: "active", limit: 50 });
  const last = searchKey(who.lastName);
  const email = who.email.toLowerCase();
  const matches = candidates
    .filter((p) => (p.email ?? "").toLowerCase() === email && p.dateOfBirth === who.dateOfBirth && searchKey(p.lastName) === last)
    .sort((a, b) => a.patientNumber - b.patientNumber);
  return matches[0] ?? null;
}

export interface BookedVisit {
  appointmentId: string;
  reference: string;
  startsAt: string;
  endsAt: string;
  siteId: string;
  practitionerId: string;
  serviceId: string;
  /** Forms sent with the booking (to fill in before the visit). */
  formIds: string[];
}

/**
 * Books the slot in the diary with the portal's rows in the same batch. A refused clash → null. A reference that
 * happened to exist already (about one in 10^11) is retried once with a new one.
 */
async function bookSlot(
  deps: FlowDeps,
  tenantId: string,
  slot: PortalSlot,
  serviceId: string,
  patient: { id: string; match: "new" | "existing" | "portal" },
  actor: PmsActor,
  extras: { manageTokenHash: string | null; manageExpiresAt: string | null; notes: string | null },
): Promise<BookedVisit | null> {
  // M10 M4: every booking from the public page gets the same forms, whether it matched an existing record or made a
  // new one – what the page shows must not tell anyone whether someone is already a patient. The portal (a signed-in
  // patient) gets the every-booking forms only.
  const forms = await formsToSendWithBooking(deps.ctx, tenantId, patient.match !== "portal");
  for (let attempt = 0; attempt < 2; attempt++) {
    let reference = "";
    const formIds: string[] = [];
    try {
      const r = await portalDiary().book(
        deps.ctx,
        tenantId,
        { patientId: patient.id, siteId: slot.siteId, practitionerId: slot.practitionerId, roomId: slot.roomId, serviceId, date: slot.date, startMinute: slot.startMinute, notes: extras.notes },
        actor,
        (appointmentId) => {
          const record = onlineBookingQueries(
            deps.ctx,
            tenantId,
            { patientId: patient.id, appointmentId, channel: patient.match === "portal" ? "portal" : "booking_page", patientMatch: patient.match, manageTokenHash: extras.manageTokenHash, manageExpiresAt: extras.manageExpiresAt },
            actor,
          );
          reference = record.reference;
          const formQueries: BatchQuery[] = [];
          for (const t of forms) {
            const q = intakeRequestQueries(deps.ctx, tenantId, t, { patientId: patient.id, appointmentId }, actor);
            formIds.push(q.id);
            formQueries.push(...q.queries);
          }
          return [...record.queries, ...formQueries];
        },
      );
      if (!r.ok) return null;
      return { appointmentId: r.appointment.id, reference, startsAt: r.appointment.startsAt, endsAt: r.appointment.endsAt, siteId: slot.siteId, practitionerId: slot.practitionerId, serviceId, formIds };
    } catch (err) {
      const unique = classifyDbError(err) === "CONSTRAINT_UNIQUE" || /already exists/.test(err instanceof Error ? err.message : "");
      if (attempt === 0 && unique) continue;
      throw err;
    }
  }
  return null;
}

export type PublicBookingOutcome =
  | { ok: true; visit: BookedVisit; manageUrl: string; managePath: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; slotGone?: boolean };

/**
 * A booking from the public booking page. The answer never tells whether the details matched an existing patient
 * (M10 M4): the same forms either way, and no sooner than `deps.minResponseMs`.
 */
export async function bookFromPublicPage(clinic: PublicClinic, raw: Record<string, unknown>, deps: FlowDeps): Promise<PublicBookingOutcome> {
  const started = Date.now();
  const outcome = await bookFromPublicPageOnce(clinic, raw, deps);
  const elapsed = Date.now() - started;
  const wait = deps.minResponseMs ? paddedMs(deps.minResponseMs, elapsed) - elapsed : 0;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait + Math.floor(Math.random() * 150)));
  return outcome;
}

async function bookFromPublicPageOnce(clinic: PublicClinic, raw: Record<string, unknown>, deps: FlowDeps): Promise<PublicBookingOutcome> {
  const { ctx, now } = deps;
  const tenantId = clinic.tenantId;
  if (!clinic.settings.onlineBooking) return { ok: false, error: CLOSED };
  if (!clinic.settings.newPatients) return { ok: false, error: "Please sign in to your patient portal to book online." };
  // M10 M6: production refuses public bookings without the bot check (switching booking on needs it too).
  if (bookingNeedsHumanCheck(deps.env ?? process.env)) return { ok: false, error: CLOSED };
  if (typeof raw.website === "string" && raw.website.trim() !== "") return { ok: false, error: GENERIC };
  const parsed = publicBookingSchema(ukToday(now)).safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Please check the answers marked below.", fieldErrors: fieldErrors(parsed.error) };
  const d = parsed.data;
  const limited = await publicLimits(ctx, tenantId, limitChecks(deps, d.email, "bookingPerClient", "bookingPerEmail", "bookingPerClinic"), deps.limitSecret);
  if (!limited.ok) return { ok: false, error: tooManyMessage(limited.retryAfterSeconds) };
  const human = await verifyHumanCheck(deps.humanToken, deps.clientIp);
  if (!human.ok) return { ok: false, error: "Please complete the check that you are not a robot, then book again." };

  const catalogue = await bookingCatalogue(ctx, tenantId, now);
  const date = londonParts(Date.parse(d.startsAt)).date;
  const { slots, service } = await findSlots(ctx, tenantId, clinic.settings, catalogue, { siteId: d.siteId, serviceId: d.serviceId, practitionerId: d.practitionerId, fromDate: date, days: 1, now });
  const slot = pickSlot(slots, d.startsAt, d.practitionerId);
  if (!slot || !service) return { ok: false, error: SLOT_GONE, slotGone: true };

  // M10 M6: at most PUBLIC_LIMITS.recordsPerClinic bookings an hour reach the patient step (each may create a record) –
  // counted before the match, so the answer is the same whether or not a record matched.
  const capped = await publicLimits(ctx, tenantId, [["recordsPerClinic", null]], deps.limitSecret);
  if (!capped.ok) return { ok: false, error: tooManyMessage(capped.retryAfterSeconds) };
  const actor = patientActor();
  const existing = await findPatientForBooking(ctx, tenantId, d);
  let patient: { id: string; match: "new" | "existing" };
  if (existing) patient = { id: existing.id, match: "existing" };
  else {
    const reminders = d.reminders ?? true;
    const created = await createPatient(ctx, tenantId, { firstName: d.firstName, lastName: d.lastName, dateOfBirth: d.dateOfBirth, email: d.email, phoneMobile: d.phoneMobile, reminderSms: reminders, reminderEmail: reminders }, actor);
    patient = { id: created.id, match: "new" };
  }
  const secret = newSecret();
  const managePath = clinicPublicPaths(tenantId).manage(secret);
  const visit = await bookSlot(deps, tenantId, slot, service.id, patient, actor, {
    manageTokenHash: hashSecret(secret),
    manageExpiresAt: manageLinkExpiry(slot.startsAt),
    notes: d.paying === "insured" ? "Booked online – paying by health insurance (will bring the authorisation)." : "Booked online – paying themselves.",
  });
  if (!visit) return { ok: false, error: SLOT_GONE, slotGone: true };
  await sendDueNow(deps, tenantId);
  return { ok: true, visit, manageUrl: `${deps.origin}${managePath}`, managePath };
}

export type PortalBookingOutcome = { ok: true; visit: BookedVisit } | { ok: false; error: string; fieldErrors?: Record<string, string>; slotGone?: boolean };

/** A booking by a patient signed in to the portal (their own record; no details asked). */
export async function bookFromPortal(clinic: PublicClinic, patientId: string, sessionId: string, raw: Record<string, unknown>, deps: FlowDeps): Promise<PortalBookingOutcome> {
  const { ctx, now } = deps;
  const tenantId = clinic.tenantId;
  if (!clinic.settings.onlineBooking) return { ok: false, error: CLOSED };
  const parsed = PortalBookingSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Please choose a time.", fieldErrors: fieldErrors(parsed.error) };
  const d = parsed.data;
  const limited = await publicLimits(ctx, tenantId, limitChecks(deps, `portal:${patientId}`, "bookingPerClient", "bookingPerEmail", "bookingPerClinic"), deps.limitSecret);
  if (!limited.ok) return { ok: false, error: tooManyMessage(limited.retryAfterSeconds) };
  const summary = (await getPatientSummaries(ctx, tenantId, [patientId])).get(patientId);
  if (!summary || summary.status !== "active") return { ok: false, error: GENERIC };
  const catalogue = await bookingCatalogue(ctx, tenantId, now);
  const { slots, service } = await findSlots(ctx, tenantId, clinic.settings, catalogue, { ...d, fromDate: londonParts(Date.parse(d.startsAt)).date, days: 1, now, patientId });
  const slot = pickSlot(slots, d.startsAt, d.practitionerId);
  if (!slot || !service) return { ok: false, error: SLOT_GONE, slotGone: true };
  const visit = await bookSlot(deps, tenantId, slot, service.id, { id: patientId, match: "portal" }, patientActor(sessionId), { manageTokenHash: null, manageExpiresAt: null, notes: "Booked online in the patient portal." });
  if (!visit) return { ok: false, error: SLOT_GONE, slotGone: true };
  await sendDueNow(deps, tenantId);
  return { ok: true, visit };
}

export type ChangeOutcome = { ok: true; appointment: PortalAppointment; late: boolean } | { ok: false; error: string; slotGone?: boolean };

/** The patient's own appointment (else null – never another patient's, whatever id is asked for). */
export async function patientAppointment(ctx: RepoContext, tenantId: string, patientId: string, appointmentId: string): Promise<PortalAppointment | null> {
  if (typeof appointmentId !== "string" || !/^appt_[0-9A-HJKMNP-TV-Z]{26}$/.test(appointmentId)) return null;
  const a = await portalDiary().appointment(ctx, tenantId, appointmentId);
  return a && a.patientId === patientId ? a : null;
}

/** The patient cancels online. Inside the notice period it is recorded as a late cancellation (fee flagged). */
export async function cancelByPatient(clinic: PublicClinic, patientId: string, appointmentId: string, expectedRev: number, deps: FlowDeps & { sessionId?: string | null }): Promise<ChangeOutcome> {
  const { ctx, now } = deps;
  const a = await patientAppointment(ctx, clinic.tenantId, patientId, appointmentId);
  if (!a) return { ok: false, error: "That appointment was not found." };
  const limited = await publicLimits(ctx, clinic.tenantId, limitChecks(deps, `patient:${patientId}`, "patientWritesPerClient", null, null), deps.limitSecret);
  if (!limited.ok) return { ok: false, error: tooManyMessage(limited.retryAfterSeconds) };
  const rights = patientChangeRights(clinic.settings, a, now.getTime());
  if (!rights.cancel.ok) return { ok: false, error: changeRefusalMessage(rights.cancel.reason, clinic.settings.contactPhone) };
  const r = await portalDiary().cancel(ctx, clinic.tenantId, a.id, expectedRev, { late: rights.cancel.late }, patientActor(deps.sessionId ?? null));
  if (!r.ok) return { ok: false, error: CHANGED };
  await sendDueNow(deps, clinic.tenantId);
  return { ok: true, appointment: r.appointment, late: rights.cancel.late };
}

/** The patient moves an appointment to another free time online (same type and site; outside the notice period). */
export async function moveByPatient(
  clinic: PublicClinic,
  patientId: string,
  appointmentId: string,
  expectedRev: number,
  raw: { practitionerId: unknown; startsAt: unknown },
  deps: FlowDeps & { sessionId?: string | null },
): Promise<ChangeOutcome> {
  const { ctx, now } = deps;
  const a = await patientAppointment(ctx, clinic.tenantId, patientId, appointmentId);
  if (!a || !a.serviceId) return { ok: false, error: "That appointment was not found." };
  const rights = patientChangeRights(clinic.settings, a, now.getTime());
  if (!rights.move.ok) return { ok: false, error: changeRefusalMessage(rights.move.reason, clinic.settings.contactPhone) };
  const parsed = PortalBookingSchema.safeParse({ siteId: a.siteId, serviceId: a.serviceId, practitionerId: raw.practitionerId, startsAt: raw.startsAt });
  if (!parsed.success) return { ok: false, error: "Please choose a new time." };
  const limited = await publicLimits(ctx, clinic.tenantId, limitChecks(deps, `patient:${patientId}`, "patientWritesPerClient", null, null), deps.limitSecret);
  if (!limited.ok) return { ok: false, error: tooManyMessage(limited.retryAfterSeconds) };
  const d = parsed.data;
  const catalogue = await bookingCatalogue(ctx, clinic.tenantId, now);
  const { slots } = await findSlots(ctx, clinic.tenantId, clinic.settings, catalogue, { ...d, fromDate: londonParts(Date.parse(d.startsAt)).date, days: 1, now });
  const slot = pickSlot(slots, d.startsAt, d.practitionerId);
  if (!slot) return { ok: false, error: SLOT_GONE, slotGone: true };
  const r = await portalDiary().move(ctx, clinic.tenantId, a.id, expectedRev, { date: slot.date, startMinute: slot.startMinute, practitionerId: slot.practitionerId, roomId: slot.roomId }, patientActor(deps.sessionId ?? null));
  if (!r.ok) return r.reason === "clash" ? { ok: false, error: SLOT_GONE, slotGone: true } : { ok: false, error: CHANGED };
  await sendDueNow(deps, clinic.tenantId);
  return { ok: true, appointment: r.appointment, late: false };
}
