/**
 * The diary's side of the comms hook (wired at M6, like billing's visit source at M5): after every diary write that
 * books, moves, changes or ends an appointment, the diary hands comms a snapshot of each appointment it touched and
 * says what happened; comms plans, re-plans or cancels the appointment's messages (syncAppointmentMessages –
 * src/server/repos/pms/comms/schedule.ts, idempotent, audited "pms.message_schedule.sync").
 *
 *   booked     – a new appointment: the reminders, and the booking confirmation only when the booking asked for one
 *                ("Send confirmation text and email" – pms_appointments.confirmation_requested);
 *   moved      – a new start time: reminders re-planned for the new time, a "moved" notice (clinic setting);
 *                same start (a room or practitioner change only): reminders refreshed, no notice;
 *   changed    – details or length: reminders refreshed (an appointment type may have its own reminders);
 *   status     – arrived / in treatment / completed: pending reminders cancelled; did not attend: the follow-up an
 *                hour after the start (clinic setting); back to booked (undo, reinstate): reminders planned again;
 *   cancelled  – reminders cancelled; "cancelled" (with notice) or "late_cancelled" notice (clinic setting);
 *   series     – the rest of a recurring booking cancelled: reminders cancelled, no notice per appointment.
 *
 * The diary's write is already done when this runs (a separate batch): a failure here is logged by name and the
 * diary's answer is unchanged – the reminder run checks the appointment is still booked before it sends
 * (appointmentStatuses, handed to the run as DispatchDeps.appointmentStatus).
 */
import "server-only";
import type { PmsActor } from "../../../modules/pms/core/types";
import type { AppointmentForMessages } from "../../../modules/pms/comms/schemas";
import { logAuthEvent } from "../../email/log";
import { assertTenantId, type RepoContext } from "../../repos/context";
import { isOn } from "../../repos/pms/context";
import { syncAppointmentMessages } from "../../repos/pms/comms/schedule";
import { dispatchDepsFromEnv, sendAppointmentNotice, type DispatchDeps, type SendResult } from "../comms/dispatch";

export type DiaryMessageEvent = "booked" | "moved" | "changed" | "status" | "cancelled" | "series";

const COLUMNS = ["id", "kind", "patient_id", "starts_at", "ends_at", "site_id", "practitioner_id", "service_id", "status", "confirmation_requested"] as const;

async function readAppointments(ctx: RepoContext, tenantId: string, ids: readonly string[]) {
  assertTenantId(tenantId);
  const unique = Array.from(new Set(ids));
  const rows = [];
  for (let i = 0; i < unique.length; i += 90) {
    rows.push(...(await ctx.db.selectFrom("pms_appointments").select(COLUMNS).where("tenant_id", "=", tenantId).where("id", "in", unique.slice(i, i + 90)).execute()));
  }
  return rows;
}

/** The current status of appointments (for the reminder run: only "booked" ones get reminders and confirmations). */
export async function appointmentStatuses(ctx: RepoContext, tenantId: string, ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const rows = await readAppointments(ctx, tenantId, ids);
  return new Map(rows.map((r) => [r.id, r.status]));
}

/** Providers for sends the diary starts (waiting-list offers), with the diary's status reader. */
export function diaryDispatchDeps(): DispatchDeps {
  return dispatchDepsFromEnv(process.env, appointmentStatuses);
}

/**
 * Plans the messages of the appointments a diary write touched. `previousStarts` (moves): the start before the
 * move – a "moved" notice only when the time really changed. Never throws.
 */
export async function syncDiaryMessages(
  ctx: RepoContext,
  tenantId: string,
  ids: readonly string[],
  actor: PmsActor,
  event: DiaryMessageEvent,
  previousStarts: ReadonlyMap<string, string> = new Map(),
): Promise<void> {
  try {
    const rows = await readAppointments(ctx, tenantId, ids);
    for (const r of rows) {
      if (r.kind !== "appointment" || !r.patient_id) continue;
      const active = r.status === "booked";
      let notify: "none" | "confirmation" | "moved" | "cancelled" | "late_cancelled" | "dna" = "none";
      if (event === "booked" && active && isOn(r.confirmation_requested)) notify = "confirmation";
      else if (event === "moved" && active) {
        const before = previousStarts.get(r.id);
        notify = before && Date.parse(before) !== Date.parse(r.starts_at) ? "moved" : "none";
      } else if (event === "status" && r.status === "dna") notify = "dna";
      else if (event === "cancelled") notify = r.status === "late_cancelled" ? "late_cancelled" : r.status === "cancelled" ? "cancelled" : "none";
      const snapshot: AppointmentForMessages = {
        id: r.id,
        patientId: r.patient_id,
        startsAt: new Date(r.starts_at).toISOString(),
        endsAt: r.ends_at ? new Date(r.ends_at).toISOString() : null,
        siteId: r.site_id,
        practitionerId: r.practitioner_id,
        serviceId: r.service_id,
        active,
      };
      await syncAppointmentMessages(ctx, tenantId, snapshot, actor, { notify });
    }
  } catch (err) {
    logAuthEvent("pms.diary_message_sync_failed", { event, error: err instanceof Error ? err.name : "error" });
  }
}

/**
 * "Offer slot by text" on the waiting list: the offer's time, place and practitioner by text (else email) to the
 * patient. The slot is not held (the diary's rule). Never throws: answers what happened.
 */
export async function sendWaitingListOfferMessage(
  ctx: RepoContext,
  tenantId: string,
  offer: { id: string; patientId: string; startsAt: string; endsAt: string | null; siteId: string | null; practitionerId: string | null; serviceId: string | null },
  actor: PmsActor,
): Promise<SendResult | { ok: false; reason: "not_configured"; message: string }> {
  try {
    const deps = diaryDispatchDeps();
    return await sendAppointmentNotice(
      ctx,
      tenantId,
      {
        patientId: offer.patientId,
        kind: "offer",
        appointment: { startsAt: offer.startsAt, endsAt: offer.endsAt, siteId: offer.siteId, practitionerId: offer.practitionerId, serviceId: offer.serviceId },
        appointmentRef: null,
      },
      actor,
      deps,
    );
  } catch (err) {
    logAuthEvent("pms.diary_offer_message_failed", { error: err instanceof Error ? err.name : "error" });
    return { ok: false, reason: "not_configured", message: "The message service is not set up." };
  }
}
