/**
 * The diary's writes as the screens call them (through the server actions in src/app/app/clinic/diary/**):
 * book (single or recurring, from the waiting list or an offer), rebook, move, resize, status changes (arrived,
 * attended, did not attend, undo, reinstate), cancel (late or not, with the fee flag), details, the rest of a
 * series, blocked time, rotas, the waiting list and its offers.
 *
 * Each function: checks the role's permission (`DIARY_ACTION_PERMISSIONS` – the action files ask for the same
 * one, a test compares them), validates the input with the module's zod schema, checks the SITE SCOPE of every
 * site it touches (an item at a site outside the member's scope is answered as "no longer exists"), then calls
 * the repositories – which scope everything to the clinic and write the change and its audit row in one batch.
 * Answers are DiaryActionResult with plain words; nothing of an internal error reaches the screen. Server only.
 */
import "server-only";
import { z } from "zod";
import { PMS_ID_PATTERN } from "../../../modules/pms/core/ids";
import type { PmsPermission } from "../../../modules/pms/core/permissions";
import { PAYER_TYPES, PmsIdSchema, type PatientInput } from "../../../modules/pms/core/schemas";
import { formatUkDate, isIsoDate } from "../../../modules/pms/core/text";
import { DIARY_COPY, STATUS_LABELS } from "../../../modules/pms/diary/copy";
import { CANCEL_REASONS, isLateCancellation } from "../../../modules/pms/diary/rules";
import {
  AppointmentDetailsPatchSchema,
  AppointmentStatusChangeSchema,
  AvailabilityInputSchema,
  AvailabilityPatchSchema,
  BlockInputSchema,
  BookAppointmentSchema,
  CancelAppointmentSchema,
  ExpectedRevSchema,
  MoveAppointmentSchema,
  RebookAppointmentSchema,
  ResizeAppointmentSchema,
  WaitingListInputSchema,
  WaitingListOfferAnswerSchema,
  WaitingListOfferSchema,
  WaitingListPatchSchema,
  WaitingListStatusSchema,
} from "../../../modules/pms/diary/schemas";
import { addDays, formatHhmm, londonParts, parseHhmm, weekdayName } from "../../../modules/pms/diary/time";
import type { BookResult, DiaryActionResult } from "../../../modules/pms/diary/types";
import { nowIso } from "../../repos/context";
import {
  bookAppointment,
  cancelSeriesFrom,
  createBlock,
  getDiaryItem,
  moveAppointment,
  rebookAppointment,
  resizeAppointment,
  seriesSitesFrom,
  setAppointmentStatus,
  updateAppointmentDetails,
} from "../../repos/pms/diary/appointments";
import { createAvailability, endAvailability, getAvailability, listAvailability, updateAvailability } from "../../repos/pms/diary/availability";
import {
  addToWaitingList,
  answerWaitingListOffer,
  getWaitingListEntry,
  getWaitingListOffer,
  offerWaitingListSlot,
  setWaitingListStatus,
  updateWaitingListEntry,
} from "../../repos/pms/diary/waiting-list";
import { setDaySheetDob } from "../../repos/pms/diary/settings";
import { DUPLICATE_REASON_LABELS } from "../../../modules/pms/records/duplicates";
import type { RecordsActor } from "../records/access";
import { registerPatientFor } from "../records/patients-service";
import { openCaseFor } from "../records/cases-service";
import { startNoteFor, templatesForNewNote } from "../records/notes-service";
import { patientDisplayName } from "./view";
import { clashMessages, diaryAction, fromPmsSave, fromSaveResult, invalid, warningMessages } from "./actions-support";
import { inScope, type DiaryCaller } from "./caller";

/** The permission each diary write needs (the action of the same name asks for exactly this one). */
export const DIARY_ACTION_PERMISSIONS = {
  bookAppointmentAction: "diary.book",
  rebookAppointmentAction: "diary.book",
  moveAppointmentAction: "diary.book",
  resizeAppointmentAction: "diary.book",
  setAppointmentStatusAction: "diary.book",
  cancelAppointmentAction: "diary.book",
  updateAppointmentDetailsAction: "diary.book",
  cancelSeriesAction: "diary.book",
  createBlockAction: "diary.book",
  createRotaEntryAction: "diary.manage",
  updateRotaEntryAction: "diary.manage",
  endRotaEntryAction: "diary.manage",
  addToWaitingListAction: "diary.book",
  updateWaitingListEntryAction: "diary.book",
  setWaitingListStatusAction: "diary.book",
  offerWaitingListSlotAction: "diary.book",
  answerWaitingListOfferAction: "diary.book",
  bookWaitingListOfferAction: "diary.book",
  setDaySheetDobAction: "settings.manage",
  registerBookingPatientAction: "patients.edit",
  openBookingCaseAction: "patients.edit",
  startTreatmentAction: "clinical.edit",
  saveWeeklyRotaAction: "diary.manage",
} as const satisfies Record<string, PmsPermission>;

export type DiaryActionName = keyof typeof DIARY_ACTION_PERMISSIONS;

const NOT_ALLOWED: DiaryActionResult = { ok: false, error: DIARY_COPY.notAllowed };
const GONE: DiaryActionResult = { ok: false, error: DIARY_COPY.notFound, conflict: true };
const NOT_YOUR_SITE: DiaryActionResult = { ok: false, error: DIARY_COPY.notAtYourSites, fieldErrors: { siteId: DIARY_COPY.notAtYourSites } };

