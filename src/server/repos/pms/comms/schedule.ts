/**
 * `pms_message_schedule` – the messages planned for appointments: the booking confirmation, the reminders of each
 * rule, "moved" and "cancelled" notices. The diary calls syncAppointmentMessages() whenever an appointment is
 * booked, moved, changed or cancelled (src/server/pms/comms/index.ts); the reminder run sends what is due
 * (src/server/pms/comms/dispatch.ts).
 *
 * - Each row keeps the snapshot a message needs (start, end, site, practitioner, appointment type), so comms never
 *   reads the diary's tables. appointment_id has no foreign key.
 * - Sync is idempotent: the wanted rows come from the pure plan (planAppointmentMessages); pending rows no longer
 *   wanted are cancelled, new ones inserted, cancelled ones wanted again re-planned. Rows already sent stay sent.
 * - Sending claims rows first (status processing + a claim token, in SQL), so two runs never send one row twice;
 *   a claim older than STALE_CLAIM_MINUTES is released again.
 */
import type { Selectable } from "kysely";
import { COMMS_ID_PREFIXES as P } from "../../../../modules/pms/comms/ids";
import { planAppointmentMessages } from "../../../../modules/pms/comms/schedule";
import { AppointmentForMessagesSchema, AppointmentNotifySchema, type AppointmentForMessages } from "../../../../modules/pms/comms/schemas";
import type { AppointmentMessageKind, MessageChannel, ScheduleStatus, ScheduledMessage, SkipReason } from "../../../../modules/pms/comms/types";
import type { PmsActor } from "../../../../modules/pms/core/types";
import type { BatchQuery } from "../../../db/batch";
import type { PmsMessageScheduleTable } from "../../../db/pms-schema/comms";
import { assertTenantId, nowIso, num, parseInput, pmsAudit, pmsAuditQuery, pmsId, writeWithAudit, type DbContext } from "../context";
import { listReminderRules } from "./rules";
import { getCommsSettings } from "./settings";

const T = "pms_message_schedule";
export const STALE_CLAIM_MINUTES = 10;
export const MAX_ATTEMPTS = 5;
const MESSAGES = { foreignKey: "The patient, site, practitioner or appointment type does not exist in this clinic." };

type Row = Selectable<PmsMessageScheduleTable>;

