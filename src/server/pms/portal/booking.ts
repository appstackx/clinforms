/**
 * Booking flows of the public booking page and the patient portal, and the clinic's own cancellation.
 *
 * Public booking (a new or an existing patient – the answer NEVER says which):
 *   honeypot → validation → rate limits (client, email, clinic) → bot check (when on) → the slot is recomputed
 *   and must still be free → the patient is matched (same email, date of birth and last name, active record) or
 *   registered → ONE atomic batch: the booking (the database refuses a double booking), its audit row, the forms
 *   the clinic sends with a booking, and the confirmation message (outbox) → the "manage this booking" link,
 *   shown once and in the confirmation message (only its hash is stored).
 * Portal booking: the signed-in patient's own record, no details asked.
 * Cancel / move: within the clinic's notice period (src/modules/pms/portal/policy.ts), revision-checked.
 */
import "server-only";
import { fieldErrors } from "../../../modules/pms/core/schemas";
import { searchKey, ukToday } from "../../../modules/pms/core/text";
import type { PatientSummary, PmsActor } from "../../../modules/pms/core/types";
import { bookingCancelledMessage, bookingChangedMessage, bookingConfirmedMessage } from "../../../modules/pms/portal/messages";
import { clinicPublicPaths } from "../../../modules/pms/portal/paths";
import { changeRefusalMessage, isLateCancellation, manageLinkExpiry, patientMayChange } from "../../../modules/pms/portal/policy";
import { PortalBookingSchema, publicBookingSchema } from "../../../modules/pms/portal/schemas";
import { pickSlot } from "../../../modules/pms/portal/slots";
import { londonParts } from "../../../modules/pms/portal/time";
import type { OnlineBooking } from "../../../modules/pms/portal/types";
import type { BatchQuery } from "../../db/batch";
import type { RepoContext } from "../../repos/context";
import { createPatient, getPatientSummaries, searchPatients } from "../../repos/pms/patients";
import { cancelOnlineBooking, createOnlineBooking, getOnlineBooking, rebookOnlineBooking } from "../../repos/pms/portal/bookings";
import { formsToSendWithBooking, intakeRequestQueries, moveResponsesQuery } from "../../repos/pms/portal/intake";
import { portalMessageQueries } from "../../repos/pms/portal/messages";
import { bookingCatalogue, findSlots } from "./availability";
import { portalDiary } from "./diary-port";
import { directoryView } from "./directory-view";
import { verifyHumanCheck } from "./human-check";
import { portalMailer, type PortalMailer } from "./mailer";
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
  /** The app's own origin for links in messages (never taken from a forged Host header). */
  origin: string;
  clientIp: string | null;
  humanToken?: string | null;
  mailer?: PortalMailer;
  /** Rate-limit key secret (tests pass one; default BETTER_AUTH_SECRET). */
  limitSecret?: string;
}

const GENERIC = "We could not take this booking. Please try again or contact the clinic.";
const SLOT_GONE = "Sorry – that time has just been taken. Please choose another time.";

export type PublicBookingOutcome =
  | { ok: true; reference: string; manageUrl: string; startsAt: string; siteName: string; practitionerName: string; serviceName: string; forms: number }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; slotGone?: boolean };

/** Active patients with this email, date of birth and last name (the first by patient number), or null. */
export async function findPatientForBooking(ctx: RepoContext, tenantId: string, who: { email: string; dateOfBirth: string; lastName: string }): Promise<PatientSummary | null> {
  const candidates = await searchPatients(ctx, tenantId, { q: who.email, status: "active", limit: 50 });
  const last = searchKey(who.lastName);
  const matches = candidates.filter((p) => p.dateOfBirth === who.dateOfBirth && searchKey(p.lastName) === last).sort((a, b) => a.patientNumber - b.patientNumber);
  return matches[0] ?? null;
}

function limitChecks(deps: FlowDeps, email: string | null, perClient: PublicLimit, perEmail: PublicLimit | null, perClinic: PublicLimit | null): [PublicLimit, string | null][] {
  const checks: [PublicLimit, string | null][] = [];
  if (deps.clientIp) checks.push([perClient, deps.clientIp]);
  if (perEmail && email) checks.push([perEmail, email]);
  if (perClinic) checks.push([perClinic, null]);
  return checks;
}