function allowed(caller: DiaryCaller, action: DiaryActionName): boolean {
  return caller.can(DIARY_ACTION_PERMISSIONS[action]);
}

const isId = (v: unknown): v is string => typeof v === "string" && PMS_ID_PATTERN.test(v);

function obj(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

/** Splits `{ id, ...rest }` (the record an action changes) from the rest of its input. */
function withId(input: unknown, key = "id"): { id: string | null; rest: Record<string, unknown> } {
  const { [key]: id, ...rest } = obj(input);
  return { id: isId(id) ? id : null, rest };
}

/** The item, if it exists in this clinic AND at one of the caller's sites. */
async function scopedItem(caller: DiaryCaller, id: string) {
  const item = await getDiaryItem(caller.ctx, caller.tenantId, id);
  return item && inScope(caller, item.siteId) ? item : null;
}

function bookAnswer(r: BookResult, occurrences: number): DiaryActionResult {
  if (!r.ok) {
    const clashDates = new Set(r.clashes.map((c) => c.date));
    return {
      ok: false,
      error: occurrences > 1 ? `${clashDates.size} of the ${occurrences} dates are not free.` : "That time is not free.",
      clashes: clashMessages(r.clashes),
      canSkipClashes: occurrences > 1 && clashDates.size < occurrences,
      patientOnly: r.clashes.every((c) => c.resource === "patient"),
    };
  }
  const n = r.items.length;
  const skipped = r.skippedDates.length;
  return {
    ok: true,
    message: n === 1 ? "Appointment booked." : `${n} appointments booked${skipped ? ` (${skipped} ${skipped === 1 ? "date" : "dates"} skipped)` : ""}.`,
    warnings: warningMessages(r.warnings),
    itemId: r.items[0]?.id,
    itemIds: r.items.map((i) => i.id),
    rev: r.items[0]?.rev,
    skippedDates: r.skippedDates,
  };
}

const BookingFlagsSchema = z.object({
  skipClashes: z.boolean().optional(),
  skipDates: z.array(z.string().refine(isIsoDate, "A date as YYYY-MM-DD")).max(52).optional(),
  allowPatientOverlap: z.boolean().optional(),
  waitingListId: z.preprocess((v) => (v === "" || v === null ? undefined : v), PmsIdSchema.optional()),
});

/* ------------------------------------------------------------------------------------------------
 * Appointments
 * ----------------------------------------------------------------------------------------------*/

/** Books an appointment or a recurring series (optionally settling a waiting-list entry). */
export async function bookAppointmentFor(caller: DiaryCaller, input: unknown): Promise<DiaryActionResult> {
  if (!allowed(caller, "bookAppointmentAction")) return NOT_ALLOWED;
  const { skipClashes, skipDates, allowPatientOverlap, waitingListId, ...booking } = obj(input);
  const flags = BookingFlagsSchema.safeParse({ skipClashes, skipDates, allowPatientOverlap, waitingListId });
  if (!flags.success) return invalid(flags.error);
  const parsed = BookAppointmentSchema.safeParse(booking);
  if (!parsed.success) return invalid(parsed.error);
  if (!inScope(caller, parsed.data.siteId)) return NOT_YOUR_SITE;
  return diaryAction("book", async () => {
    const r = await bookAppointment(caller.ctx, caller.tenantId, parsed.data, caller.actor, {
      skipClashes: flags.data.skipClashes === true,
      skipDates: flags.data.skipDates,
      allowPatientOverlap: flags.data.allowPatientOverlap === true,
      waitingListId: flags.data.waitingListId,
    });
    return bookAnswer(r, parsed.data.repeat?.occurrences ?? 1);
  });
}

/** A new appointment like a cancelled or missed one. */
export async function rebookAppointmentFor(caller: DiaryCaller, input: unknown): Promise<DiaryActionResult> {
  if (!allowed(caller, "rebookAppointmentAction")) return NOT_ALLOWED;
  const { id, rest } = withId(input);
  if (!id) return GONE;
  const { skipClashes: _s, allowPatientOverlap, ...rebook } = rest;
  void _s;
  const parsed = RebookAppointmentSchema.safeParse(rebook);
  if (!parsed.success) return invalid(parsed.error);
  return diaryAction("rebook", async () => {
    const item = await scopedItem(caller, id);
    if (!item || item.kind !== "appointment") return GONE;
    if (!inScope(caller, parsed.data.siteId ?? item.siteId)) return NOT_YOUR_SITE;
    const r = await rebookAppointment(caller.ctx, caller.tenantId, id, parsed.data, caller.actor, { allowPatientOverlap: allowPatientOverlap === true });
    return bookAnswer(r, 1);
  });
}

/** Moves an appointment or blocked time (drag and drop, or the keyboard "Move" form). */
export async function moveAppointmentFor(caller: DiaryCaller, input: unknown): Promise<DiaryActionResult> {
  if (!allowed(caller, "moveAppointmentAction")) return NOT_ALLOWED;
  const { id, rest } = withId(input);
  if (!id) return GONE;
  const { allowPatientOverlap, ...move } = rest;
  const parsed = MoveAppointmentSchema.safeParse(move);
  if (!parsed.success) return invalid(parsed.error);
  return diaryAction("move", async () => {
    const item = await scopedItem(caller, id);
    if (!item) return GONE;
    if (!inScope(caller, parsed.data.siteId ?? item.siteId)) return NOT_YOUR_SITE;
    const r = await moveAppointment(caller.ctx, caller.tenantId, id, parsed.data, caller.actor, { allowPatientOverlap: allowPatientOverlap === true });
    return fromSaveResult(r, "Moved.");
  });
}

/** Changes the length of an appointment or blocked time (same start). */
export async function resizeAppointmentFor(caller: DiaryCaller, input: unknown): Promise<DiaryActionResult> {
  if (!allowed(caller, "resizeAppointmentAction")) return NOT_ALLOWED;
  const { id, rest } = withId(input);
  if (!id) return GONE;
  const parsed = ResizeAppointmentSchema.safeParse(rest);
  if (!parsed.success) return invalid(parsed.error);
  return diaryAction("resize", async () => {
    if (!(await scopedItem(caller, id))) return GONE;
    return fromSaveResult(await resizeAppointment(caller.ctx, caller.tenantId, id, parsed.data, caller.actor), "Length changed.");
  });
}

/** Arrived, attended, did not attend (with the fee flag), undo, reinstate; removing / restoring blocked time. */
export async function setAppointmentStatusFor(caller: DiaryCaller, input: unknown): Promise<DiaryActionResult> {
  if (!allowed(caller, "setAppointmentStatusAction")) return NOT_ALLOWED;
  const { id, rest } = withId(input);
  if (!id) return GONE;
  const parsed = AppointmentStatusChangeSchema.safeParse(rest);
  if (!parsed.success) return invalid(parsed.error);
  return diaryAction("status", async () => {
    const item = await scopedItem(caller, id);
    if (!item) return GONE;
    const r = await setAppointmentStatus(caller.ctx, caller.tenantId, id, parsed.data, caller.actor);
    const label = item.kind === "block" ? (parsed.data.status === "cancelled" ? "Blocked time removed." : "Blocked time restored.") : `${STATUS_LABELS[parsed.data.status]}.`;
    return fromSaveResult(r, label);
  });
}

/**
 * Cancels an appointment with a reason. Late or not: as asked, else by the clock (less than 24 hours before the
 * start, or after it, is a late cancellation – the fee flag is on unless switched off).
 */
export async function cancelAppointmentFor(caller: DiaryCaller, input: unknown): Promise<DiaryActionResult> {
  if (!allowed(caller, "cancelAppointmentAction")) return NOT_ALLOWED;
  const { id, rest } = withId(input);
  if (!id) return GONE;
  const parsed = CancelAppointmentSchema.safeParse(rest);
  if (!parsed.success) return invalid(parsed.error);
  return diaryAction("cancel", async () => {
    const item = await scopedItem(caller, id);
    if (!item || item.kind !== "appointment") return GONE;
    const d = parsed.data;
    const late = d.late ?? isLateCancellation(item.startsAt, nowIso(caller.ctx));
    const r = await setAppointmentStatus(
      caller.ctx,
      caller.tenantId,
      id,
      { expectedRev: d.expectedRev, status: late ? "late_cancelled" : "cancelled", cancelReason: d.reason, cancelNote: d.note, feeDue: late ? (d.feeDue ?? true) : undefined, feePence: late ? d.feePence : undefined },
      caller.actor,
    );
    return fromSaveResult(r, late ? "Cancelled (late cancellation)." : "Cancelled.");
  });
}

/** The booking note, the case, the authorisation, the appointment type. */
export async function updateAppointmentDetailsFor(caller: DiaryCaller, input: unknown): Promise<DiaryActionResult> {
  if (!allowed(caller, "updateAppointmentDetailsAction")) return NOT_ALLOWED;
  const { id, rest } = withId(input);
  if (!id) return GONE;
  const { expectedRev, ...patch } = rest;
  const rev = ExpectedRevSchema.safeParse(expectedRev);
  if (!rev.success) return GONE;
  const parsed = AppointmentDetailsPatchSchema.safeParse(patch);
  if (!parsed.success) return invalid(parsed.error);
  return diaryAction("details", async () => {
    if (!(await scopedItem(caller, id))) return GONE;
    return fromSaveResult(await updateAppointmentDetails(caller.ctx, caller.tenantId, id, rev.data, parsed.data, caller.actor), "Saved.");
  });
}

const CancelSeriesSchema = z.object({
  seriesId: PmsIdSchema,
  fromDate: z.string().refine(isIsoDate, "Enter the date as YYYY-MM-DD"),
  reason: z.enum(CANCEL_REASONS).optional(),
});

/** Cancels the booked appointments of a recurring booking from a date on. */
export async function cancelSeriesFor(caller: DiaryCaller, input: unknown): Promise<DiaryActionResult> {
  if (!allowed(caller, "cancelSeriesAction")) return NOT_ALLOWED;
  const parsed = CancelSeriesSchema.safeParse(obj(input));
  if (!parsed.success) return invalid(parsed.error);
  const d = parsed.data;
  return diaryAction("cancel_series", async () => {
    const sites = await seriesSitesFrom(caller.ctx, caller.tenantId, d.seriesId, d.fromDate);
    if (sites.some((s) => !inScope(caller, s))) return GONE;
    const n = sites.length === 0 ? 0 : await cancelSeriesFrom(caller.ctx, caller.tenantId, d.seriesId, d.fromDate, caller.actor, d.reason ?? "patient");
    return { ok: true, message: n === 0 ? "Nothing left to cancel." : `${n} ${n === 1 ? "appointment" : "appointments"} cancelled.`, warnings: [], itemId: d.seriesId };
  });
}

/* ------------------------------------------------------------------------------------------------
 * Blocked time (moved with moveAppointmentFor, removed / restored with setAppointmentStatusFor)
 * ----------------------------------------------------------------------------------------------*/

export async function createBlockFor(caller: DiaryCaller, input: unknown): Promise<DiaryActionResult> {
  if (!allowed(caller, "createBlockAction")) return NOT_ALLOWED;
  const parsed = BlockInputSchema.safeParse(obj(input));
  if (!parsed.success) return invalid(parsed.error);
  if (!inScope(caller, parsed.data.siteId)) return NOT_YOUR_SITE;
  return diaryAction("block", async () => {
    const r = await createBlock(caller.ctx, caller.tenantId, parsed.data, caller.actor);
    if (!r.ok) return { ok: false, error: "Something is already booked in that time. Move or cancel it first.", clashes: clashMessages(r.clashes) };
    return { ok: true, message: "Time blocked.", warnings: [], itemId: r.item.id, rev: r.item.rev };
  });
}

/* ------------------------------------------------------------------------------------------------
 * Rotas (diary.manage)
 * ----------------------------------------------------------------------------------------------*/

export async function createRotaEntryFor(caller: DiaryCaller, input: unknown): Promise<DiaryActionResult> {
  if (!allowed(caller, "createRotaEntryAction")) return NOT_ALLOWED;
  const parsed = AvailabilityInputSchema.safeParse(obj(input));
  if (!parsed.success) return invalid(parsed.error);
  if (!inScope(caller, parsed.data.siteId)) return NOT_YOUR_SITE;
  return diaryAction("rota_create", async () => {
    const rule = await createAvailability(caller.ctx, caller.tenantId, parsed.data, caller.actor);
    return { ok: true, message: "Rota entry added.", warnings: [], itemId: rule.id, rev: rule.rev };
  });
}

async function scopedRule(caller: DiaryCaller, id: string) {
  const rule = await getAvailability(caller.ctx, caller.tenantId, id);
  return rule && inScope(caller, rule.siteId) ? rule : null;
}

export async function updateRotaEntryFor(caller: DiaryCaller, input: unknown): Promise<DiaryActionResult> {
  if (!allowed(caller, "updateRotaEntryAction")) return NOT_ALLOWED;
  const { id, rest } = withId(input);
  if (!id) return { ok: false, error: DIARY_COPY.recordGone, conflict: true };
  const { expectedRev, ...patch } = rest;
  const rev = ExpectedRevSchema.safeParse(expectedRev);
  if (!rev.success) return { ok: false, error: DIARY_COPY.recordGone, conflict: true };
  const parsed = AvailabilityPatchSchema.safeParse(patch);
  if (!parsed.success) return invalid(parsed.error);
  return diaryAction("rota_update", async () => {
    if (!(await scopedRule(caller, id))) return { ok: false, error: DIARY_COPY.recordGone, conflict: true };
    return fromPmsSave(await updateAvailability(caller.ctx, caller.tenantId, id, rev.data, parsed.data, caller.actor), "Rota entry saved.", id);
  });
}

const EndRotaSchema = z.object({ expectedRev: ExpectedRevSchema, lastDate: z.string().refine(isIsoDate, "Enter the last day as YYYY-MM-DD") });

/** Ends a rota entry after a last day (bookings already made stay); a day before its first day switches it off. */
export async function endRotaEntryFor(caller: DiaryCaller, input: unknown): Promise<DiaryActionResult> {
  if (!allowed(caller, "endRotaEntryAction")) return NOT_ALLOWED;
  const { id, rest } = withId(input);
  if (!id) return { ok: false, error: DIARY_COPY.recordGone, conflict: true };
  const parsed = EndRotaSchema.safeParse(rest);
  if (!parsed.success) return invalid(parsed.error);
  return diaryAction("rota_end", async () => {
    if (!(await scopedRule(caller, id))) return { ok: false, error: DIARY_COPY.recordGone, conflict: true };
    return fromPmsSave(await endAvailability(caller.ctx, caller.tenantId, id, parsed.data.expectedRev, parsed.data.lastDate, caller.actor), "Rota entry ended.", id);
  });
}

/* ------------------------------------------------------------------------------------------------
 * Waiting list and offers
 * ----------------------------------------------------------------------------------------------*/

async function scopedEntry(caller: DiaryCaller, id: string) {
  const entry = await getWaitingListEntry(caller.ctx, caller.tenantId, id);
  return entry && (entry.siteId === null || inScope(caller, entry.siteId)) ? entry : null;
}

const ENTRY_GONE: DiaryActionResult = { ok: false, error: "This waiting-list entry no longer exists.", conflict: true };

export async function addToWaitingListFor(caller: DiaryCaller, input: unknown): Promise<DiaryActionResult> {
  if (!allowed(caller, "addToWaitingListAction")) return NOT_ALLOWED;
  const parsed = WaitingListInputSchema.safeParse(obj(input));
  if (!parsed.success) return invalid(parsed.error);
  if (parsed.data.siteId && !inScope(caller, parsed.data.siteId)) return NOT_YOUR_SITE;
  return diaryAction("waiting_add", async () => {
    const entry = await addToWaitingList(caller.ctx, caller.tenantId, parsed.data, caller.actor);
    return { ok: true, message: "Added to the waiting list.", warnings: [], itemId: entry.id, rev: entry.rev };
  });
}

export async function updateWaitingListEntryFor(caller: DiaryCaller, input: unknown): Promise<DiaryActionResult> {
  if (!allowed(caller, "updateWaitingListEntryAction")) return NOT_ALLOWED;
  const { id, rest } = withId(input);
  if (!id) return ENTRY_GONE;
  const { expectedRev, ...patch } = rest;
  const rev = ExpectedRevSchema.safeParse(expectedRev);
  if (!rev.success) return ENTRY_GONE;
  const parsed = WaitingListPatchSchema.safeParse(patch);
  if (!parsed.success) return invalid(parsed.error);
  if (parsed.data.siteId && !inScope(caller, parsed.data.siteId)) return NOT_YOUR_SITE;
  return diaryAction("waiting_update", async () => {
    if (!(await scopedEntry(caller, id))) return ENTRY_GONE;
    return fromPmsSave(await updateWaitingListEntry(caller.ctx, caller.tenantId, id, rev.data, parsed.data, caller.actor), "Saved.", id);
  });
}

/** Back to waiting, or removed (with a short reason). */
export async function setWaitingListStatusFor(caller: DiaryCaller, input: unknown): Promise<DiaryActionResult> {
  if (!allowed(caller, "setWaitingListStatusAction")) return NOT_ALLOWED;
  const { id, rest } = withId(input);
  if (!id) return ENTRY_GONE;
  const parsed = WaitingListStatusSchema.safeParse(rest);
  if (!parsed.success) return invalid(parsed.error);
  return diaryAction("waiting_status", async () => {
    if (!(await scopedEntry(caller, id))) return ENTRY_GONE;
    const r = await setWaitingListStatus(caller.ctx, caller.tenantId, id, parsed.data, caller.actor);
    return fromPmsSave(r, parsed.data.status === "removed" ? "Removed from the waiting list." : "Back on the waiting list.", id);
  });
}

/** Offers a free slot to a waiting patient (recorded; the slot is not held; nothing is sent). */
export async function offerWaitingListSlotFor(caller: DiaryCaller, input: unknown): Promise<DiaryActionResult> {
  if (!allowed(caller, "offerWaitingListSlotAction")) return NOT_ALLOWED;
  const { id, rest } = withId(input);
  if (!id) return ENTRY_GONE;
  const parsed = WaitingListOfferSchema.safeParse(rest);
  if (!parsed.success) return invalid(parsed.error);
  if (!inScope(caller, parsed.data.siteId)) return NOT_YOUR_SITE;
  return diaryAction("waiting_offer", async () => {
    if (!(await scopedEntry(caller, id))) return ENTRY_GONE;
    const r = await offerWaitingListSlot(caller.ctx, caller.tenantId, id, parsed.data, caller.actor);
    if (!r.ok) return fromPmsSave(r, "", id);
    return { ok: true, message: "Slot offered. It is not held – book it once the patient says yes.", warnings: [], itemId: r.offer.id, rev: r.entryRev };
  });
}

/** The patient declined an offer, or the clinic withdrew it. `expectedRev` is the entry's. */
export async function answerWaitingListOfferFor(caller: DiaryCaller, input: unknown): Promise<DiaryActionResult> {
  if (!allowed(caller, "answerWaitingListOfferAction")) return NOT_ALLOWED;
  const { id, rest } = withId(input, "offerId");
  if (!id) return ENTRY_GONE;
  const parsed = WaitingListOfferAnswerSchema.safeParse(rest);
  if (!parsed.success) return invalid(parsed.error);
  return diaryAction("waiting_answer", async () => {
    const offer = await getWaitingListOffer(caller.ctx, caller.tenantId, id);
    if (!offer || !inScope(caller, offer.siteId) || !(await scopedEntry(caller, offer.waitingListId))) return ENTRY_GONE;
    const r = await answerWaitingListOffer(caller.ctx, caller.tenantId, id, parsed.data, caller.actor);
    return fromPmsSave(r, parsed.data.status === "declined" ? "Offer declined." : "Offer withdrawn.", offer.waitingListId);
  });
}

const BookOfferSchema = z.object({
  caseId: z.preprocess((v) => (v === "" ? null : v), z.union([PmsIdSchema, z.null()]).optional()),
  authorisationId: z.preprocess((v) => (v === "" ? null : v), z.union([PmsIdSchema, z.null()]).optional()),
  notes: z.string().max(2000).optional(),
  allowPatientOverlap: z.boolean().optional(),
});

/**
 * The patient said yes: books the offered slot from the entry – entry booked, offer accepted, appointment
 * written in one batch (or nothing, when the entry was booked or removed meanwhile, or the slot is taken).
 */
export async function bookWaitingListOfferFor(caller: DiaryCaller, input: unknown): Promise<DiaryActionResult> {
  if (!allowed(caller, "bookWaitingListOfferAction")) return NOT_ALLOWED;
  const { id, rest } = withId(input, "offerId");
  if (!id) return ENTRY_GONE;
  const parsed = BookOfferSchema.safeParse(rest);
  if (!parsed.success) return invalid(parsed.error);
  return diaryAction("waiting_book_offer", async () => {
    const offer = await getWaitingListOffer(caller.ctx, caller.tenantId, id);
    if (!offer || !inScope(caller, offer.siteId)) return ENTRY_GONE;
    const entry = await scopedEntry(caller, offer.waitingListId);
    if (!entry) return ENTRY_GONE;
    if (offer.status !== "open") return { ok: false, error: "That offer has been answered already.", conflict: true };
    if (entry.status !== "waiting" && entry.status !== "offered") return { ok: false, error: "This waiting-list entry has been booked or removed already.", conflict: true };
    const serviceId = offer.serviceId ?? entry.serviceId;
    if (!serviceId) return { ok: false, error: "Choose the appointment type first (the offer has none)." };
    const start = londonParts(offer.startsAt);
    const r = await bookAppointment(
      caller.ctx,
      caller.tenantId,
      {
        patientId: entry.patientId,
        serviceId,
        practitionerId: offer.practitionerId,
        siteId: offer.siteId,
        roomId: offer.roomId,
        caseId: parsed.data.caseId === undefined ? entry.caseId : parsed.data.caseId,
        authorisationId: parsed.data.authorisationId ?? null,
        date: start.date,
        startTime: formatHhmm(start.minute),
        durationMinutes: Math.round((Date.parse(offer.endsAt) - Date.parse(offer.startsAt)) / 60_000),
        notes: parsed.data.notes,
      },
      caller.actor,
      { waitingListId: entry.id, offerId: offer.id, allowPatientOverlap: parsed.data.allowPatientOverlap === true },
    );
    return bookAnswer(r, 1);
  });
}

/* ------------------------------------------------------------------------------------------------
 * What the screens send (the actions' input types; every field is validated again on the server)
 * ----------------------------------------------------------------------------------------------*/

type Id = { id: string };
export type BookAppointmentRequest = import("../../../modules/pms/diary/schemas").BookAppointmentInput & { skipClashes?: boolean; skipDates?: string[]; allowPatientOverlap?: boolean; waitingListId?: string | null };
export type RebookAppointmentRequest = Id & import("../../../modules/pms/diary/schemas").RebookAppointmentInput & { allowPatientOverlap?: boolean };
export type MoveAppointmentRequest = Id & import("../../../modules/pms/diary/schemas").MoveAppointmentInput & { allowPatientOverlap?: boolean };
export type ResizeAppointmentRequest = Id & import("../../../modules/pms/diary/schemas").ResizeAppointmentInput;
export type AppointmentStatusRequest = Id & import("../../../modules/pms/diary/schemas").AppointmentStatusChange;
export type CancelAppointmentRequest = Id & import("../../../modules/pms/diary/schemas").CancelAppointmentInput;
export type AppointmentDetailsRequest = Id & { expectedRev: number } & import("../../../modules/pms/diary/schemas").AppointmentDetailsPatch;
export type CancelSeriesRequest = z.input<typeof CancelSeriesSchema>;
export type CreateBlockRequest = import("../../../modules/pms/diary/schemas").BlockInput;
export type CreateRotaEntryRequest = import("../../../modules/pms/diary/schemas").AvailabilityInput;
export type UpdateRotaEntryRequest = Id & { expectedRev: number } & import("../../../modules/pms/diary/schemas").AvailabilityPatch;
export type EndRotaEntryRequest = Id & z.input<typeof EndRotaSchema>;
export type AddToWaitingListRequest = import("../../../modules/pms/diary/schemas").WaitingListInput;
export type UpdateWaitingListEntryRequest = Id & { expectedRev: number } & import("../../../modules/pms/diary/schemas").WaitingListPatch;
export type WaitingListStatusRequest = Id & import("../../../modules/pms/diary/schemas").WaitingListStatusChange;
export type OfferWaitingListSlotRequest = Id & import("../../../modules/pms/diary/schemas").WaitingListOfferInput;
export type AnswerWaitingListOfferRequest = { offerId: string } & import("../../../modules/pms/diary/schemas").WaitingListOfferAnswer;
export type BookWaitingListOfferRequest = { offerId: string } & z.input<typeof BookOfferSchema>;

/* ------------------------------------------------------------------------------------------------
 * Diary settings (settings.manage – owners and administrators)
 * ----------------------------------------------------------------------------------------------*/

const DaySheetDobSchema = z.object({ on: z.boolean() });

/** "Show date of birth on the printed day sheet" (default off). */
export async function setDaySheetDobFor(caller: DiaryCaller, input: unknown): Promise<DiaryActionResult> {
  if (!allowed(caller, "setDaySheetDobAction")) return NOT_ALLOWED;
  const parsed = DaySheetDobSchema.safeParse(obj(input));
  if (!parsed.success) return invalid(parsed.error);
  return diaryAction("diary_settings", async () => {
    const saved = await setDaySheetDob(caller.ctx, caller.tenantId, parsed.data.on, caller.actor);
    return { ok: true, message: saved.showDobOnDaySheet ? "Dates of birth will be printed on the day sheet." : "Dates of birth will not be printed on the day sheet.", warnings: [], rev: saved.rev };
  });
}
export type SetDaySheetDobRequest = z.input<typeof DaySheetDobSchema>;

/* ------------------------------------------------------------------------------------------------
 * From the booking dialog and the appointment drawer: a new patient (records' duplicate check), a case, a
 * clinical note for an arrived patient ("Start treatment"); the weekly rota editor
 * ----------------------------------------------------------------------------------------------*/

/** The records services take the member as a RecordsActor; the diary's caller carries the same facts. */
function recordsActorOf(caller: DiaryCaller): RecordsActor {
  return {
    tenantId: caller.tenantId,
    userId: caller.actor.userId ?? "",
    name: caller.member?.name ?? "",
    email: caller.member?.email ?? "",
    can: caller.can,
    actor: caller.actor,
    repo: () => caller.ctx,
  };
}

const BookingPatientSchema = z.object({
  firstName: z.string().trim().min(1, "Enter the first name").max(80),
  lastName: z.string().trim().min(1, "Enter the last name").max(80),
  /** YYYY-MM-DD (the dialog converts DD/MM/YYYY). */
  dateOfBirth: z.union([z.string().refine(isIsoDate, "Enter the date of birth as DD/MM/YYYY"), z.literal("")]).optional(),
  phoneMobile: z.string().trim().max(40).optional(),
  email: z.string().trim().max(200).optional(),
  reminders: z.boolean().optional(),
  /** "This is a different person" after the possible-duplicates answer. */
  confirmNotDuplicate: z.boolean().optional(),
});
export type RegisterBookingPatientRequest = z.input<typeof BookingPatientSchema>;

/**
 * Registers a new patient from the booking dialog through the records service – which answers possible duplicates
 * (same last name and date of birth, email or phone) instead of creating a second record, unless the member ticked
 * "This is a different person". patients.edit (records checks it again).
 */
export async function registerBookingPatientFor(caller: DiaryCaller, input: unknown): Promise<DiaryActionResult> {
  if (!allowed(caller, "registerBookingPatientAction")) return NOT_ALLOWED;
  const parsed = BookingPatientSchema.safeParse(obj(input));
  if (!parsed.success) return invalid(parsed.error);
  const d = parsed.data;
  return diaryAction("register_patient", async () => {
    const r = await registerPatientFor(
      recordsActorOf(caller),
      {
        firstName: d.firstName,
        lastName: d.lastName,
        dateOfBirth: d.dateOfBirth || null,
        phoneMobile: d.phoneMobile || null,
        email: d.email || null,
        reminderSms: d.reminders !== false,
        reminderEmail: d.reminders !== false,
      } as PatientInput,
      { confirmNotDuplicate: d.confirmNotDuplicate === true },
    );
    if (!r.ok) return { ok: false, error: r.error, fieldErrors: r.fieldErrors };
    if (r.value.kind === "possible_duplicates") {
      return {
        ok: false,
        error: "This patient may already be registered. Choose them under “Find existing”, or tick “This is a different person”.",
        clashes: r.value.duplicates.map((x) => `${patientDisplayName(x.patient)} (No. ${x.patient.patientNumber}${x.patient.dateOfBirth ? `, born ${formatUkDate(x.patient.dateOfBirth)}` : ""}) – ${x.reasons.map((reason) => DUPLICATE_REASON_LABELS[reason].toLowerCase()).join(", ")}`),
        duplicates: r.value.duplicates.map((x) => ({ id: x.patient.id, name: patientDisplayName(x.patient), number: x.patient.patientNumber })),
      };
    }
    const p = r.value.patient;
    return { ok: true, message: `${patientDisplayName(p)} registered (No. ${p.patientNumber}).`, warnings: [], itemId: p.id };
  });
}

const BookingCaseSchema = z.object({
  patientId: PmsIdSchema,
  title: z.string().trim().min(1).max(120),
  openedOn: z.string().refine(isIsoDate, "A date as YYYY-MM-DD"),
  payerType: z.enum(PAYER_TYPES),
  payerReferrerId: z.preprocess((v) => (v === "" ? null : v), z.union([PmsIdSchema, z.null()]).optional()),
  practitionerId: z.preprocess((v) => (v === "" ? null : v), z.union([PmsIdSchema, z.null()]).optional()),
  siteId: z.preprocess((v) => (v === "" ? null : v), z.union([PmsIdSchema, z.null()]).optional()),
});
export type OpenBookingCaseRequest = z.input<typeof BookingCaseSchema>;

/** Opens a case for the booking ("New case" with its payer) through the records service. patients.edit. */
export async function openBookingCaseFor(caller: DiaryCaller, input: unknown): Promise<DiaryActionResult> {
  if (!allowed(caller, "openBookingCaseAction")) return NOT_ALLOWED;
  const parsed = BookingCaseSchema.safeParse(obj(input));
  if (!parsed.success) return invalid(parsed.error);
  const { patientId, ...rest } = parsed.data;
  if (rest.siteId && !inScope(caller, rest.siteId)) return NOT_YOUR_SITE;
  return diaryAction("open_case", async () => {
    const r = await openCaseFor(recordsActorOf(caller), patientId, rest);
    if (!r.ok) return { ok: false, error: r.error, fieldErrors: r.fieldErrors };
    return { ok: true, message: "Case opened.", warnings: [], itemId: r.value.id };
  });
}

const StartTreatmentSchema = z.object({ id: PmsIdSchema });

/**
 * "Start treatment" for an arrived patient: starts the clinician's clinical note for this appointment (the clinic's
 * first note template, linked to the appointment and its case) and answers the note's id – the drawer opens it.
 * clinical.edit (the records service checks it again). The diary has no "in treatment" status of its own.
 */
export async function startTreatmentFor(caller: DiaryCaller, input: unknown): Promise<DiaryActionResult> {
  if (!allowed(caller, "startTreatmentAction")) return NOT_ALLOWED;
  const parsed = StartTreatmentSchema.safeParse(obj(input));
  if (!parsed.success) return { ok: false, error: DIARY_COPY.notFound, conflict: true };
  return diaryAction("start_treatment", async () => {
    const item = await scopedItem(caller, parsed.data.id);
    if (!item || item.kind !== "appointment" || !item.patientId) return GONE;
    if (item.status !== "arrived") return { ok: false, error: "Mark the patient as arrived first." };
    const actor = recordsActorOf(caller);
    const templates = await templatesForNewNote(actor);
    if (!templates.ok) return { ok: false, error: templates.error };
    const template = templates.value[0];
    if (!template) return { ok: false, error: "The clinic has no note templates yet. Add one in the clinic's set-up first." };
    const note = await startNoteFor(actor, item.patientId, { templateId: template.id, seenOn: item.startsOn, caseId: item.caseId, appointmentId: item.id });
    if (!note.ok) return { ok: false, error: note.error };
    return { ok: true, message: "Treatment started – the note is open.", warnings: [], itemId: note.value.id };
  });
}

const RotaDaySchema = z.object({
  weekday: z.number().int().min(1).max(7),
  working: z.boolean(),
  siteId: z.preprocess((v) => (v === "" ? null : v), z.union([PmsIdSchema, z.null()]).optional()),
  roomId: z.preprocess((v) => (v === "" ? null : v), z.union([PmsIdSchema, z.null()]).optional()),
  start: z.string().optional(),
  end: z.string().optional(),
  breakStart: z.string().optional(),
  breakEnd: z.string().optional(),
});
const WeeklyRotaSchema = z.object({
  practitionerId: PmsIdSchema,
  from: z.string().refine(isIsoDate, "Enter the first day as DD/MM/YYYY"),
  days: z.array(RotaDaySchema).max(7),
});
export type SaveWeeklyRotaRequest = z.input<typeof WeeklyRotaSchema>;

/** A day's working pattern as rota segments (a break splits the day in two). Null = not valid (message). */
function segmentsOf(day: z.infer<typeof RotaDaySchema>): { segments: { start: number; end: number }[] } | { error: string } {
  if (!day.working) return { segments: [] };
  const start = parseHhmm(day.start ?? "");
  const end = day.end?.trim() === "24:00" ? 1440 : parseHhmm(day.end ?? "");
  if (start === null || end === null || end <= start) return { error: `${weekdayName(day.weekday)}: the end must be after the start (HH:MM).` };
  const bs = day.breakStart?.trim() ? parseHhmm(day.breakStart) : null;
  const be = day.breakEnd?.trim() ? parseHhmm(day.breakEnd) : null;
  if ((bs === null) !== (be === null)) return { error: `${weekdayName(day.weekday)}: give the break a start and an end, or leave both empty.` };
  if (bs !== null && be !== null) {
    if (!(start < bs && bs < be && be < end)) return { error: `${weekdayName(day.weekday)}: the break must sit inside the working hours.` };
    return { segments: [{ start, end: bs }, { start: be, end }] };
  }
  return { segments: [{ start, end }] };
}

/**
 * Saves a practitioner's weekly pattern from a date (the rota editor's "Save rota"): for every weekday whose
 * pattern changed, the entries in force end the day before and new entries (one per segment around the break)
 * start on that date – earlier weeks and their bookings stay as they were. Days left unchanged are not touched.
 * Not one atomic write: each step is its own audited change, and a failure stops with what was saved so far.
 */
export async function saveWeeklyRotaFor(caller: DiaryCaller, input: unknown): Promise<DiaryActionResult> {
  if (!allowed(caller, "saveWeeklyRotaAction")) return NOT_ALLOWED;
  const parsed = WeeklyRotaSchema.safeParse(obj(input));
  if (!parsed.success) return invalid(parsed.error);
  const { practitionerId, from, days } = parsed.data;
  for (const day of days) if (day.working && day.siteId && !inScope(caller, day.siteId)) return NOT_YOUR_SITE;
  const plans: { day: z.infer<typeof RotaDaySchema>; segments: { start: number; end: number }[] }[] = [];
  for (const day of days) {
    const r = segmentsOf(day);
    if ("error" in r) return { ok: false, error: r.error };
    if (day.working && !day.siteId) return { ok: false, error: `${weekdayName(day.weekday)}: choose the site.` };
    plans.push({ day, segments: r.segments });
  }
  return diaryAction("rota_week", async () => {
    const current = (await listAvailability(caller.ctx, caller.tenantId, { practitionerId, today: from })).filter((r) => inScope(caller, r.siteId));
    let changedDays = 0;
    for (const { day, segments } of plans) {
      const mine = current.filter((r) => r.weekday === day.weekday);
      const now = mine.map((r) => `${r.siteId}|${r.roomId ?? ""}|${r.startMinute}|${r.endMinute}|${r.everyWeeks}`).sort();
      const wanted = segments.map((s) => `${day.siteId}|${day.roomId ?? ""}|${s.start}|${s.end}|1`).sort();
      if (now.join(";") === wanted.join(";")) continue;
      changedDays += 1;
      for (const r of mine) {
        const ended = await endAvailability(caller.ctx, caller.tenantId, r.id, r.rev, addDays(from, -1), caller.actor);
        if (!ended.ok) return { ok: false, error: DIARY_COPY.changedElsewhere, conflict: true };
      }
      for (const s of segments) {
        await createAvailability(
          caller.ctx,
          caller.tenantId,
          { practitionerId, siteId: day.siteId as string, roomId: day.roomId ?? null, weekday: day.weekday, startTime: formatHhmm(s.start), endTime: s.end === 1440 ? "24:00" : formatHhmm(s.end), everyWeeks: 1, validFrom: from },
          caller.actor,
        );
      }
    }
    return { ok: true, message: changedDays === 0 ? "Nothing changed." : `Rota saved from ${formatUkDate(from)} (${changedDays} ${changedDays === 1 ? "day" : "days"} changed).`, warnings: [] };
  });
}