function toScheduled(r: Row): ScheduledMessage {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    appointmentId: r.appointment_id,
    patientId: r.patient_id,
    kind: r.kind as AppointmentMessageKind,
    channel: r.channel as MessageChannel,
    ruleId: r.rule_id,
    dueAt: r.due_at,
    status: r.status as ScheduleStatus,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    siteId: r.site_id,
    practitionerId: r.practitioner_id,
    serviceId: r.service_id,
    messageId: r.message_id,
    skipReason: (r.skip_reason as SkipReason | null) ?? null,
    attempts: num(r.attempts),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface SyncResult {
  planned: number;
  cancelled: number;
  kept: number;
}

/**
 * Brings an appointment's planned messages in line with the appointment (see the file comment). `notify` asks for
 * a booking confirmation, a "moved" or a "cancelled" notice besides the reminders.
 */
export async function syncAppointmentMessages(
  ctx: DbContext,
  tenantId: string,
  input: AppointmentForMessages,
  actor: PmsActor,
  options: { notify?: "none" | "confirmation" | "moved" | "cancelled" } = {},
): Promise<SyncResult> {
  assertTenantId(tenantId);
  const appt = parseInput(AppointmentForMessagesSchema, input, "Appointment");
  const notify = parseInput(AppointmentNotifySchema, options.notify ?? "none", "Notify");
  const at = nowIso(ctx);
  const [settings, rules, existing] = await Promise.all([
    getCommsSettings(ctx, tenantId),
    listReminderRules(ctx, tenantId, { activeOnly: true }),
    ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("appointment_id", "=", appt.id).limit(500).execute(),
  ]);
  const plan = planAppointmentMessages({ appointment: { startsAt: appt.startsAt, serviceId: appt.serviceId ?? null, active: appt.active }, notify, settings, rules, now: at });
  const byKey = new Map(existing.map((r) => [r.dedupe_key, r]));
  const wanted = new Set(plan.map((p) => p.dedupeKey));
  const snapshot = {
    starts_at: new Date(appt.startsAt).toISOString(),
    ends_at: appt.endsAt ? new Date(appt.endsAt).toISOString() : null,
    site_id: appt.siteId ?? null,
    practitioner_id: appt.practitionerId ?? null,
    service_id: appt.serviceId ?? null,
  };
  const queries: BatchQuery[] = [];
  let planned = 0;
  let cancelled = 0;
  let kept = 0;
  let refreshed = 0;
  for (const r of existing) {
    if (r.status !== "pending" || wanted.has(r.dedupe_key)) continue;
    queries.push(
      ctx.db
        .updateTable(T)
        .set({ status: "cancelled", skip_reason: appt.active ? null : "appointment_cancelled", updated_at: at })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", r.id)
        .where("status", "=", "pending"),
    );
    cancelled++;
  }
  for (const p of plan) {
    const row = byKey.get(p.dedupeKey);
    if (!row) {
      queries.push(
        ctx.db.insertInto(T).values({
          tenant_id: tenantId,
          id: pmsId(P.schedule, ctx),
          appointment_id: appt.id,
          patient_id: appt.patientId,
          kind: p.kind,
          channel: p.channel,
          rule_id: p.ruleId,
          dedupe_key: p.dedupeKey,
          due_at: p.dueAt,
          status: "pending",
          ...snapshot,
          message_id: null,
          skip_reason: null,
          claim_token: null,
          claimed_at: null,
          attempts: 0,
          created_at: at,
          updated_at: at,
        }),
      );
      planned++;
    } else if (row.status === "cancelled") {
      queries.push(
        ctx.db
          .updateTable(T)
          .set({ status: "pending", due_at: p.dueAt, skip_reason: null, patient_id: appt.patientId, ...snapshot, updated_at: at })
          .where("tenant_id", "=", tenantId)
          .where("id", "=", row.id)
          .where("status", "=", "cancelled"),
      );
      planned++;
    } else if (row.status === "pending") {
      // Same message, same start: keep it, with the latest snapshot (the site or practitioner may have changed).
      const changed =
        row.due_at !== p.dueAt ||
        row.site_id !== snapshot.site_id ||
        row.practitioner_id !== snapshot.practitioner_id ||
        row.service_id !== snapshot.service_id ||
        (row.ends_at ? new Date(row.ends_at).toISOString() : null) !== snapshot.ends_at;
      if (changed) {
        queries.push(
          ctx.db
            .updateTable(T)
            .set({ due_at: p.dueAt, ...snapshot, updated_at: at })
            .where("tenant_id", "=", tenantId)
            .where("id", "=", row.id)
            .where("status", "=", "pending"),
        );
        refreshed++;
      }
      kept++;
    } else {
      kept++;
    }
  }
  if (queries.length > 0) {
    queries.push(
      pmsAuditQuery(ctx, tenantId, actor, {
        action: "pms.message_schedule.sync",
        targetType: "pms_message_schedule",
        targetId: appt.id,
        detail: { appointmentId: appt.id, planned, cancelled, refreshed, notify, active: appt.active },
      }),
    );
    await writeWithAudit(ctx, queries, MESSAGES);
  }
  return { planned, cancelled, kept };
}

/** Planned messages of an appointment (all statuses, by due time). */
export async function listScheduleForAppointment(ctx: DbContext, tenantId: string, appointmentId: string): Promise<ScheduledMessage[]> {
  assertTenantId(tenantId);
  return (await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("appointment_id", "=", appointmentId).orderBy("due_at").orderBy("id").limit(200).execute()).map(
    toScheduled,
  );
}

export interface UpcomingOptions {
  /** Default now. */
  from?: string;
  until: string;
  patientId?: string;
  /** Default 100, at most 500. */
  limit?: number;
}

/** Messages still to go, by due time. */
export async function listUpcomingMessages(ctx: DbContext, tenantId: string, options: UpcomingOptions): Promise<ScheduledMessage[]> {
  assertTenantId(tenantId);
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 100)), 500);
  let q = ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("status", "=", "pending").where("due_at", "<=", options.until);
  if (options.from) q = q.where("due_at", ">=", options.from);
  if (options.patientId) q = q.where("patient_id", "=", options.patientId);
  return (await q.orderBy("due_at").orderBy("id").limit(limit).execute()).map(toScheduled);
}

