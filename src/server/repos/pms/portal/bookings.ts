/**
 * `pms_online_bookings` – appointments booked online (the public booking page or the patient portal).
 *
 * - No double booking: the database refuses a booked row overlapping another booked row of the same practitioner
 *   (trigger, "pms_online_bookings_overlap") – the insert and its audit row go in ONE atomic batch, so a refused
 *   booking leaves nothing behind; this file turns that refusal into { ok: false, reason: "slot_taken" }.
 * - Moving a booking: ONE batch cancels the old row ("rebooked", revision-checked) and inserts the new one; the
 *   database accepts the new row only if the old one was cancelled as "rebooked" and never moved before.
 * - Cancelling is a revision-checked update; rows are never deleted by the app.
 * - The "manage this booking" link is a random secret the patient holds; only its SHA-256 is stored.
 */
import { randomBytes } from "node:crypto";
import type { Selectable } from "kysely";
import { PORTAL_ID_PREFIXES as P } from "../../../../modules/pms/portal/ids";
import { bookingReference, manageLinkExpiry, type BookingStatus } from "../../../../modules/pms/portal/policy";
import type { CancelReason } from "../../../../modules/pms/portal/schemas";
import { isIsoInstant } from "../../../../modules/pms/portal/time";
import type { BookingChannel, OnlineBooking, PatientMatch } from "../../../../modules/pms/portal/types";
import type { PmsActor } from "../../../../modules/pms/core/types";
import type { BatchQuery } from "../../../db/batch";
import { runBatch } from "../../../db/batch";
import { classifyDbError } from "../../../db/errors";
import type { PmsOnlineBookingsTable } from "../../../db/pms-schema/portal";
import { RepoInputError, assertId, assertTenantId, b01, isOn, nowIso, num, pmsAudit, pmsAuditQuery, pmsId, translateDbError, type DbContext } from "../context";

const T = "pms_online_bookings";

type Row = Selectable<PmsOnlineBookingsTable>;

