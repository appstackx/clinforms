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
 * (appointmentStatuses, handed to the run as DispatchDeps.appointmentStatus), and the run RECONCILES (M9b):
 * reconcileDiaryMessages, called by the message run (cron and "Send due messages now") before it sends, re-syncs
 * every appointment changed since the last sweep (pms_diary_message_sweeps, 0189), so a failed sync heals itself
 * at the next run – reminders, confirmations asked for, cancellation and did-not-attend notices. A "moved" notice
 * lost to a failed sync is not re-created (the old time is not kept); the reminders for the new time are.
 */
import "server-only";
import type { PmsActor } from "../../../modules/pms/core/types";
import type { AppointmentForMessages } from "../../../modules/pms/comms/schemas";
import { logAuthEvent } from "../../email/log";
import { assertTenantId, nowIso, type RepoContext } from "../../repos/context";
import { isOn } from "../../repos/pms/context";
import { syncAppointmentMessages } from "../../repos/pms/comms/schedule";
import { SYSTEM_ACTOR, dispatchDepsFromEnv, sendAppointmentNotice, type DispatchDeps, type SendResult } from "../comms/dispatch";

export type DiaryMessageEvent = "booked" | "moved" | "changed" | "status" | "cancelled" | "series";

const COLUMNS = ["id", "kind", "patient_id", "starts_at", "ends_at", "site_id", "practitioner_id", "service_id", "status", "confirmation_requested", "cancelled_at", "updated_at"] as const;
type SyncRow = Awaited<ReturnType<typeof readAppointments>>[number];

function snapshotOf(r: SyncRow & { patient_id: string }): AppointmentForMessages {
  return {
    id: r.id,
    patientId: r.patient_id,
    startsAt: new Date(r.starts_at).toISOString(),
    endsAt: r.ends_at ? new Date(r.ends_at).toISOString() : null,
    siteId: r.site_id,
    practitionerId: r.practitioner_id,
    serviceId: r.service_id,
    active: r.status === "booked",
  };
}

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
      await syncAppointmentMessages(ctx, tenantId, snapshotOf({ ...r, patient_id: r.patient_id }), actor, { notify });
    }
  } catch (err) {
    logAuthEvent("pms.diary_message_sync_failed", { event, error: err instanceof Error ? err.name : "error" });
  }
}

/**
 * "Offer slot by text" on the waiting list: the offer's time, place and practitioner by text (else email) to the
 * patient. The slot is held for them by the offer (0180/0181) until it is answered or the hold ends. Never throws: answers what happened.
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

/* ------------------------------------------------------------------------------------------------
 * The sweep: a failed sync heals itself at the next message run (M9b)
 * ----------------------------------------------------------------------------------------------*/

/** The first sweep of a clinic looks back this far; a sweep never looks further back. */
export const SWEEP_LOOK_BACK_MS = 86_400_000;
/** Each sweep starts this much before the last one ended (writes that were in flight then). */
export const SWEEP_OVERLAP_MS = 120_000;
/** Appointments per sweep (the rest wait for the next run – synced_to only moves as far as was done). */
export const SWEEP_LIMIT = 300;

export interface SweepResult {
  checked: number;
  /** Appointments whose planned messages were out of step and were brought back in line. */
  fixed: number;
  syncedTo: string;
}

/**
 * Re-syncs every appointment changed since the last sweep with its planned messages (idempotent: an appointment
 * already in step writes nothing). What a failed sync lost and the appointment itself tells: its reminders; the
 * confirmation it asked for (none planned or sent yet); its cancellation notice (cancelled since the sweep, none
 * yet); its did-not-attend follow-up (none yet). Called by the message run before it sends. Never throws.
 */
export async function reconcileDiaryMessages(ctx: RepoContext, tenantId: string, actor: PmsActor = SYSTEM_ACTOR): Promise<SweepResult | null> {
  try {
    assertTenantId(tenantId);
    const now = nowIso(ctx);
    const nowMs = Date.parse(now);
    const last = await ctx.db.selectFrom("pms_diary_message_sweeps").select("synced_to").where("tenant_id", "=", tenantId).executeTakeFirst();
    const fromMs = Math.max(nowMs - SWEEP_LOOK_BACK_MS, last ? Date.parse(new Date(last.synced_to).toISOString()) - SWEEP_OVERLAP_MS : 0);
    const from = new Date(fromMs).toISOString();
    const rows = await ctx.db
      .selectFrom("pms_appointments")
      .select(COLUMNS)
      .where("tenant_id", "=", tenantId)
      .where("kind", "=", "appointment")
      .where("patient_id", "is not", null)
      .where("updated_at", ">", from)
      .where("updated_at", "<=", now)
      .orderBy("updated_at")
      .orderBy("id")
      .limit(SWEEP_LIMIT)
      .execute();
    let fixed = 0;
    const ids = rows.map((r) => r.id);
    const existing = new Map<string, Set<string>>();
    for (let i = 0; i < ids.length; i += 90) {
      const found = await ctx.db.selectFrom("pms_message_schedule").select(["appointment_id", "kind"]).where("tenant_id", "=", tenantId).where("appointment_id", "in", ids.slice(i, i + 90)).execute();
      for (const f of found) {
        if (!f.appointment_id) continue;
        const set = existing.get(f.appointment_id) ?? new Set<string>();
        set.add(f.kind);
        existing.set(f.appointment_id, set);
      }
    }
    for (const r of rows) {
      if (!r.patient_id) continue;
      const kinds = existing.get(r.id) ?? new Set<string>();
      let notify: "none" | "confirmation" | "cancelled" | "late_cancelled" | "dna" = "none";
      if (r.status === "booked" && isOn(r.confirmation_requested) && !kinds.has("confirmation")) notify = "confirmation";
      else if ((r.status === "cancelled" || r.status === "late_cancelled") && !kinds.has(r.status) && r.cancelled_at && new Date(r.cancelled_at).toISOString() > from) notify = r.status;
      else if (r.status === "dna" && !kinds.has("dna")) notify = "dna";
      const result = await syncAppointmentMessages(ctx, tenantId, snapshotOf({ ...r, patient_id: r.patient_id }), actor, { notify });
      if (result.planned > 0 || result.cancelled > 0) fixed++;
    }
    const syncedTo = rows.length === SWEEP_LIMIT ? new Date(rows[rows.length - 1].updated_at).toISOString() : now;
    await ctx.db
      .insertInto("pms_diary_message_sweeps")
      .values({ tenant_id: tenantId, synced_to: syncedTo, updated_at: now })
      .onConflict((oc) => oc.column("tenant_id").doUpdateSet({ synced_to: syncedTo, updated_at: now }))
      .execute();
    if (fixed > 0) logAuthEvent("pms.diary_message_sync_reconciled", { fixed });
    return { checked: rows.length, fixed, syncedTo };
  } catch (err) {
    logAuthEvent("pms.diary_message_sweep_failed", { error: err instanceof Error ? err.name : "error" });
    return null;
  }
}