/** Number of messages due now or earlier and not yet sent (the overview's "due" figure). */
export async function countDueMessages(ctx: DbContext, tenantId: string, now: string): Promise<number> {
  assertTenantId(tenantId);
  const r = await ctx.db
    .selectFrom(T)
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("tenant_id", "=", tenantId)
    .where("status", "=", "pending")
    .where("due_at", "<=", now)
    .executeTakeFirst();
  return Number(r?.n ?? 0);
}

/**
 * Claims up to `limit` due rows for one run: releases stale claims first, then marks the oldest due rows
 * "processing" under `token` in one UPDATE (only rows still pending), and returns exactly the rows claimed.
 */
export async function claimDueMessages(ctx: DbContext, tenantId: string, token: string, limit: number): Promise<ScheduledMessage[]> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  const stale = new Date(Date.parse(at) - STALE_CLAIM_MINUTES * 60_000).toISOString();
  // A run that died mid-way leaves rows claimed: release them – or, after MAX_ATTEMPTS, give up on them.
  await ctx.db
    .updateTable(T)
    .set({ status: "failed", skip_reason: "provider_error", updated_at: at })
    .where("tenant_id", "=", tenantId)
    .where("status", "=", "processing")
    .where("claimed_at", "<", stale)
    .where("attempts", ">=", MAX_ATTEMPTS)
    .execute();
  await ctx.db
    .updateTable(T)
    .set({ status: "pending", claim_token: null, claimed_at: null, updated_at: at })
    .where("tenant_id", "=", tenantId)
    .where("status", "=", "processing")
    .where("claimed_at", "<", stale)
    .execute();
  const due = await ctx.db
    .selectFrom(T)
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("status", "=", "pending")
    .where("due_at", "<=", at)
    .orderBy("due_at")
    .orderBy("id")
    .limit(Math.min(Math.max(1, limit), 90))
    .execute();
  if (due.length === 0) return [];
  await ctx.db
    .updateTable(T)
    .set((eb) => ({ status: "processing", claim_token: token, claimed_at: at, attempts: eb("attempts", "+", 1), updated_at: at }))
    .where("tenant_id", "=", tenantId)
    .where("id", "in", due.map((d) => d.id))
    .where("status", "=", "pending")
    .execute();
  return (await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("claim_token", "=", token).where("status", "=", "processing").orderBy("due_at").execute()).map(
    toScheduled,
  );
}

/** The UPDATE that closes a claimed row (sent with its message, or skipped with a reason) – for a batch. */
export function closeScheduleQuery(ctx: DbContext, tenantId: string, id: string, token: string, outcome: { status: "sent"; messageId: string } | { status: "skipped" | "failed"; reason: SkipReason }): BatchQuery {
  const at = nowIso(ctx);
  const set = outcome.status === "sent" ? { status: "sent", message_id: outcome.messageId, skip_reason: null, updated_at: at } : { status: outcome.status, skip_reason: outcome.reason, updated_at: at };
  return ctx.db.updateTable(T).set(set).where("tenant_id", "=", tenantId).where("id", "=", id).where("claim_token", "=", token).where("status", "=", "processing");
}

/** Cancels every planned message of a patient on a channel (after they opted out of it). Returns how many. */
export async function cancelPendingForPatient(ctx: DbContext, tenantId: string, patientId: string, channel: MessageChannel, reason: SkipReason, actor: PmsActor): Promise<number> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  const r = await ctx.db
    .updateTable(T)
    .set({ status: "cancelled", skip_reason: reason, updated_at: at })
    .where("tenant_id", "=", tenantId)
    .where("patient_id", "=", patientId)
    .where("channel", "=", channel)
    .where("status", "=", "pending")
    .executeTakeFirst();
  const n = Number(r.numUpdatedRows);
  if (n > 0) {
    await pmsAudit(ctx, tenantId, actor, { action: "pms.message_schedule.sync", targetType: "pms_patient", targetId: patientId, detail: { cancelled: n, channel, reason } });
  }
  return n;
}