function toBooking(r: Row): OnlineBooking {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    rev: num(r.rev),
    reference: r.reference,
    patientId: r.patient_id,
    siteId: r.site_id,
    practitionerId: r.practitioner_id,
    serviceId: r.service_id,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    blocksUntil: r.blocks_until,
    status: r.status as BookingStatus,
    channel: r.channel as BookingChannel,
    patientMatch: r.patient_match as PatientMatch,
    cancelledBy: (r.cancelled_by as OnlineBooking["cancelledBy"]) ?? null,
    cancelReason: (r.cancel_reason as CancelReason | null) ?? null,
    cancelledAt: r.cancelled_at,
    lateCancellation: isOn(r.late_cancellation),
    rebookedFromId: r.rebooked_from_id,
    appointmentId: r.appointment_id,
    manageExpiresAt: r.manage_expires_at,
    reviewedAt: r.reviewed_at,
    reviewedBy: r.reviewed_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Whether a database error is the "no double booking" refusal. */
export function isSlotTaken(err: unknown): boolean {
  if (classifyDbError(err) !== "CONSTRAINT_CHECK") return false;
  const message = err instanceof Error ? err.message : String(err);
  return /pms_online_bookings_overlap/.test(message);
}

function isRebookRefused(err: unknown): boolean {
  if (classifyDbError(err) !== "CONSTRAINT_CHECK" && classifyDbError(err) !== "CONSTRAINT_UNIQUE") return false;
  const message = err instanceof Error ? err.message : String(err);
  return /pms_online_bookings_rebook|rebooked_from/.test(message);
}

export interface NewOnlineBooking {
  patientId: string;
  siteId: string;
  practitionerId: string;
  serviceId: string;
  startsAt: string;
  endsAt: string;
  blocksUntil: string;
  channel: BookingChannel;
  patientMatch: PatientMatch;
  /** SHA-256 hex of the "manage this booking" secret (null: no link, e.g. booked in the portal). */
  manageTokenHash: string | null;
  manageExpiresAt: string | null;
}

function checkNew(b: NewOnlineBooking): void {
  for (const [k, v] of Object.entries({ patientId: b.patientId, siteId: b.siteId, practitionerId: b.practitionerId, serviceId: b.serviceId })) assertId(v, k);
  for (const [k, v] of Object.entries({ startsAt: b.startsAt, endsAt: b.endsAt, blocksUntil: b.blocksUntil })) {
    if (!isIsoInstant(v)) throw new RepoInputError(`${k} must be an ISO-8601 UTC instant.`);
  }
  if (!(b.endsAt > b.startsAt) || b.blocksUntil < b.endsAt) throw new RepoInputError("The booking ends before it starts.");
  if (b.manageTokenHash !== null && !/^[0-9a-f]{64}$/.test(b.manageTokenHash)) throw new RepoInputError("manageTokenHash must be SHA-256 hex.");
}

/** The INSERT for a new booking with a fresh id and reference (not executed – send it in a batch). */
export function bookingInsert(ctx: DbContext, tenantId: string, b: NewOnlineBooking, extra: { rebookedFromId?: string | null } = {}): { id: string; reference: string; query: BatchQuery } {
  assertTenantId(tenantId);
  checkNew(b);
  const id = pmsId(P.booking, ctx);
  const reference = bookingReference(randomBytes(8));
  const at = nowIso(ctx);
  const query = ctx.db.insertInto(T).values({
    tenant_id: tenantId,
    id,
    rev: 1,
    reference,
    patient_id: b.patientId,
    site_id: b.siteId,
    practitioner_id: b.practitionerId,
    service_id: b.serviceId,
    starts_at: b.startsAt,
    ends_at: b.endsAt,
    blocks_until: b.blocksUntil,
    status: "booked",
    channel: b.channel,
    patient_match: b.patientMatch,
    late_cancellation: 0,
    rebooked_from_id: extra.rebookedFromId ?? null,
    appointment_id: null,
    manage_token_hash: b.manageTokenHash,
    manage_expires_at: b.manageExpiresAt,
    created_at: at,
    updated_at: at,
  });
  return { id, reference, query };
}

export type BookResult = { ok: true; booking: OnlineBooking } | { ok: false; reason: "slot_taken" };

/**
 * Books a slot: the booking, its audit row and any `extra` writes (the confirmation message, forms to complete)
 * in ONE atomic batch. `extra` is built with the new booking's id. A clash with another booking → slot_taken
 * and nothing is written. A rare reference clash is retried.
 */
export async function createOnlineBooking(
  ctx: DbContext,
  tenantId: string,
  b: NewOnlineBooking,
  actor: PmsActor,
  extra: (booking: { id: string; reference: string }) => BatchQuery[] = () => [],
  auditDetail: Record<string, unknown> = {},
): Promise<BookResult> {
  for (let attempt = 0; ; attempt++) {
    const ins = bookingInsert(ctx, tenantId, b);
    try {
      await runBatch(ctx.db, [
        ins.query,
        pmsAuditQuery(ctx, tenantId, actor, {
          action: "pms.online_booking.create",
          targetType: "pms_online_booking",
          targetId: ins.id,
          detail: { channel: b.channel, match: b.patientMatch, patientId: b.patientId, practitionerId: b.practitionerId, siteId: b.siteId, serviceId: b.serviceId, ...auditDetail },
        }),
        ...extra({ id: ins.id, reference: ins.reference }),
      ]);
      return { ok: true, booking: (await getOnlineBooking(ctx, tenantId, ins.id)) as OnlineBooking };
    } catch (err) {
      if (isSlotTaken(err)) return { ok: false, reason: "slot_taken" };
      const message = err instanceof Error ? err.message : "";
      if (classifyDbError(err) === "CONSTRAINT_UNIQUE" && /reference/.test(message) && attempt < 3) continue;
      throw translateDbError(err, { foreignKey: "The patient, site, practitioner or appointment type does not exist in this clinic." });
    }
  }
}

export type RebookResult = { ok: true; booking: OnlineBooking } | { ok: false; reason: "slot_taken" | "conflict" | "not_found" };

/**
 * Moves a booking to another time: cancels the old one as "rebooked" (with the revision the patient saw) and
 * books the new one in ONE atomic batch. The old booking's own time does not block the new one.
 */
export async function rebookOnlineBooking(
  ctx: DbContext,
  tenantId: string,
  oldId: string,
  expectedRev: number,
  next: Omit<NewOnlineBooking, "patientId" | "channel" | "patientMatch" | "manageTokenHash" | "manageExpiresAt">,
  actor: PmsActor,
  extra: (booking: { id: string; reference: string }) => BatchQuery[] = () => [],
): Promise<RebookResult> {
  assertTenantId(tenantId);
  assertId(oldId, "booking id");
  const row = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("id", "=", oldId).executeTakeFirst();
  if (!row) return { ok: false, reason: "not_found" };
  const old = toBooking(row);
  if (old.rev !== expectedRev || old.status !== "booked") return { ok: false, reason: "conflict" };
  const at = nowIso(ctx);
  // The patient's "manage this booking" link keeps working: it moves to the new booking (the old row lets go of
  // it first, in the same batch).
  const ins = bookingInsert(
    ctx,
    tenantId,
    {
      ...next,
      patientId: old.patientId,
      channel: old.channel,
      patientMatch: old.patientMatch,
      manageTokenHash: row.manage_token_hash,
      manageExpiresAt: row.manage_token_hash ? manageLinkExpiry(next.startsAt) : null,
    },
    { rebookedFromId: oldId },
  );
  try {
    await runBatch(ctx.db, [
      ctx.db
        .updateTable(T)
        .set({ status: "cancelled", cancelled_by: "patient", cancel_reason: "rebooked", cancelled_at: at, manage_token_hash: null, rev: expectedRev + 1, updated_at: at })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", oldId)
        .where("rev", "=", expectedRev)
        .where("status", "=", "booked"),
      ins.query,
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.online_booking.rebook", targetType: "pms_online_booking", targetId: ins.id, detail: { from: oldId, patientId: old.patientId, practitionerId: next.practitionerId } }),
      ...extra({ id: ins.id, reference: ins.reference }),
    ]);
  } catch (err) {
    if (isSlotTaken(err)) return { ok: false, reason: "slot_taken" };
    if (isRebookRefused(err)) return { ok: false, reason: "conflict" };
    throw translateDbError(err);
  }
  return { ok: true, booking: (await getOnlineBooking(ctx, tenantId, ins.id)) as OnlineBooking };
}

export type CancelResult = { ok: true; booking: OnlineBooking } | { ok: false; reason: "conflict" | "not_found" };

/** Cancels a booking (by the patient online, or by the clinic). Revision-checked, audited, never deleted. */
export async function cancelOnlineBooking(
  ctx: DbContext,
  tenantId: string,
  id: string,
  expectedRev: number,
  input: { by: "patient" | "clinic"; reason: CancelReason; late: boolean },
  actor: PmsActor,
  extra: BatchQuery[] = [],
): Promise<CancelResult> {
  assertTenantId(tenantId);
  assertId(id, "booking id");
  if (input.reason === "rebooked") throw new RepoInputError("Use rebookOnlineBooking to move a booking.");
  const at = nowIso(ctx);
  const result = await ctx.db
    .updateTable(T)
    .set({ status: "cancelled", cancelled_by: input.by, cancel_reason: input.reason, cancelled_at: at, late_cancellation: b01(input.late), manage_token_hash: null, rev: expectedRev + 1, updated_at: at })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .where("rev", "=", expectedRev)
    .where("status", "=", "booked")
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) {
    const now = await getOnlineBooking(ctx, tenantId, id);
    return now ? { ok: false, reason: "conflict" } : { ok: false, reason: "not_found" };
  }
  await pmsAudit(ctx, tenantId, actor, { action: "pms.online_booking.cancel", targetType: "pms_online_booking", targetId: id, detail: { by: input.by, reason: input.reason, late: input.late } });
  if (extra.length) await runBatch(ctx.db, extra);
  return { ok: true, booking: (await getOnlineBooking(ctx, tenantId, id)) as OnlineBooking };
}

