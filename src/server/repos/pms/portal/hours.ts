/**
 * `pms_booking_hours` – the weekly hours each practitioner offers for online booking at a site (UK local time).
 * Configuration, not a clinical record: rows can be removed (audited). A practitioner cannot offer two sites at
 * the same time on the same day (checked here; staff edit hours one at a time).
 */
import type { Selectable } from "kysely";
import { BookingHoursInputSchema, type BookingHoursInput } from "../../../../modules/pms/portal/schemas";
import { PORTAL_ID_PREFIXES as P } from "../../../../modules/pms/portal/ids";
import { hoursClash, type HoursRule } from "../../../../modules/pms/portal/slots";
import type { BookingHours } from "../../../../modules/pms/portal/types";
import type { PmsActor } from "../../../../modules/pms/core/types";
import type { PmsBookingHoursTable } from "../../../db/pms-schema/portal";
import { RepoInputError, assertId, assertTenantId, nowIso, num, parseInput, pmsAudit, pmsAuditQuery, pmsId, writeWithAudit, type DbContext } from "../context";
import { minutesToHhmm, weekdayName } from "../../../../modules/pms/portal/time";

const T = "pms_booking_hours";

function toHours(r: Selectable<PmsBookingHoursTable>): BookingHours {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    practitionerId: r.practitioner_id,
    siteId: r.site_id,
    weekday: num(r.weekday),
    startMinute: num(r.start_minute),
    endMinute: num(r.end_minute),
    validFrom: r.valid_from,
    validTo: r.valid_to,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function hoursToRule(h: BookingHours): HoursRule {
  return { practitionerId: h.practitionerId, siteId: h.siteId, weekday: h.weekday, startMinute: h.startMinute, endMinute: h.endMinute, validFrom: h.validFrom, validTo: h.validTo };
}

export async function listBookingHours(ctx: DbContext, tenantId: string, options: { siteId?: string; practitionerIds?: string[] } = {}): Promise<BookingHours[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId);
  if (options.siteId) q = q.where("site_id", "=", options.siteId);
  if (options.practitionerIds) {
    if (options.practitionerIds.length === 0) return [];
    if (options.practitionerIds.length > 90) throw new RepoInputError("At most 90 practitioners at a time.");
    q = q.where("practitioner_id", "in", options.practitionerIds);
  }
  const rows = await q.orderBy("practitioner_id").orderBy("weekday").orderBy("start_minute").limit(500).execute();
  return rows.map(toHours);
}

export async function getBookingHours(ctx: DbContext, tenantId: string, id: string): Promise<BookingHours | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return row ? toHours(row) : null;
}

const MESSAGES = { foreignKey: "That practitioner or site does not exist in this clinic." };

export async function createBookingHours(ctx: DbContext, tenantId: string, input: BookingHoursInput, actor: PmsActor): Promise<BookingHours> {
  assertTenantId(tenantId);
  const d = parseInput(BookingHoursInputSchema, input, "Online hours");
  const existing = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("practitioner_id", "=", d.practitionerId).where("weekday", "=", d.weekday).execute();
  const candidate = { practitionerId: d.practitionerId, weekday: d.weekday, startMinute: d.startMinute, endMinute: d.endMinute, validFrom: d.validFrom ?? null, validTo: d.validTo ?? null };
  const clash = existing.map(toHours).find((h) => hoursClash(hoursToRule(h), candidate));
  if (clash) {
    throw new RepoInputError(`These hours overlap ${weekdayName(clash.weekday)} ${minutesToHhmm(clash.startMinute)}–${minutesToHhmm(clash.endMinute)} already offered by this practitioner.`);
  }
  const id = pmsId(P.bookingHours, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto(T).values({
        tenant_id: tenantId,
        id,
        practitioner_id: d.practitionerId,
        site_id: d.siteId,
        weekday: d.weekday,
        start_minute: d.startMinute,
        end_minute: d.endMinute,
        valid_from: d.validFrom ?? null,
        valid_to: d.validTo ?? null,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.booking_hours.create", targetType: "pms_booking_hours", targetId: id, detail: { practitionerId: d.practitionerId, siteId: d.siteId, weekday: d.weekday } }),
    ],
    MESSAGES,
  );
  return (await getBookingHours(ctx, tenantId, id)) as BookingHours;
}

/** Removes a row of online hours (configuration only – bookings already made are kept). */
export async function removeBookingHours(ctx: DbContext, tenantId: string, id: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "hours id");
  const result = await ctx.db.deleteFrom(T).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  const removed = Number(result.numDeletedRows) > 0;
  if (removed) await pmsAudit(ctx, tenantId, actor, { action: "pms.booking_hours.remove", targetType: "pms_booking_hours", targetId: id });
  return removed;
}