function confirmationQueries(
  deps: FlowDeps,
  clinic: PublicClinic,
  patient: { id: string; firstName: string; email: string | null },
  visit: { startsAt: string; siteName: string; practitionerName: string; reference: string },
  manageUrl: string,
  forms: number,
  actor: PmsActor,
): BatchQuery[] {
  if (!patient.email) return [];
  const mailer = deps.mailer ?? portalMailer();
  const text = bookingConfirmedMessage({ clinicName: clinic.name, firstName: patient.firstName, visit, manageUrl, cancellationPolicy: clinic.settings.cancellationPolicy, formsToComplete: forms });
  return portalMessageQueries(deps.ctx, clinic.tenantId, { patientId: patient.id, kind: text.kind, subject: text.subject, body: text.body, recipient: patient.email, status: mailer.status, provider: mailer.provider }, actor).queries;
}

/** A booking from the public booking page. */
export async function bookFromPublicPage(clinic: PublicClinic, raw: Record<string, unknown>, deps: FlowDeps): Promise<PublicBookingOutcome> {
  const { ctx, now } = deps;
  const tenantId = clinic.tenantId;
  if (!clinic.settings.onlineBooking) return { ok: false, error: "Online booking is closed at the moment. Please contact the clinic." };
  if (!clinic.settings.newPatients) return { ok: false, error: "Please sign in to your patient portal to book online." };
  if (typeof raw.website === "string" && raw.website.trim() !== "") return { ok: false, error: GENERIC };
  const today = ukToday(now);
  const parsed = publicBookingSchema(today).safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Please check the answers marked below.", fieldErrors: fieldErrors(parsed.error) };
  const d = parsed.data;
  const limited = await publicLimits(ctx, tenantId, limitChecks(deps, d.email, "bookingPerClient", "bookingPerEmail", "bookingPerClinic"), deps.limitSecret);
  if (!limited.ok) return { ok: false, error: tooManyMessage(limited.retryAfterSeconds) };
  const human = await verifyHumanCheck(deps.humanToken, deps.clientIp);
  if (!human.ok) return { ok: false, error: "Please complete the check that you are not a robot, then book again." };

  const catalogue = await bookingCatalogue(ctx, tenantId);
  const date = londonParts(Date.parse(d.startsAt)).date;
  const { slots, service } = await findSlots(ctx, tenantId, clinic.settings, catalogue, { siteId: d.siteId, serviceId: d.serviceId, practitionerId: d.practitionerId, fromDate: date, days: 1, now });
  const slot = pickSlot(slots, d.startsAt, d.practitionerId);
  if (!slot || !service) return { ok: false, error: SLOT_GONE, slotGone: true };

  const actor = patientActor();
  const existing = await findPatientForBooking(ctx, tenantId, d);
  let patient: { id: string; firstName: string; email: string | null };
  let match: "new" | "existing";
  if (existing) {
    patient = { id: existing.id, firstName: existing.preferredName || existing.firstName, email: existing.email };
    match = "existing";
  } else {
    const created = await createPatient(
      ctx,
      tenantId,
      { firstName: d.firstName, lastName: d.lastName, dateOfBirth: d.dateOfBirth, email: d.email, phoneMobile: d.phoneMobile, reminderSms: d.reminders ?? true, reminderEmail: d.reminders ?? true },
      actor,
    );
    patient = { id: created.id, firstName: created.firstName, email: created.email };
    match = "new";
  }
  const forms = await formsToSendWithBooking(ctx, tenantId, match === "new");
  const dir = await directoryView(ctx, tenantId);
  const secret = newSecret();
  const manageUrl = `${deps.origin}${clinicPublicPaths(tenantId).manage(secret)}`;
  // The confirmation goes to the address the person typed – for a matched record too: it is the address that
  // booked, and it reveals nothing of the record (date, time, place and the reference only).
  const recipient = { ...patient, email: d.email, firstName: d.firstName };
  const result = await createOnlineBooking(
    ctx,
    tenantId,
    {
      patientId: patient.id,
      siteId: slot.siteId,
      practitionerId: slot.practitionerId,
      serviceId: service.id,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      blocksUntil: slot.blocksUntil,
      channel: "booking_page",
      patientMatch: match,
      manageTokenHash: hashSecret(secret),
      manageExpiresAt: manageLinkExpiry(slot.startsAt),
    },
    actor,
    (b) => [
      ...forms.flatMap((t) => intakeRequestQueries(ctx, tenantId, t, { patientId: patient.id, bookingId: b.id }, actor).queries),
      ...confirmationQueries(deps, clinic, recipient, { startsAt: slot.startsAt, siteName: dir.siteName(slot.siteId), practitionerName: dir.practitionerName(slot.practitionerId), reference: b.reference }, manageUrl, forms.length, actor),
    ],
    { via: "patient" },
  );
  if (!result.ok) return { ok: false, error: SLOT_GONE, slotGone: true };
  await portalDiary().onBooked?.(ctx, tenantId, result.booking, actor);
  return {
    ok: true,
    reference: result.booking.reference,
    manageUrl,
    startsAt: result.booking.startsAt,
    siteName: dir.siteName(slot.siteId),
    practitionerName: dir.practitionerName(slot.practitionerId),
    serviceName: service.name,
    forms: forms.length,
  };
}