/** Staff have checked a booking (a new patient's details, a match to an existing record). */
export async function markBookingReviewed(ctx: DbContext, tenantId: string, id: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "booking id");
  const at = nowIso(ctx);
  const result = await ctx.db
    .updateTable(T)
    .set((eb) => ({ reviewed_at: at, reviewed_by: actor.userId, rev: eb("rev", "+", 1), updated_at: at }))
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .where("reviewed_at", "is", null)
    .executeTakeFirst();
  const changed = Number(result.numUpdatedRows) > 0;
  if (changed) await pmsAudit(ctx, tenantId, actor, { action: "pms.online_booking.review", targetType: "pms_online_booking", targetId: id });
  return changed;
}

/** Links the diary's appointment to an online booking (the diary connection; null while bookings stand alone). */
export async function setBookingAppointment(ctx: DbContext, tenantId: string, id: string, appointmentId: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "booking id");
  assertId(appointmentId, "appointment id");
  const at = nowIso(ctx);
  const result = await ctx.db
    .updateTable(T)
    .set((eb) => ({ appointment_id: appointmentId, rev: eb("rev", "+", 1), updated_at: at }))
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .executeTakeFirst();
  const changed = Number(result.numUpdatedRows) > 0;
  if (changed) await pmsAudit(ctx, tenantId, actor, { action: "pms.online_booking.link", targetType: "pms_online_booking", targetId: id, detail: { appointmentId } });
  return changed;
}

