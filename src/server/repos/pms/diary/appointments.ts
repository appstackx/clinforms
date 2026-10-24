/**
 * `pms_appointments` (+ `pms_appointment_series`) – the diary: appointments and blocked time.
 *
 * - No double booking: a practitioner or a room is never in two occupying items at once. The repositories check
 *   first (to say what is in the way), the database refuses it anyway (migration 0110's triggers – also for
 *   writes racing each other); a refused write comes back as { reason: "clash" }. One patient is not booked into
 *   two places at once either (checked here).
 * - Concurrent edits: every change carries the revision the screen showed (expectedRev); a stale one gets
 *   { reason: "conflict" } and changes nothing.
 * - Times: forms give a UK date and "HH:MM"; the rows hold UTC instants (Europe/London incl. clock changes).
 * - Never deleted (clinical record): cancelled, late-cancelled (with the fee flag for billing) or, for blocked
 *   time, removed (status cancelled). Every write is audited (ids, counts and field names only).
 * - Booking notes and cancellation notes are encrypted (notes_enc, cancel_note_enc); lists never decrypt.
 * - Attended appointments move the patient's "last seen" forward and count one session against the linked
 *   treatment authorisation (given back if the status is undone). Both steps fail safe: a crash between them can
 *   leave one session too many counted (visible in the audit trail), never one too few.
 */
import { DIARY_COPY, STATUS_LABELS } from "../../../../modules/pms/diary/copy";
import { DIARY_ID_PREFIXES as P } from "../../../../modules/pms/diary/ids";
import {
  MAX_APPOINTMENT_MINUTES,
  canChangeStatus,
  canMove,
  findClashes,
  isCancelledStatus,
  recurringDates,
  withinWorkingHours,
  CANCEL_REASONS,
  type AppointmentStatus,
  type CancelReason,
  type DiaryClash,
} from "../../../../modules/pms/diary/rules";
import {
  AppointmentDetailsPatchSchema,
  AppointmentStatusChangeSchema,
  BlockInputSchema,
  BookAppointmentSchema,
  BulkDiaryItemSchema,
  MoveAppointmentSchema,
  endMinuteOf,
  type AppointmentDetailsPatch,
  type AppointmentStatusChange,
  type BlockInput,
  type BookAppointmentInput,
  type BulkDiaryItem,
  type MoveAppointmentInput,
} from "../../../../modules/pms/diary/schemas";
import { addMinutesIso, londonDate, londonParts, londonToUtc, minutesBetween, parseHhmm } from "../../../../modules/pms/diary/time";
import type { Appointment, BookResult, DiaryItem, DiarySaveResult, DiaryWarning } from "../../../../modules/pms/diary/types";
import type { PmsActor } from "../../../../modules/pms/core/types";
import { isIsoDate } from "../../../../modules/pms/core/text";
import { runBatch, type BatchQuery } from "../../../db/batch";
import { recordAuthorisationUsage } from "../cases";
import { touchPatientLastSeen } from "../patients";
import {
  RepoInputError,
  assertId,
  assertTenantId,
  b01,
  decryptField,
  encryptField,
  isOn,
  nowIso,
  num,
  parseInput,
  pmsAudit,
  pmsAuditQuery,
  pmsId,
  translateDbError,
  type DbContext,
  type RepoContext,
} from "../context";
import { availabilityWindows } from "./availability";
import {
  APPOINTMENTS as T,
  ITEM_COLUMNS,
  LOOK_BACK_MS,
  isClashError,
  loadAuthorisationRef,
  loadCaseRef,
  loadPatientRef,
  loadPractitionerRef,
  loadRoomRef,
  loadServiceRef,
  loadSiteRef,
  occupyingNear,
  pendingAuthorisationBookings,
  toItem,
  type AppointmentRow,
} from "./shared";

const MESSAGES = {
  foreignKey: "A linked record (patient, case, practitioner, room, site or appointment type) does not exist in this clinic.",
  unique: "An appointment with this import reference already exists.",
  check: "A value is outside what the diary allows.",
};