export type PortalBookingOutcome = { ok: true; booking: OnlineBooking } | { ok: false; error: string; fieldErrors?: Record<string, string>; slotGone?: boolean };

/** A booking by a patient signed in to the portal (their own record; no details asked). */
export async function bookFromPortal(clinic: PublicClinic, patientId: string, sessionId: string, raw: Record<string, unknown>, deps: FlowDeps): Promise<PortalBookingOutcome> {
  const { ctx, now } = deps;
  const tenantId = clinic.tenantId;
  if (!clinic.settings.onlineBooking) return { ok: false, error: "Online booking is closed at the moment. Please contact the clinic." };
  const parsed = PortalBookingSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Please choose a time.", fieldErrors: fieldErrors(parsed.error) };
  const d = parsed.data;
  const limited = await publicLimits(ctx, tenantId, limitChecks(deps, `portal:${patientId}`, "bookingPerClient", "bookingPerEmail", "bookingPerClinic"), deps.limitSecret);
  if (!limited.ok) return { ok: false, error: tooManyMessage(limited.retryAfterSeconds) };
  const catalogue = await bookingCatalogue(ctx, tenantId);
  const { slots, service } = await findSlots(ctx, tenantId, clinic.settings, catalogue, { ...d, fromDate: londonParts(Date.parse(d.startsAt)).date, days: 1, now });
  const slot = pickSlot(slots, d.startsAt, d.practitionerId);
  if (!slot || !service) return { ok: false, error: SLOT_GONE, slotGone: true };
  const summary = (await getPatientSummaries(ctx, tenantId, [patientId])).get(patientId);
  if (!summary || summary.status !== "active") return { ok: false, error: GENERIC };
  const actor = patientActor(sessionId);
  const forms = await formsToSendWithBooking(ctx, tenantId, false);
  const dir = await directoryView(ctx, tenantId);
  const portalUrl = `${deps.origin}${clinicPublicPaths(tenantId).portal}`;
  const result = await createOnlineBooking(
    ctx,
    tenantId,
    { patientId, siteId: slot.siteId, practitionerId: slot.practitionerId, serviceId: service.id, startsAt: slot.startsAt, endsAt: slot.endsAt, blocksUntil: slot.blocksUntil, channel: "portal", patientMatch: "portal", manageTokenHash: null, manageExpiresAt: null },
    actor,
    (b) => [
      ...forms.flatMap((t) => intakeRequestQueries(ctx, tenantId, t, { patientId, bookingId: b.id }, actor).queries),
      ...confirmationQueries(
        deps,
        clinic,
        { id: patientId, firstName: summary.preferredName || summary.firstName, email: summary.email },
        { startsAt: slot.startsAt, siteName: dir.siteName(slot.siteId), practitionerName: dir.practitionerName(slot.practitionerId), reference: b.reference },
        portalUrl,
        forms.length,
        actor,
      ),
    ],
    { via: "patient" },
  );
  if (!result.ok) return { ok: false, error: SLOT_GONE, slotGone: true };
  await portalDiary().onBooked?.(ctx, tenantId, result.booking, actor);
  return { ok: true, booking: result.booking };
}