export async function getOnlineBooking(ctx: DbContext, tenantId: string, id: string): Promise<OnlineBooking | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return row ? toBooking(row) : null;
}

/** The booking a "manage this booking" link opens (still booked or not, as long as the link has not expired). */
export async function findBookingByManageToken(ctx: DbContext, tenantId: string, tokenHash: string, nowIsoValue: string): Promise<OnlineBooking | null> {
  assertTenantId(tenantId);
  if (!/^[0-9a-f]{64}$/.test(tokenHash)) return null;
  const row = await ctx.db
    .selectFrom(T)
    .selectAll()
    .where("tenant_id", "=", tenantId)
    .where("manage_token_hash", "=", tokenHash)
    .where("manage_expires_at", ">", nowIsoValue)
    .executeTakeFirst();
  return row ? toBooking(row) : null;
}

export interface BusyBooking {
  practitionerId: string;
  startsAt: string;
  blocksUntil: string;
  id: string;
}

/** Booked time of these practitioners overlapping [from, to) – what the slot engine must avoid. */
export async function listBusyBookings(ctx: DbContext, tenantId: string, practitionerIds: string[], fromIso: string, toIso: string): Promise<BusyBooking[]> {
  assertTenantId(tenantId);
  const out: BusyBooking[] = [];
  const unique = Array.from(new Set(practitionerIds));
  for (let i = 0; i < unique.length; i += 90) {
    const rows = await ctx.db
      .selectFrom(T)
      .select(["id", "practitioner_id", "starts_at", "blocks_until"])
      .where("tenant_id", "=", tenantId)
      .where("practitioner_id", "in", unique.slice(i, i + 90))
      .where("status", "=", "booked")
      .where("starts_at", "<", toIso)
      .where("blocks_until", ">", fromIso)
      .orderBy("starts_at")
      .limit(2000)
      .execute();
    for (const r of rows) out.push({ id: r.id, practitionerId: r.practitioner_id, startsAt: r.starts_at, blocksUntil: r.blocks_until });
  }
  return out;
}

export interface ListBookingsOptions {
  /** Only bookings starting at or after this instant. */
  from?: string;
  /** Only bookings starting before this instant. */
  until?: string;
  status?: BookingStatus | "any";
  /** Only bookings not yet checked by staff. */
  unreviewed?: boolean;
  /** Most recent bookings first (default: soonest appointment first). */
  order?: "start" | "created_desc";
  limit?: number;
}

/** The clinic's online bookings (staff list). */
export async function listOnlineBookings(ctx: DbContext, tenantId: string, options: ListBookingsOptions = {}): Promise<OnlineBooking[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId);
  if (options.from) q = q.where("starts_at", ">=", options.from);
  if (options.until) q = q.where("starts_at", "<", options.until);
  const status = options.status ?? "booked";
  if (status !== "any") q = q.where("status", "=", status);
  if (options.unreviewed) q = q.where("reviewed_at", "is", null);
  q = options.order === "created_desc" ? q.orderBy("created_at", "desc").orderBy("id", "desc") : q.orderBy("starts_at").orderBy("id");
  const rows = await q.limit(Math.min(Math.max(1, options.limit ?? 100), 500)).execute();
  return rows.map(toBooking);
}

/** One patient's online bookings (soonest first; `from` = upcoming only). */
export async function listBookingsForPatient(ctx: DbContext, tenantId: string, patientId: string, options: { from?: string; status?: BookingStatus | "any"; limit?: number } = {}): Promise<OnlineBooking[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("patient_id", "=", patientId);
  if (options.from) q = q.where("starts_at", ">=", options.from);
  const status = options.status ?? "any";
  if (status !== "any") q = q.where("status", "=", status);
  const rows = await q.orderBy("starts_at", options.from ? "asc" : "desc").limit(Math.min(Math.max(1, options.limit ?? 50), 500)).execute();
  return rows.map(toBooking);
}

/** Upcoming booked appointments of a patient made online (a cap per patient keeps the booking page from abuse). */
export async function countUpcomingBookingsForPatient(ctx: DbContext, tenantId: string, patientId: string, fromIso: string): Promise<number> {
  assertTenantId(tenantId);
  const row = await ctx.db
    .selectFrom(T)
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("tenant_id", "=", tenantId)
    .where("patient_id", "=", patientId)
    .where("status", "=", "booked")
    .where("starts_at", ">=", fromIso)
    .executeTakeFirst();
  return num(row?.n ?? 0);
}
