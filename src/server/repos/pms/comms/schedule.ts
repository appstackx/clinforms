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
import { assertTenantId, nowIso, num, parseInput, pmsAuditQuery, pmsId, writeWithAudit, type DbContext } from "../context";
import { inPatientScope } from "./messages";
import { changeWithAudit, commsAuditWhen } from "./shared";
import { listReminderRules } from "./rules";
import { getCommsSettings } from "./settings";

const T = "pms_message_schedule";
export const STALE_CLAIM_MINUTES = 10;
const SYSTEM: PmsActor = { userId: null, sessionId: null };
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
    held: num(r.held ?? 0) === 1,
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
  options: { notify?: "none" | "confirmation" | "moved" | "cancelled" | "late_cancelled" | "dna" } = {},
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
  // Moved before its booking confirmation went out: the confirmation goes for the new time instead of a "moved"
  // notice (the patient has not heard of the old time yet).
  const confirmationPending = existing.some((r) => r.kind === "confirmation" && (r.status === "pending" || r.status === "processing"));
  const effective = notify === "moved" && confirmationPending ? "confirmation" : notify;
  const plan = planAppointmentMessages({ appointment: { startsAt: appt.startsAt, serviceId: appt.serviceId ?? null, active: appt.active }, notify: effective, settings, rules, now: at });
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
  // A notice still waiting to go (a confirmation held for quiet hours, a cancellation notice…) stays while it is
  // still true – a later sync that does not ask for it again (a details change, the run's reconcile sweep, M9b)
  // must not cancel it: a confirmation or "moved" notice of the current start while the appointment is booked; a
  // cancellation or did-not-attend notice while it is not.
  const stillTrue = (r: (typeof existing)[number]) =>
    appt.active
      ? (r.kind === "confirmation" || r.kind === "moved") && new Date(r.starts_at).toISOString() === snapshot.starts_at
      : r.kind === "cancelled" || r.kind === "late_cancelled" || r.kind === "dna";
  for (const r of existing) {
    if (r.status !== "pending" || wanted.has(r.dedupe_key) || stillTrue(r)) continue;
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
          held: p.held ? 1 : 0,
          created_at: at,
          updated_at: at,
        }),
      );
      planned++;
    } else if (row.status === "cancelled") {
      queries.push(
        ctx.db
          .updateTable(T)
          .set({ status: "pending", due_at: p.dueAt, held: p.held ? 1 : 0, skip_reason: null, patient_id: appt.patientId, ...snapshot, updated_at: at })
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
            .set({ due_at: p.dueAt, held: p.held ? 1 : 0, ...snapshot, updated_at: at })
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
  // A run that died mid-way leaves rows claimed: release them – or, after MAX_ATTEMPTS, give up on them (that change
  // is audited in its batch). Claiming and releasing are the run's own bookkeeping (status processing ↔ pending, no
  // patient-visible change) and are not audited; every claimed row ends in an audited batch (dispatch.ts).
  await changeWithAudit(ctx, [
    ctx.db
      .updateTable(T)
      .set({ status: "failed", skip_reason: "provider_error", updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "processing")
      .where("claimed_at", "<", stale)
      .where("attempts", ">=", MAX_ATTEMPTS),
    commsAuditWhen(
      ctx,
      tenantId,
      SYSTEM,
      { action: "pms.message_schedule.give_up", targetType: "pms_message_schedule", targetId: null, detail: { attempts: MAX_ATTEMPTS } },
      ctx.db.selectFrom(T).select("id").where("tenant_id", "=", tenantId).where("status", "=", "failed").where("updated_at", "=", at),
    ),
  ]);
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

/**
 * Cancels the planned messages of a patient on a channel after they opted out of it (`kinds`: only these – the
 * stop-emails link stops reminders and follow-ups, not booking confirmations). Change and audit in one batch.
 */
export async function cancelPendingForPatient(
  ctx: DbContext,
  tenantId: string,
  patientId: string,
  channel: MessageChannel,
  reason: SkipReason,
  actor: PmsActor,
  kinds?: readonly AppointmentMessageKind[],
): Promise<number> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  let update = ctx.db
    .updateTable(T)
    .set({ status: "cancelled", skip_reason: reason, updated_at: at })
    .where("tenant_id", "=", tenantId)
    .where("patient_id", "=", patientId)
    .where("channel", "=", channel)
    .where("status", "=", "pending");
  if (kinds) update = update.where("kind", "in", kinds as AppointmentMessageKind[]);
  return changeWithAudit(ctx, [
    update,
    commsAuditWhen(
      ctx,
      tenantId,
      actor,
      { action: "pms.message_schedule.opt_out", targetType: "pms_patient", targetId: patientId, detail: { channel, reason } },
      ctx.db.selectFrom(T).select("id").where("tenant_id", "=", tenantId).where("patient_id", "=", patientId).where("status", "=", "cancelled").where("skip_reason", "=", reason).where("updated_at", "=", at),
    ),
  ]);
}

export interface ScheduleListOptions {
  statuses?: readonly ScheduleStatus[];
  /** Due at or after / before these instants. */
  dueFrom?: string;
  dueUntil?: string;
  /** Changed at or after this instant (skipped / cancelled today). */
  updatedSince?: string;
  patientId?: string;
  appointmentId?: string;
  siteIds?: ReadonlySet<string> | null;
  /** Default 100, at most 500. */
  limit?: number;
}

/** Planned messages for the outbox and the record (by due time). */
export async function listSchedule(ctx: DbContext, tenantId: string, options: ScheduleListOptions = {}): Promise<ScheduledMessage[]> {
  assertTenantId(tenantId);
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 100)), 500);
  let q = ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId);
  if (options.statuses && options.statuses.length) q = q.where("status", "in", options.statuses as ScheduleStatus[]);
  if (options.dueFrom) q = q.where("due_at", ">=", options.dueFrom);
  if (options.dueUntil) q = q.where("due_at", "<", options.dueUntil);
  if (options.updatedSince) q = q.where("updated_at", ">=", options.updatedSince);
  if (options.patientId) q = q.where("patient_id", "=", options.patientId);
  if (options.appointmentId) q = q.where("appointment_id", "=", options.appointmentId);
  if (options.siteIds) q = q.where(inPatientScope(ctx, tenantId, options.siteIds));
  return (await q.orderBy("due_at").orderBy("id").limit(limit).execute()).map(toScheduled);
}