function toAppointment(ctx: RepoContext, r: AppointmentRow): Appointment {
  return {
    ...toItem(r),
    notes: decryptField(ctx, r.tenant_id, T, "notes_enc", r.id, r.notes_enc),
    cancelNote: decryptField(ctx, r.tenant_id, T, "cancel_note_enc", r.id, r.cancel_note_enc),
    cancelledAt: r.cancelled_at,
    cancelledBy: r.cancelled_by,
    statusAt: r.status_at,
    statusBy: r.status_by,
    importRef: r.import_ref,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

function localStart(date: string, startTime: string): string {
  const minute = parseHhmm(startTime);
  if (minute === null) throw new RepoInputError("Enter a time as HH:MM (24-hour clock).");
  const r = londonToUtc(date, minute);
  if (!r.ok) throw new RepoInputError(DIARY_COPY.gap);
  return r.iso;
}

async function currentRow(ctx: DbContext, tenantId: string, id: string): Promise<AppointmentRow | undefined> {
  return ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
}

async function itemById(ctx: DbContext, tenantId: string, id: string): Promise<DiaryItem> {
  const row = await ctx.db.selectFrom(T).select(ITEM_COLUMNS).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirstOrThrow();
  return toItem(row);
}

async function staleResult(ctx: DbContext, tenantId: string, id: string): Promise<DiarySaveResult> {
  const now = await ctx.db.selectFrom(T).select("rev").where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return now ? { ok: false, reason: "conflict", currentRev: num(now.rev) } : { ok: false, reason: "not_found" };
}

/** Whether every span is inside the practitioner's rota (false = book anyway, but warn). */
async function insideWorkingHours(ctx: DbContext, tenantId: string, practitionerId: string, spans: { startsAt: string; endsAt: string }[]): Promise<boolean> {
  const dates = Array.from(new Set(spans.map((s) => londonDate(s.startsAt))));
  const windows = await availabilityWindows(ctx, tenantId, dates, { practitionerIds: [practitionerId] });
  return spans.every((s) => {
    const date = londonDate(s.startsAt);
    const start = londonParts(s.startsAt).minute;
    return withinWorkingHours(windows, practitionerId, date, start, start + minutesBetween(s.startsAt, s.endsAt));
  });
}

/* ------------------------------------------------------------------------------------------------
 * Booking
 * ----------------------------------------------------------------------------------------------*/

export interface BookOptions {
  /** Book the free dates of a recurring booking and report the others (default: all or nothing). */
  skipClashes?: boolean;
  /** Book although the patient has another appointment at the same time (two practitioners seeing them together). */
  allowPatientOverlap?: boolean;
  /** The waiting-list entry this booking settles (marked booked in the same atomic write). */
  waitingListId?: string;
}

/** Books an appointment – or a recurring series (weekly, fortnightly…) – for a patient. */
export async function bookAppointment(ctx: RepoContext, tenantId: string, input: BookAppointmentInput, actor: PmsActor, options: BookOptions = {}): Promise<BookResult> {
  assertTenantId(tenantId);
  const d = parseInput(BookAppointmentSchema, input, "Appointment");
  if (options.waitingListId !== undefined) assertId(options.waitingListId, "waiting-list id");
  const [, service] = await Promise.all([
    loadPatientRef(ctx, tenantId, d.patientId),
    loadServiceRef(ctx, tenantId, d.serviceId),
    loadPractitionerRef(ctx, tenantId, d.practitionerId),
    loadSiteRef(ctx, tenantId, d.siteId),
  ]);
  if (d.roomId) await loadRoomRef(ctx, tenantId, d.roomId, d.siteId);
  if (d.caseId) await loadCaseRef(ctx, tenantId, d.caseId, d.patientId);
  const authorisation = d.authorisationId && d.caseId ? await loadAuthorisationRef(ctx, tenantId, d.authorisationId, d.caseId) : null;
  const duration = d.durationMinutes ?? service.durationMinutes;
  if (duration > MAX_APPOINTMENT_MINUTES) throw new RepoInputError(`Appointment: at most ${MAX_APPOINTMENT_MINUTES} minutes.`);

  const dates = d.repeat ? recurringDates(d.date, d.repeat.intervalWeeks, d.repeat.occurrences) : [d.date];
  const spans = dates.map((date) => {
    const startsAt = localStart(date, d.startTime);
    return { date, startsAt, endsAt: addMinutesIso(startsAt, duration) };
  });

  const clashesFor = async (wanted: typeof spans) => {
    const nearby = await occupyingNear(ctx, tenantId, { spans: wanted, practitionerId: d.practitionerId, roomId: d.roomId ?? null, patientId: d.patientId });
    return wanted.flatMap((s) =>
      findClashes({ ...s, practitionerId: d.practitionerId, roomId: d.roomId ?? null, patientId: options.allowPatientOverlap ? null : d.patientId }, nearby).map((c) => ({ ...c, date: s.date })),
    );
  };
  const clashes = await clashesFor(spans);
  let free = spans;
  if (clashes.length > 0) {
    if (!options.skipClashes) return { ok: false, reason: "clash", clashes };
    const taken = new Set(clashes.map((c) => c.date));
    free = spans.filter((s) => !taken.has(s.date));
    if (free.length === 0) return { ok: false, reason: "clash", clashes };
  }

  const at = nowIso(ctx);
  const seriesId = d.repeat ? pmsId(P.series, ctx) : null;
  const rows = free.map((s) => {
    const id = pmsId(P.appointment, ctx);
    return {
      tenant_id: tenantId,
      id,
      rev: 1,
      kind: "appointment",
      site_id: d.siteId,
      practitioner_id: d.practitionerId,
      room_id: d.roomId ?? null,
      patient_id: d.patientId,
      case_id: d.caseId ?? null,
      service_id: d.serviceId,
      authorisation_id: d.authorisationId ?? null,
      series_id: seriesId,
      starts_at: s.startsAt,
      ends_at: s.endsAt,
      starts_on: s.date,
      status: "booked",
      block_kind: null,
      title: null,
      notes_enc: encryptField(ctx, tenantId, T, "notes_enc", id, d.notes),
      source: d.source ?? "staff",
      fee_due: 0,
      fee_pence: null,
      auth_session_used: 0,
      cancel_reason: null,
      cancel_note_enc: null,
      cancelled_at: null,
      cancelled_by: null,
      status_at: null,
      status_by: null,
      import_ref: null,
      created_by: actor.userId,
      created_at: at,
      updated_at: at,
    };
  });
  const queries: BatchQuery[] = [];
  if (seriesId && d.repeat) {
    queries.push(ctx.db.insertInto("pms_appointment_series").values({ tenant_id: tenantId, id: seriesId, interval_weeks: d.repeat.intervalWeeks, occurrences: rows.length, created_by: actor.userId, created_at: at }));
  }
  queries.push(...rows.map((row) => ctx.db.insertInto(T).values(row)));
  if (options.waitingListId) {
    queries.push(
      ctx.db
        .updateTable("pms_waiting_list")
        .set((eb) => ({ status: "booked", booked_appointment_id: rows[0].id, rev: eb("rev", "+", 1), updated_at: at }))
        .where("tenant_id", "=", tenantId)
        .where("id", "=", options.waitingListId)
        .where("patient_id", "=", d.patientId)
        .where("status", "in", ["waiting", "offered"]),
    );
  }
  queries.push(
    pmsAuditQuery(ctx, tenantId, actor, {
      action: "pms.appointment.book",
      targetType: "pms_appointment",
      targetId: rows[0].id,
      detail: {
        count: rows.length,
        ...(seriesId ? { seriesId, skipped: spans.length - rows.length } : {}),
        source: d.source ?? "staff",
        ...(options.waitingListId ? { waitingListId: options.waitingListId } : {}),
      },
    }),
  );
  try {
    await runBatch(ctx.db, queries);
  } catch (err) {
    if (isClashError(err)) {
      const now = await clashesFor(free);
      if (now.length > 0) return { ok: false, reason: "clash", clashes: now };
      throw new RepoInputError("That time was taken a moment ago. Refresh the diary and try again.");
    }
    throw translateDbError(err, MESSAGES);
  }

  const warnings: DiaryWarning[] = [];
  if (!(await insideWorkingHours(ctx, tenantId, d.practitionerId, free))) warnings.push("outside_hours");
  if (authorisation && authorisation.sessionsAuthorised !== null) {
    const pending = await pendingAuthorisationBookings(ctx, tenantId, authorisation.id);
    if (authorisation.sessionsUsed + pending > authorisation.sessionsAuthorised) warnings.push("authorisation_short");
  }
  const items = await listByIds(ctx, tenantId, rows.map((r) => r.id));
  return { ok: true, items, seriesId, skippedDates: spans.filter((s) => !free.includes(s)).map((s) => s.date), warnings };
}

/* ------------------------------------------------------------------------------------------------
 * Blocked time
 * ----------------------------------------------------------------------------------------------*/

export type BlockResult = { ok: true; item: DiaryItem } | { ok: false; reason: "clash"; clashes: DiaryClash[] };

/** Blocks time for a practitioner (leave, a meeting) or a room (out of use). Nothing can be booked over it. */
export async function createBlock(ctx: RepoContext, tenantId: string, input: BlockInput, actor: PmsActor): Promise<BlockResult> {
  assertTenantId(tenantId);
  const d = parseInput(BlockInputSchema, input, "Blocked time");
  await loadSiteRef(ctx, tenantId, d.siteId);
  if (d.practitionerId) await loadPractitionerRef(ctx, tenantId, d.practitionerId);
  if (d.roomId) await loadRoomRef(ctx, tenantId, d.roomId, d.siteId);
  const startsAt = localStart(d.date, d.startTime);
  const end = londonToUtc(d.date, endMinuteOf(d.endTime));
  if (!end.ok) throw new RepoInputError(DIARY_COPY.gap);
  const span = { startsAt, endsAt: end.iso };
  const nearby = await occupyingNear(ctx, tenantId, { spans: [span], practitionerId: d.practitionerId ?? null, roomId: d.roomId ?? null });
  const clashes = findClashes({ ...span, practitionerId: d.practitionerId ?? null, roomId: d.roomId ?? null }, nearby);
  if (clashes.length > 0) return { ok: false, reason: "clash", clashes };
  const id = pmsId(P.block, ctx);
  const at = nowIso(ctx);
  try {
    await runBatch(ctx.db, [
      ctx.db.insertInto(T).values({
        tenant_id: tenantId,
        id,
        rev: 1,
        kind: "block",
        site_id: d.siteId,
        practitioner_id: d.practitionerId ?? null,
        room_id: d.roomId ?? null,
        starts_at: span.startsAt,
        ends_at: span.endsAt,
        starts_on: d.date,
        status: "booked",
        block_kind: d.blockKind,
        title: d.title ?? null,
        notes_enc: encryptField(ctx, tenantId, T, "notes_enc", id, d.notes),
        source: "staff",
        created_by: actor.userId,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.block.create", targetType: "pms_appointment", targetId: id, detail: { blockKind: d.blockKind } }),
    ]);
  } catch (err) {
    if (isClashError(err)) {
      const again = findClashes({ ...span, practitionerId: d.practitionerId ?? null, roomId: d.roomId ?? null }, await occupyingNear(ctx, tenantId, { spans: [span], practitionerId: d.practitionerId ?? null, roomId: d.roomId ?? null }));
      return { ok: false, reason: "clash", clashes: again };
    }
    throw translateDbError(err, MESSAGES);
  }
  return { ok: true, item: await itemById(ctx, tenantId, id) };
}

/* ------------------------------------------------------------------------------------------------
 * Moving
 * ----------------------------------------------------------------------------------------------*/

/**
 * Moves an appointment (or blocked time) to another time, day, practitioner, room or site – drag and drop and the
 * keyboard "Move" form both end here. Only booked and arrived items move.
 */
export async function moveAppointment(ctx: RepoContext, tenantId: string, id: string, input: MoveAppointmentInput, actor: PmsActor, options: { allowPatientOverlap?: boolean } = {}): Promise<DiarySaveResult> {
  assertTenantId(tenantId);
  assertId(id, "appointment id");
  const d = parseInput(MoveAppointmentSchema, input, "Move");
  const row = await currentRow(ctx, tenantId, id);
  if (!row) return { ok: false, reason: "not_found" };
  if (num(row.rev) !== d.expectedRev) return { ok: false, reason: "conflict", currentRev: num(row.rev) };
  const status = row.status as AppointmentStatus;
  if (!canMove(status)) {
    throw new RepoInputError(isCancelledStatus(status) ? "Reinstate the cancelled appointment before moving it." : `An appointment marked "${STATUS_LABELS[status]}" cannot be moved.`);
  }
  const siteId = d.siteId ?? row.site_id;
  const practitionerId = d.practitionerId === undefined ? row.practitioner_id : d.practitionerId;
  const roomId = d.roomId !== undefined ? d.roomId : siteId !== row.site_id ? null : row.room_id;
  if (row.kind === "appointment" && !practitionerId) throw new RepoInputError("An appointment needs a practitioner.");
  if (!practitionerId && !roomId) throw new RepoInputError("Choose a practitioner or a room.");
  if (siteId !== row.site_id) await loadSiteRef(ctx, tenantId, siteId);
  if (practitionerId && practitionerId !== row.practitioner_id) await loadPractitionerRef(ctx, tenantId, practitionerId);
  if (roomId && (roomId !== row.room_id || siteId !== row.site_id)) await loadRoomRef(ctx, tenantId, roomId, siteId);
  const duration = d.durationMinutes ?? minutesBetween(row.starts_at, row.ends_at);
  if (row.kind === "appointment" && duration > MAX_APPOINTMENT_MINUTES) throw new RepoInputError(`Appointment: at most ${MAX_APPOINTMENT_MINUTES} minutes.`);
  const startsAt = localStart(d.date, d.startTime);
  const endsAt = addMinutesIso(startsAt, duration);
  const fields = [
    startsAt !== row.starts_at ? "startsAt" : null,
    endsAt !== row.ends_at ? "endsAt" : null,
    practitionerId !== row.practitioner_id ? "practitionerId" : null,
    roomId !== row.room_id ? "roomId" : null,
    siteId !== row.site_id ? "siteId" : null,
  ].filter((f): f is string => f !== null);
  if (fields.length === 0) return { ok: true, item: toItem(row), warnings: [] };

  const span = { startsAt, endsAt };
  const check = async () =>
    findClashes(
      { id, ...span, practitionerId, roomId, patientId: options.allowPatientOverlap || row.kind === "block" ? null : row.patient_id },
      await occupyingNear(ctx, tenantId, { spans: [span], practitionerId, roomId, patientId: row.kind === "appointment" ? row.patient_id : null, excludeId: id }),
    );
  const clashes = await check();
  if (clashes.length > 0) return { ok: false, reason: "clash", clashes };
  const at = nowIso(ctx);
  let updated: number;
  try {
    const result = await ctx.db
      .updateTable(T)
      .set({ starts_at: startsAt, ends_at: endsAt, starts_on: d.date, site_id: siteId, practitioner_id: practitionerId, room_id: roomId, rev: d.expectedRev + 1, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("rev", "=", d.expectedRev)
      .where("status", "in", ["booked", "arrived"])
      .executeTakeFirst();
    updated = Number(result.numUpdatedRows);
  } catch (err) {
    if (isClashError(err)) return { ok: false, reason: "clash", clashes: await check() };
    throw translateDbError(err, MESSAGES);
  }
  if (updated === 0) return staleResult(ctx, tenantId, id);
  if (row.kind === "block") {
    await pmsAudit(ctx, tenantId, actor, { action: "pms.block.move", targetType: "pms_appointment", targetId: id, detail: { fields, rev: d.expectedRev + 1 } });
  } else {
    await pmsAudit(ctx, tenantId, actor, { action: "pms.appointment.move", targetType: "pms_appointment", targetId: id, detail: { fields, rev: d.expectedRev + 1 } });
  }
  const warnings: DiaryWarning[] = [];
  if (row.kind === "appointment" && practitionerId && !(await insideWorkingHours(ctx, tenantId, practitionerId, [span]))) warnings.push("outside_hours");
  return { ok: true, item: await itemById(ctx, tenantId, id), warnings };
}

/* ------------------------------------------------------------------------------------------------
 * Status: arrived, attended, did not attend, cancelled, late cancellation, reinstated
 * ----------------------------------------------------------------------------------------------*/

async function auditStatus(ctx: DbContext, tenantId: string, actor: PmsActor, id: string, kind: string, from: string, to: AppointmentStatus, detail: Record<string, unknown>): Promise<void> {
  const base = { targetType: "pms_appointment", targetId: id, detail: { from, to, ...detail } };
  if (kind === "block") {
    if (to === "cancelled") await pmsAudit(ctx, tenantId, actor, { action: "pms.block.remove", ...base });
    else await pmsAudit(ctx, tenantId, actor, { action: "pms.block.restore", ...base });
    return;
  }
  switch (to) {
    case "arrived":
      return pmsAudit(ctx, tenantId, actor, { action: "pms.appointment.arrive", ...base });
    case "attended":
      return pmsAudit(ctx, tenantId, actor, { action: "pms.appointment.attend", ...base });
    case "dna":
      return pmsAudit(ctx, tenantId, actor, { action: "pms.appointment.dna", ...base });
    case "cancelled":
      return pmsAudit(ctx, tenantId, actor, { action: "pms.appointment.cancel", ...base });
    case "late_cancelled":
      return pmsAudit(ctx, tenantId, actor, { action: "pms.appointment.late_cancel", ...base });
    default:
      if (isCancelledStatus(from)) return pmsAudit(ctx, tenantId, actor, { action: "pms.appointment.reinstate", ...base });
      return pmsAudit(ctx, tenantId, actor, { action: "pms.appointment.status_undo", ...base });
  }
}

/** Changes an appointment's status (or removes / restores blocked time), with the revision the screen showed. */
export async function setAppointmentStatus(ctx: RepoContext, tenantId: string, id: string, change: AppointmentStatusChange, actor: PmsActor): Promise<DiarySaveResult> {
  assertTenantId(tenantId);
  assertId(id, "appointment id");
  const d = parseInput(AppointmentStatusChangeSchema, change, "Status");
  const row = await currentRow(ctx, tenantId, id);
  if (!row) return { ok: false, reason: "not_found" };
  if (num(row.rev) !== d.expectedRev) return { ok: false, reason: "conflict", currentRev: num(row.rev) };
  const from = row.status as AppointmentStatus;
  const to = d.status;
  const kind = row.kind === "block" ? "block" : "appointment";
  if (!canChangeStatus(kind, from, to)) {
    throw new RepoInputError(kind === "block" ? "Blocked time can only be removed or restored." : `An appointment marked "${STATUS_LABELS[from]}" cannot be changed to "${STATUS_LABELS[to]}".`);
  }
  const at = nowIso(ctx);
  const set: Record<string, unknown> = { status: to, status_at: at, status_by: actor.userId, rev: d.expectedRev + 1, updated_at: at };
  if (isCancelledStatus(to)) {
    set.cancelled_at = at;
    set.cancelled_by = actor.userId;
    set.cancel_reason = kind === "block" ? null : (d.cancelReason ?? "patient");
    set.cancel_note_enc = encryptField(ctx, tenantId, T, "cancel_note_enc", id, d.cancelNote);
    set.fee_due = to === "late_cancelled" ? b01(d.feeDue ?? true) : 0;
    set.fee_pence = to === "late_cancelled" ? (d.feePence ?? null) : null;
  } else {
    set.cancelled_at = null;
    set.cancelled_by = null;
    set.cancel_reason = null;
    set.cancel_note_enc = null;
    set.fee_due = to === "dna" ? b01(d.feeDue ?? false) : 0;
    set.fee_pence = to === "dna" ? (d.feePence ?? null) : null;
  }

  const warnings: DiaryWarning[] = [];
  // Treatment authorisation: one session per attended appointment (counted first, so it can never be skipped).
  let counted = false;
  if (to === "attended" && row.authorisation_id && !isOn(row.auth_session_used)) {
    const usage = await recordAuthorisationUsage(ctx, tenantId, row.authorisation_id, { sessions: 1 }, actor, id);
    if (usage.ok) {
      counted = true;
      set.auth_session_used = 1;
    } else {
      warnings.push("authorisation_used_up");
    }
  }
  const giveBack = from === "attended" && to !== "attended" && isOn(row.auth_session_used) && row.authorisation_id;
  if (giveBack) set.auth_session_used = 0;

  const undoCount = async () => {
    if (counted && row.authorisation_id) await recordAuthorisationUsage(ctx, tenantId, row.authorisation_id, { sessions: -1 }, actor, id);
  };
  let updated: number;
  try {
    const result = await ctx.db.updateTable(T).set(set).where("tenant_id", "=", tenantId).where("id", "=", id).where("rev", "=", d.expectedRev).where("status", "=", from).executeTakeFirst();
    updated = Number(result.numUpdatedRows);
  } catch (err) {
    await undoCount();
    if (isClashError(err)) {
      const span = { startsAt: row.starts_at, endsAt: row.ends_at };
      const clashes = findClashes(
        { id, ...span, practitionerId: row.practitioner_id, roomId: row.room_id },
        await occupyingNear(ctx, tenantId, { spans: [span], practitionerId: row.practitioner_id, roomId: row.room_id, excludeId: id }),
      );
      return { ok: false, reason: "clash", clashes };
    }
    throw translateDbError(err, MESSAGES);
  }
  if (updated === 0) {
    await undoCount();
    return staleResult(ctx, tenantId, id);
  }
  if (giveBack && row.authorisation_id) await recordAuthorisationUsage(ctx, tenantId, row.authorisation_id, { sessions: -1 }, actor, id);
  if (to === "attended" && row.patient_id) await touchPatientLastSeen(ctx, tenantId, row.patient_id, row.starts_on);
  await auditStatus(ctx, tenantId, actor, id, kind, from, to, { rev: d.expectedRev + 1, ...(set.fee_due === 1 ? { feeDue: true } : {}), ...(isCancelledStatus(to) && kind === "appointment" ? { reason: set.cancel_reason } : {}) });
  return { ok: true, item: await itemById(ctx, tenantId, id), warnings };
}

/** Cancels the booked appointments of a series from a date on (the rest of a course of treatment). */
export async function cancelSeriesFrom(ctx: DbContext, tenantId: string, seriesId: string, fromDate: string, actor: PmsActor, reason: CancelReason = "patient"): Promise<number> {
  assertTenantId(tenantId);
  assertId(seriesId, "series id");
  if (!isIsoDate(fromDate)) throw new RepoInputError("Enter the date as YYYY-MM-DD.");
  if (!(CANCEL_REASONS as readonly string[]).includes(reason)) throw new RepoInputError("Unknown cancellation reason.");
  const at = nowIso(ctx);
  const result = await ctx.db
    .updateTable(T)
    .set((eb) => ({ status: "cancelled", cancelled_at: at, cancelled_by: actor.userId, cancel_reason: reason, status_at: at, status_by: actor.userId, rev: eb("rev", "+", 1), updated_at: at }))
    .where("tenant_id", "=", tenantId)
    .where("series_id", "=", seriesId)
    .where("status", "=", "booked")
    .where("starts_on", ">=", fromDate)
    .executeTakeFirst();
  const count = Number(result.numUpdatedRows);
  if (count > 0) await pmsAudit(ctx, tenantId, actor, { action: "pms.appointment.cancel_series", targetType: "pms_appointment_series", targetId: seriesId, detail: { count, reason } });
  return count;
}

/* ------------------------------------------------------------------------------------------------
 * Details: booking note, case, authorisation, appointment type
 * ----------------------------------------------------------------------------------------------*/

export async function updateAppointmentDetails(ctx: RepoContext, tenantId: string, id: string, expectedRev: number, patch: AppointmentDetailsPatch, actor: PmsActor): Promise<DiarySaveResult> {
  assertTenantId(tenantId);
  assertId(id, "appointment id");
  if (!Number.isInteger(expectedRev) || expectedRev < 1) throw new RepoInputError("expectedRev must be a positive whole number.");
  const d = parseInput(AppointmentDetailsPatchSchema, patch, "Appointment");
  const row = await currentRow(ctx, tenantId, id);
  if (!row) return { ok: false, reason: "not_found" };
  if (num(row.rev) !== expectedRev) return { ok: false, reason: "conflict", currentRev: num(row.rev) };
  const set: Record<string, unknown> = {};
  const fields: string[] = [];
  if (d.notes !== undefined) {
    set.notes_enc = encryptField(ctx, tenantId, T, "notes_enc", id, d.notes);
    fields.push("notes");
  }
  if (row.kind === "block") {
    if (d.caseId !== undefined || d.authorisationId !== undefined || d.serviceId !== undefined) throw new RepoInputError("Blocked time has no patient, case or appointment type.");
  } else {
    const caseId = d.caseId === undefined ? row.case_id : d.caseId;
    let authorisationId = d.authorisationId === undefined ? row.authorisation_id : d.authorisationId;
    if (d.caseId !== undefined && d.caseId !== row.case_id) {
      if (caseId) await loadCaseRef(ctx, tenantId, caseId, row.patient_id as string);
      if (d.authorisationId === undefined) authorisationId = null; // the old authorisation belonged to the old case
      set.case_id = caseId;
      fields.push("caseId");
    }
    if (authorisationId !== row.authorisation_id) {
      if (isOn(row.auth_session_used)) throw new RepoInputError("A session of this appointment has been counted against its authorisation. Mark it as booked again before changing the authorisation.");
      if (authorisationId) {
        if (!caseId) throw new RepoInputError("Choose the case the authorisation belongs to.");
        await loadAuthorisationRef(ctx, tenantId, authorisationId, caseId);
      }
      set.authorisation_id = authorisationId;
      fields.push("authorisationId");
    }
    if (d.serviceId !== undefined && d.serviceId !== row.service_id) {
      await loadServiceRef(ctx, tenantId, d.serviceId);
      set.service_id = d.serviceId;
      fields.push("serviceId");
    }
  }
  if (fields.length === 0) return { ok: true, item: toItem(row), warnings: [] };
  const at = nowIso(ctx);
  let updated: number;
  try {
    const result = await ctx.db
      .updateTable(T)
      .set({ ...set, rev: expectedRev + 1, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("rev", "=", expectedRev)
      .executeTakeFirst();
    updated = Number(result.numUpdatedRows);
  } catch (err) {
    throw translateDbError(err, MESSAGES);
  }
  if (updated === 0) return staleResult(ctx, tenantId, id);
  await pmsAudit(ctx, tenantId, actor, { action: "pms.appointment.update", targetType: "pms_appointment", targetId: id, detail: { fields, rev: expectedRev + 1 } });
  return { ok: true, item: await itemById(ctx, tenantId, id), warnings: [] };
}

/* ------------------------------------------------------------------------------------------------
 * Reads
 * ----------------------------------------------------------------------------------------------*/

/** One item, booking and cancellation notes decrypted. */
export async function getAppointment(ctx: RepoContext, tenantId: string, id: string): Promise<Appointment | null> {
  assertTenantId(tenantId);
  const row = await currentRow(ctx, tenantId, id);
  return row ? toAppointment(ctx, row) : null;
}

/** Items by id (groups of 90). */
export async function listByIds(ctx: DbContext, tenantId: string, ids: readonly string[]): Promise<DiaryItem[]> {
  assertTenantId(tenantId);
  const out: DiaryItem[] = [];
  const unique = Array.from(new Set(ids));
  for (let i = 0; i < unique.length; i += 90) {
    const rows = await ctx.db.selectFrom(T).select(ITEM_COLUMNS).where("tenant_id", "=", tenantId).where("id", "in", unique.slice(i, i + 90)).execute();
    out.push(...rows.map(toItem));
  }
  return out.sort((a, b) => (a.startsAt === b.startsAt ? (a.id < b.id ? -1 : 1) : a.startsAt < b.startsAt ? -1 : 1));
}

export interface DiaryQuery {
  /** [from, to) instants (ISO UTC) – e.g. londonDayRange(date). */
  from: string;
  to: string;
  siteId?: string;
  practitionerIds?: readonly string[];
  roomIds?: readonly string[];
  /** Cancelled and late-cancelled items too (default false). */
  includeCancelled?: boolean;
  /** Default and maximum 500. */
  limit?: number;
}

/** The diary between two instants, by start time (nothing decrypted). `truncated` when more than the limit exist. */
export async function listDiary(ctx: DbContext, tenantId: string, q: DiaryQuery): Promise<{ items: DiaryItem[]; truncated: boolean }> {
  assertTenantId(tenantId);
  const limit = Math.min(500, Math.max(1, Math.floor(q.limit ?? 500)));
  let query = ctx.db
    .selectFrom(T)
    .select(ITEM_COLUMNS)
    .where("tenant_id", "=", tenantId)
    .where("starts_at", "<", q.to)
    .where("ends_at", ">", q.from)
    .where("starts_at", ">", new Date(Date.parse(q.from) - LOOK_BACK_MS).toISOString());
  if (q.siteId) query = query.where("site_id", "=", q.siteId);
  const practitioners = q.practitionerIds ? q.practitionerIds.slice(0, 90) : null;
  const rooms = q.roomIds ? q.roomIds.slice(0, 90) : null;
  if (practitioners && rooms) {
    if (practitioners.length + rooms.length === 0) return { items: [], truncated: false };
    query = query.where((eb) =>
      eb.or([...(practitioners.length ? [eb("practitioner_id", "in", practitioners as string[])] : []), ...(rooms.length ? [eb("room_id", "in", rooms as string[])] : [])]),
    );
  } else if (practitioners) {
    if (practitioners.length === 0) return { items: [], truncated: false };
    query = query.where("practitioner_id", "in", practitioners as string[]);
  } else if (rooms) {
    if (rooms.length === 0) return { items: [], truncated: false };
    query = query.where("room_id", "in", rooms as string[]);
  }
  if (!q.includeCancelled) query = query.where("status", "not in", ["cancelled", "late_cancelled"]);
  const rows = await query.orderBy("starts_at").orderBy("id").limit(limit + 1).execute();
  return { items: rows.slice(0, limit).map(toItem), truncated: rows.length > limit };
}

/** A patient's appointments, newest first (at most 200). */
export async function listPatientAppointments(ctx: DbContext, tenantId: string, patientId: string, options: { limit?: number } = {}): Promise<DiaryItem[]> {
  assertTenantId(tenantId);
  assertId(patientId, "patient id");
  const rows = await ctx.db
    .selectFrom(T)
    .select(ITEM_COLUMNS)
    .where("tenant_id", "=", tenantId)
    .where("patient_id", "=", patientId)
    .orderBy("starts_at", "desc")
    .orderBy("id", "desc")
    .limit(Math.min(200, Math.max(1, options.limit ?? 200)))
    .execute();
  return rows.map(toItem);
}

/** Each patient's next occupying appointment from `fromIso` on (quick search). */
export async function nextAppointmentsFor(ctx: DbContext, tenantId: string, patientIds: readonly string[], fromIso: string): Promise<Map<string, DiaryItem>> {
  assertTenantId(tenantId);
  const out = new Map<string, DiaryItem>();
  const unique = Array.from(new Set(patientIds));
  for (let i = 0; i < unique.length; i += 90) {
    const rows = await ctx.db
      .selectFrom(T)
      .select(ITEM_COLUMNS)
      .where("tenant_id", "=", tenantId)
      .where("patient_id", "in", unique.slice(i, i + 90))
      .where("starts_at", ">=", fromIso)
      .where("status", "in", ["booked", "arrived"])
      .orderBy("starts_at")
      .limit(500)
      .execute();
    for (const r of rows) if (r.patient_id && !out.has(r.patient_id)) out.set(r.patient_id, toItem(r));
  }
  return out;
}

/** Late cancellations and missed appointments with a fee to charge (billing), by date. */
export async function listFeesDue(ctx: DbContext, tenantId: string, range: { fromDate?: string; toDate?: string; limit?: number } = {}): Promise<DiaryItem[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom(T).select(ITEM_COLUMNS).where("tenant_id", "=", tenantId).where("fee_due", "=", 1).where("status", "in", ["late_cancelled", "dna"]);
  if (range.fromDate) q = q.where("starts_on", ">=", range.fromDate);
  if (range.toDate) q = q.where("starts_on", "<=", range.toDate);
  const rows = await q
    .orderBy("starts_on")
    .orderBy("id")
    .limit(Math.min(500, Math.max(1, range.limit ?? 200)))
    .execute();
  return rows.map(toItem);
}

/** Appointments (not blocks) per status between two instants – reports and the overview. */
export async function countAppointmentsByStatus(ctx: DbContext, tenantId: string, q: { from: string; to: string; siteId?: string }): Promise<Record<AppointmentStatus, number>> {
  assertTenantId(tenantId);
  let query = ctx.db
    .selectFrom(T)
    .select(["status", (eb) => eb.fn.countAll<number>().as("n")])
    .where("tenant_id", "=", tenantId)
    .where("kind", "=", "appointment")
    .where("starts_at", ">=", q.from)
    .where("starts_at", "<", q.to);
  if (q.siteId) query = query.where("site_id", "=", q.siteId);
  const rows = await query.groupBy("status").execute();
  const out: Record<AppointmentStatus, number> = { booked: 0, arrived: 0, attended: 0, dna: 0, late_cancelled: 0, cancelled: 0 };
  for (const r of rows) out[r.status as AppointmentStatus] = num(r.n);
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Bulk loads (demo seed, data import)
 * ----------------------------------------------------------------------------------------------*/

/**
 * Diary items with known instants, in batches of 40 + one audit row per batch ("pms.appointment.bulk_create").
 * The clash triggers still apply: a batch holding a clash is refused whole (an import resolves clashes first).
 */
export async function bulkCreateDiaryItems(ctx: RepoContext, tenantId: string, inputs: BulkDiaryItem[], actor: PmsActor, detail: Record<string, unknown> = {}): Promise<string[]> {
  assertTenantId(tenantId);
  const parsed = inputs.map((input, i) => parseInput(BulkDiaryItemSchema, input, `Diary item ${i + 1}`));
  const ids: string[] = [];
  const at = nowIso(ctx);
  for (let i = 0; i < parsed.length; i += 40) {
    const rows = parsed.slice(i, i + 40).map((d) => {
      const id = pmsId(d.kind === "block" ? P.block : P.appointment, ctx);
      ids.push(id);
      const cancelled = isCancelledStatus(d.status);
      return {
        tenant_id: tenantId,
        id,
        rev: 1,
        kind: d.kind,
        site_id: d.siteId,
        practitioner_id: d.practitionerId ?? null,
        room_id: d.roomId ?? null,
        patient_id: d.patientId ?? null,
        case_id: d.caseId ?? null,
        service_id: d.serviceId ?? null,
        authorisation_id: d.authorisationId ?? null,
        series_id: d.seriesId ?? null,
        starts_at: d.startsAt,
        ends_at: d.endsAt,
        starts_on: londonDate(d.startsAt),
        status: d.status,
        block_kind: d.blockKind ?? null,
        title: d.title ?? null,
        notes_enc: encryptField(ctx, tenantId, T, "notes_enc", id, d.notes),
        source: d.source ?? "import",
        fee_due: b01(d.feeDue ?? false),
        fee_pence: null,
        auth_session_used: b01(d.authSessionUsed ?? false),
        cancel_reason: cancelled && d.kind === "appointment" ? (d.cancelReason ?? "patient") : null,
        cancel_note_enc: null,
        cancelled_at: cancelled ? at : null,
        cancelled_by: cancelled ? actor.userId : null,
        status_at: d.status === "booked" ? null : at,
        status_by: d.status === "booked" ? null : actor.userId,
        import_ref: d.importRef ?? null,
        created_by: actor.userId,
        created_at: at,
        updated_at: at,
      };
    });
    try {
      await runBatch(ctx.db, [
        ...rows.map((row) => ctx.db.insertInto(T).values(row)),
        pmsAuditQuery(ctx, tenantId, actor, { action: "pms.appointment.bulk_create", targetType: "pms_appointment", targetId: rows[0].id, detail: { ...detail, count: rows.length } }),
      ]);
    } catch (err) {
      if (isClashError(err)) throw new RepoInputError(`Diary items ${i + 1}–${i + rows.length}: two of them (or one and an existing item) share a practitioner or a room at the same time.`);
      throw translateDbError(err, MESSAGES);
    }
  }
  return ids;
}