export type ChangeOutcome = { ok: true; booking: OnlineBooking } | { ok: false; error: string; slotGone?: boolean };

async function messageTarget(ctx: RepoContext, tenantId: string, patientId: string): Promise<{ id: string; firstName: string; email: string | null } | null> {
  const p = (await getPatientSummaries(ctx, tenantId, [patientId])).get(patientId);
  return p ? { id: p.id, firstName: p.preferredName || p.firstName, email: p.email } : null;
}

function messageQueries(deps: FlowDeps, tenantId: string, to: { id: string; email: string | null } | null, text: { kind: Parameters<typeof portalMessageQueries>[2]["kind"]; subject: string; body: string }, actor: PmsActor): BatchQuery[] {
  if (!to?.email) return [];
  const mailer = deps.mailer ?? portalMailer();
  return portalMessageQueries(deps.ctx, tenantId, { patientId: to.id, ...text, recipient: to.email, status: mailer.status, provider: mailer.provider }, actor).queries;
}

/** The patient cancels online (within the notice period). */
export async function cancelByPatient(clinic: PublicClinic, booking: OnlineBooking, expectedRev: number, deps: FlowDeps & { sessionId?: string | null }): Promise<ChangeOutcome> {
  const { ctx, now } = deps;
  const allowed = patientMayChange(clinic.settings, booking, now.getTime());
  if (!allowed.ok) return { ok: false, error: changeRefusalMessage(allowed.reason, clinic.settings.contactPhone) };
  const actor = patientActor(deps.sessionId ?? null);
  const dir = await directoryView(ctx, clinic.tenantId);
  const to = await messageTarget(ctx, clinic.tenantId, booking.patientId);
  const text = bookingCancelledMessage({
    clinicName: clinic.name,
    firstName: to?.firstName ?? "",
    visit: { startsAt: booking.startsAt, siteName: dir.siteName(booking.siteId), practitionerName: dir.practitionerName(booking.practitionerId), reference: booking.reference },
    byClinic: false,
    contactPhone: clinic.settings.contactPhone,
  });
  const result = await cancelOnlineBooking(ctx, clinic.tenantId, booking.id, expectedRev, { by: "patient", reason: "patient_request", late: false }, actor, messageQueries(deps, clinic.tenantId, to, text, actor));
  if (!result.ok) return { ok: false, error: "This booking changed in the meantime. Please reload the page." };
  await portalDiary().onCancelled?.(ctx, clinic.tenantId, result.booking, actor);
  return { ok: true, booking: result.booking };
}

