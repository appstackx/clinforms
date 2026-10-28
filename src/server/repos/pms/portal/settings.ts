/**
 * `pms_booking_settings` – one row per clinic: whether the booking page and the patient portal are open, the
 * booking rules (notice, horizon, slot step, cancellation notice) and what the booking page says. No row = the
 * defaults with everything OFF (a clinic opens online booking deliberately). Revision-checked updates, audited in
 * the same batch.
 */
import { BookingSettingsInputSchema, type BookingSettingsInput } from "../../../../modules/pms/portal/schemas";
import type { BookingSettings } from "../../../../modules/pms/portal/types";
import type { PmsActor, PmsSaveResult } from "../../../../modules/pms/core/types";
import type { Selectable } from "kysely";
import type { PmsBookingSettingsTable } from "../../../db/pms-schema/portal";
import { classifyDbError } from "../../../db/errors";
import { runBatch } from "../../../db/batch";
import { assertTenantId, b01, isOn, nowIso, num, parseInput, patchColumns, pmsAuditQuery, translateDbError, type DbContext } from "../context";
import { changeWithAudit, portalAuditWhen } from "./shared";

const T = "pms_booking_settings";

export function defaultBookingSettings(tenantId: string): BookingSettings {
  return {
    tenantId,
    rev: 0,
    onlineBooking: false,
    portal: false,
    newPatients: true,
    minNoticeHours: 24,
    maxDaysAhead: 42,
    slotStepMinutes: 15,
    cancelNoticeHours: 24,
    patientCancel: true,
    introText: null,
    cancellationPolicy: null,
    contactPhone: null,
    contactEmail: null,
    updatedAt: null,
  };
}

function toSettings(r: Selectable<PmsBookingSettingsTable>): BookingSettings {
  return {
    tenantId: r.tenant_id,
    rev: num(r.rev),
    onlineBooking: isOn(r.online_booking),
    portal: isOn(r.portal),
    newPatients: isOn(r.new_patients),
    minNoticeHours: num(r.min_notice_hours),
    maxDaysAhead: num(r.max_days_ahead),
    slotStepMinutes: num(r.slot_step_minutes),
    cancelNoticeHours: num(r.cancel_notice_hours),
    patientCancel: isOn(r.patient_cancel),
    introText: r.intro_text,
    cancellationPolicy: r.cancellation_policy,
    contactPhone: r.contact_phone,
    contactEmail: r.contact_email,
    updatedAt: r.updated_at,
  };
}

export async function getBookingSettings(ctx: DbContext, tenantId: string): Promise<BookingSettings> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).executeTakeFirst();
  return row ? toSettings(row) : defaultBookingSettings(tenantId);
}

const flag = (v: boolean) => b01(v);
const MAPPING = {
  onlineBooking: ["online_booking", flag],
  portal: ["portal", flag],
  newPatients: ["new_patients", flag],
  minNoticeHours: "min_notice_hours",
  maxDaysAhead: "max_days_ahead",
  slotStepMinutes: "slot_step_minutes",
  cancelNoticeHours: "cancel_notice_hours",
  patientCancel: ["patient_cancel", flag],
  introText: "intro_text",
  cancellationPolicy: "cancellation_policy",
  contactPhone: "contact_phone",
  contactEmail: "contact_email",
} as const;

/**
 * Saves the settings with the revision the editor saw (0 = there was no row yet). A stale form gets "conflict".
 * The audit detail names the fields changed and the on/off switches – never the texts.
 */
export async function updateBookingSettings(ctx: DbContext, tenantId: string, expectedRev: number, input: BookingSettingsInput, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  const d = parseInput(BookingSettingsInputSchema, input, "Booking settings");
  const set: Record<string, unknown> = {};
  const fields = patchColumns(d, MAPPING as never, set);
  const at = nowIso(ctx);
  const switches = { onlineBooking: d.onlineBooking, portal: d.portal, newPatients: d.newPatients, patientCancel: d.patientCancel };
  const detail = { fields, ...Object.fromEntries(Object.entries(switches).filter(([, v]) => v !== undefined)) };
  if (expectedRev === 0) {
    try {
      await runBatch(ctx.db, [
        ctx.db.insertInto(T).values({ tenant_id: tenantId, ...set, rev: 1, updated_by: actor.userId, created_at: at, updated_at: at }),
        pmsAuditQuery(ctx, tenantId, actor, { action: "pms.booking_settings.update", targetType: "pms_booking_settings", targetId: tenantId, detail: { ...detail, rev: 1 } }),
      ]);
    } catch (err) {
      if (classifyDbError(err) === "CONSTRAINT_UNIQUE") {
        const now = await getBookingSettings(ctx, tenantId);
        return { ok: false, reason: "conflict", currentRev: now.rev };
      }
      throw translateDbError(err);
    }
    return { ok: true, rev: 1, updatedAt: at };
  }
  if (!Number.isInteger(expectedRev) || expectedRev < 1) return { ok: false, reason: "not_found" };
  if (fields.length === 0) return { ok: true, rev: expectedRev, updatedAt: at };
  const next = expectedRev + 1;
  // The change and its audit row in ONE batch (the audit row is written only when the update happened).
  const changed = await changeWithAudit(ctx, [
    ctx.db.updateTable(T).set({ ...set, rev: next, updated_by: actor.userId, updated_at: at }).where("tenant_id", "=", tenantId).where("rev", "=", expectedRev),
    portalAuditWhen(
      ctx,
      tenantId,
      actor,
      { action: "pms.booking_settings.update", targetType: "pms_booking_settings", targetId: tenantId, detail: { ...detail, rev: next } },
      ctx.db.selectFrom(T).select("tenant_id").where("tenant_id", "=", tenantId).where("rev", "=", next).where("updated_at", "=", at),
    ),
  ]);
  if (changed === 0) {
    const now = await ctx.db.selectFrom(T).select("rev").where("tenant_id", "=", tenantId).executeTakeFirst();
    return now ? { ok: false, reason: "conflict", currentRev: num(now.rev) } : { ok: false, reason: "not_found" };
  }
  return { ok: true, rev: expectedRev + 1, updatedAt: at };
}