/** The outbox's "Today" line: planned (still to go today), held for quiet hours, skipped and cancelled today. */
export async function scheduleCounts(
  ctx: DbContext,
  tenantId: string,
  window: { from: string; until: string },
  siteIds: ReadonlySet<string> | null = null,
): Promise<{ planned: number; held: number; skipped: number; optedOut: number }> {
  assertTenantId(tenantId);
  let pending = ctx.db
    .selectFrom(T)
    .select((eb) => ["held", eb.fn.countAll<number>().as("n")])
    .where("tenant_id", "=", tenantId)
    .where("status", "=", "pending")
    .where("due_at", ">=", window.from)
    .where("due_at", "<", window.until);
  if (siteIds) pending = pending.where(inPatientScope(ctx, tenantId, siteIds));
  let skipped = ctx.db
    .selectFrom(T)
    .select((eb) => ["skip_reason", eb.fn.countAll<number>().as("n")])
    .where("tenant_id", "=", tenantId)
    .where("status", "=", "skipped")
    .where("updated_at", ">=", window.from)
    .where("updated_at", "<", window.until);
  if (siteIds) skipped = skipped.where(inPatientScope(ctx, tenantId, siteIds));
  const [p, k] = await Promise.all([pending.groupBy("held").execute(), skipped.groupBy("skip_reason").execute()]);
  const out = { planned: 0, held: 0, skipped: 0, optedOut: 0 };
  for (const r of p) {
    out.planned += Number(r.n);
    if (num(r.held) === 1) out.held += Number(r.n);
  }
  for (const r of k) {
    out.skipped += Number(r.n);
    if (r.skip_reason === "opted_out") out.optedOut += Number(r.n);
  }
  return out;
}

/** The planned rows that became these messages (what each message was for: its appointment's start). */
export async function scheduleByMessageIds(ctx: DbContext, tenantId: string, messageIds: readonly string[]): Promise<Map<string, ScheduledMessage>> {
  assertTenantId(tenantId);
  const out = new Map<string, ScheduledMessage>();
  const unique = Array.from(new Set(messageIds));
  for (let i = 0; i < unique.length; i += 90) {
    const rows = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("message_id", "in", unique.slice(i, i + 90)).execute();
    for (const r of rows) if (r.message_id) out.set(r.message_id, toScheduled(r));
  }
  return out;
}
