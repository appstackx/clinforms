/**
 * `pms_online_bookings` – the online-booking record of a diary appointment booked online (the public booking page
 * or the patient portal). The appointment itself is the diary's (pms_appointments, source "online"): its time,
 * place, practitioner and status are read from the diary. This table adds the reference the patient sees, how the
 * patient record was found (staff only), when staff checked the booking, and the SHA-256 of the "manage this
 * booking" link (the secret is shown once to the patient and never stored).
 *
 * The row is written in the SAME atomic batch as the diary appointment (the diary's bookAppointment takes it as
 * extra queries – src/server/pms/diary/portal-adapter.ts), so there is never one without the other.
 */
import { randomBytes } from "node:crypto";
import type { Selectable } from "kysely";
import { PORTAL_ID_PREFIXES as P } from "../../../../modules/pms/portal/ids";
import { bookingReference } from "../../../../modules/pms/portal/policy";
import type { BookingChannel, OnlineBooking, PatientMatch } from "../../../../modules/pms/portal/types";
import type { PmsActor } from "../../../../modules/pms/core/types";
import type { BatchQuery } from "../../../db/batch";
import type { PmsOnlineBookingsTable } from "../../../db/pms-schema/portal";
import { RepoInputError, assertId, assertTenantId, nowIso, num, pmsAuditQuery, pmsId, type DbContext } from "../context";
import { changeWithAudit, portalAuditWhen } from "./shared";

const T = "pms_online_bookings";
const HASH = /^[0-9a-f]{64}$/;

type Row = Selectable<PmsOnlineBookingsTable>;

function toBooking(r: Row): OnlineBooking {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    rev: num(r.rev),
    reference: r.reference,
    patientId: r.patient_id,
    appointmentId: r.appointment_id,
    channel: r.channel as BookingChannel,
    patientMatch: r.patient_match as PatientMatch,
    manageExpiresAt: r.manage_expires_at ? new Date(r.manage_expires_at).toISOString() : null,
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null,
    reviewedBy: r.reviewed_by,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export interface NewOnlineBooking {
  patientId: string;
  appointmentId: string;
  channel: BookingChannel;
  patientMatch: PatientMatch;
  /** SHA-256 hex of the "manage this booking" secret (booking page only). */
  manageTokenHash: string | null;
  manageExpiresAt: string | null;
}

/**
 * The INSERT of an online-booking record and its audit row – for the diary's booking batch. The audit detail says
 * how the booking was made and how its record was found (never names). A unique-reference clash (one in ~10^11)
 * makes the whole batch fail; the caller retries with a new reference.
 */
export function onlineBookingQueries(ctx: DbContext, tenantId: string, input: NewOnlineBooking, actor: PmsActor): { id: string; reference: string; queries: BatchQuery[] } {
  assertTenantId(tenantId);
  assertId(input.patientId, "patient id");
  assertId(input.appointmentId, "appointment id");
  if (input.channel !== "booking_page" && input.channel !== "portal") throw new RepoInputError("Unknown booking channel.");
  if (!["new", "existing", "portal"].includes(input.patientMatch)) throw new RepoInputError("Unknown patient match.");
  if (input.manageTokenHash !== null && !HASH.test(input.manageTokenHash)) throw new RepoInputError("manageTokenHash must be SHA-256 hex.");
  const id = pmsId(P.booking, ctx);
  const reference = bookingReference(randomBytes(8));
  const at = nowIso(ctx);
  return {
    id,
    reference,
    queries: [
      ctx.db.insertInto(T).values({
        tenant_id: tenantId,
        id,
        rev: 1,
        reference,
        patient_id: input.patientId,
        appointment_id: input.appointmentId,
        channel: input.channel,
        patient_match: input.patientMatch,
        manage_token_hash: input.manageTokenHash,
        manage_expires_at: input.manageExpiresAt,
        reviewed_at: null,
        reviewed_by: null,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, {
        action: "pms.online_booking.create",
        targetType: "pms_online_booking",
        targetId: id,
        detail: { appointmentId: input.appointmentId, channel: input.channel, patientMatch: input.patientMatch, via: "patient" },
      }),
    ],
  };
}

export async function getOnlineBooking(ctx: DbContext, tenantId: string, id: string): Promise<OnlineBooking | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return row ? toBooking(row) : null;
}

export async function getOnlineBookingForAppointment(ctx: DbContext, tenantId: string, appointmentId: string): Promise<OnlineBooking | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("appointment_id", "=", appointmentId).executeTakeFirst();
  return row ? toBooking(row) : null;
}

/** The online bookings of these appointments (the diary drawer, the portal list). */
export async function onlineBookingsForAppointments(ctx: DbContext, tenantId: string, appointmentIds: readonly string[]): Promise<Map<string, OnlineBooking>> {
  assertTenantId(tenantId);
  const out = new Map<string, OnlineBooking>();
  const ids = Array.from(new Set(appointmentIds));
  for (let i = 0; i < ids.length; i += 90) {
    const rows = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("appointment_id", "in", ids.slice(i, i + 90)).execute();
    for (const r of rows) out.set(r.appointment_id, toBooking(r));
  }
  return out;
}

/** The booking a "manage this booking" link points at, while the link is valid (hash compared in SQL). */
export async function findByManageToken(ctx: DbContext, tenantId: string, tokenHash: string): Promise<OnlineBooking | null> {
  assertTenantId(tenantId);
  if (!HASH.test(tokenHash)) return null;
  const row = await ctx.db
    .selectFrom(T)
    .selectAll()
    .where("tenant_id", "=", tenantId)
    .where("manage_token_hash", "=", tokenHash)
    .where("manage_expires_at", ">", nowIso(ctx))
    .executeTakeFirst();
  return row ? toBooking(row) : null;
}

/** Online bookings made since an instant, newest first (staff: Online booking page). */
export async function listRecentOnlineBookings(ctx: DbContext, tenantId: string, options: { since?: string; limit?: number; unreviewedOnly?: boolean } = {}): Promise<OnlineBooking[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId);
  if (options.since) q = q.where("created_at", ">=", options.since);
  if (options.unreviewedOnly) q = q.where("reviewed_at", "is", null);
  const rows = await q.orderBy("created_at", "desc").orderBy("id", "desc").limit(Math.min(500, options.limit ?? 100)).execute();
  return rows.map(toBooking);
}

/** Staff checked a new online booking (e.g. matched the new record to an existing patient). Audited in the batch. */
export async function markOnlineBookingReviewed(ctx: DbContext, tenantId: string, id: string, expectedRev: number, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "online booking id");
  const at = nowIso(ctx);
  const next = expectedRev + 1;
  const changed = await changeWithAudit(ctx, [
    ctx.db
      .updateTable(T)
      .set({ reviewed_at: at, reviewed_by: actor.userId, rev: next, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("rev", "=", expectedRev)
      .where("reviewed_at", "is", null),
    portalAuditWhen(
      ctx,
      tenantId,
      actor,
      { action: "pms.online_booking.review", targetType: "pms_online_booking", targetId: id, detail: { rev: next } },
      ctx.db.selectFrom(T).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("rev", "=", next).where("updated_at", "=", at),
    ),
  ]);
  return changed > 0;
}