/** The patient moves a booking to another free time (same appointment type and site; within the notice period). */
export async function rebookByPatient(
  clinic: PublicClinic,
  booking: OnlineBooking,
  expectedRev: number,
  raw: { practitionerId: unknown; startsAt: unknown },
  deps: FlowDeps & { sessionId?: string | null; manageUrl?: string | null },
): Promise<ChangeOutcome> {
  const { ctx, now } = deps;
  const allowed = patientMayChange(clinic.settings, booking, now.getTime());
  if (!allowed.ok) return { ok: false, error: changeRefusalMessage(allowed.reason, clinic.settings.contactPhone) };
  const parsed = PortalBookingSchema.safeParse({ siteId: booking.siteId, serviceId: booking.serviceId, practitionerId: raw.practitionerId, startsAt: raw.startsAt });
  if (!parsed.success) return { ok: false, error: "Please choose a new time." };
  const limited = await publicLimits(ctx, clinic.tenantId, limitChecks(deps, `patient:${booking.patientId}`, "patientWritesPerClient", null, null), deps.limitSecret);
  if (!limited.ok) return { ok: false, error: tooManyMessage(limited.retryAfterSeconds) };
  const d = parsed.data;
  const catalogue = await bookingCatalogue(ctx, clinic.tenantId);
  const { slots, service } = await findSlots(ctx, clinic.tenantId, clinic.settings, catalogue, { ...d, fromDate: londonParts(Date.parse(d.startsAt)).date, days: 1, now, ignoreBookingId: booking.id });
  const slot = pickSlot(slots, d.startsAt, d.practitionerId);
  if (!slot || !service) return { ok: false, error: SLOT_GONE, slotGone: true };
  const actor = patientActor(deps.sessionId ?? null);
  const dir = await directoryView(ctx, clinic.tenantId);
  const to = await messageTarget(ctx, clinic.tenantId, booking.patientId);
  const link = deps.manageUrl ?? `${deps.origin}${clinicPublicPaths(clinic.tenantId).portal}`;
  const result = await rebookOnlineBooking(
    ctx,
    clinic.tenantId,
    booking.id,
    expectedRev,
    { siteId: slot.siteId, practitionerId: slot.practitionerId, serviceId: service.id, startsAt: slot.startsAt, endsAt: slot.endsAt, blocksUntil: slot.blocksUntil },
    actor,
    (b) => [
      // The forms of the old booking follow it to the new one.
      moveResponsesQuery(ctx, clinic.tenantId, booking.id, b.id),
      ...messageQueries(
        deps,
        clinic.tenantId,
        to,
        bookingChangedMessage({
          clinicName: clinic.name,
          firstName: to?.firstName ?? "",
          visit: { startsAt: slot.startsAt, siteName: dir.siteName(slot.siteId), practitionerName: dir.practitionerName(slot.practitionerId), reference: b.reference },
          manageUrl: link,
        }),
        actor,
      ),
    ],
  );
  if (!result.ok) return result.reason === "slot_taken" ? { ok: false, error: SLOT_GONE, slotGone: true } : { ok: false, error: "This booking changed in the meantime. Please reload the page." };
  const old = await getOnlineBooking(ctx, clinic.tenantId, booking.id);
  if (old) await portalDiary().onCancelled?.(ctx, clinic.tenantId, old, actor);
  await portalDiary().onBooked?.(ctx, clinic.tenantId, result.booking, actor);
  return { ok: true, booking: result.booking };
}

/** The clinic cancels an online booking (staff). The patient gets a message; a late cancellation is recorded. */
export async function cancelByClinic(
  ctx: RepoContext,
  clinic: { tenantId: string; name: string; contactPhone: string | null; cancelNoticeHours: number },
  bookingId: string,
  expectedRev: number,
  actor: PmsActor,
  options: { now?: Date; mailer?: PortalMailer; origin: string },
): Promise<ChangeOutcome> {
  const booking = await getOnlineBooking(ctx, clinic.tenantId, bookingId);
  if (!booking) return { ok: false, error: "That booking does not exist." };
  if (booking.status !== "booked") return { ok: false, error: "This booking is already cancelled." };
  const now = options.now ?? new Date();
  const dir = await directoryView(ctx, clinic.tenantId);
  const to = await messageTarget(ctx, clinic.tenantId, booking.patientId);
  const deps: FlowDeps = { ctx, now, origin: options.origin, clientIp: null, mailer: options.mailer };
  const text = bookingCancelledMessage({
    clinicName: clinic.name,
    firstName: to?.firstName ?? "",
    visit: { startsAt: booking.startsAt, siteName: dir.siteName(booking.siteId), practitionerName: dir.practitionerName(booking.practitionerId), reference: booking.reference },
    byClinic: true,
    contactPhone: clinic.contactPhone,
  });
  const result = await cancelOnlineBooking(
    ctx,
    clinic.tenantId,
    booking.id,
    expectedRev,
    { by: "clinic", reason: "clinic", late: isLateCancellation(clinic, booking.startsAt, now.getTime()) },
    actor,
    messageQueries(deps, clinic.tenantId, to, text, actor),
  );
  if (!result.ok) return { ok: false, error: "This booking changed in the meantime. Please reload the page." };
  await portalDiary().onCancelled?.(ctx, clinic.tenantId, result.booking, actor);
  return { ok: true, booking: result.booking };
}
