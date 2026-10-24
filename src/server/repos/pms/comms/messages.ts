/**
 * `pms_messages` – the message log: every message written to a patient (in the outbox, sent, delivered, failed)
 * and every reply received. Subject and body are encrypted (subject_enc, body_enc – AAD bound to the row);
 * lists return summaries and never decrypt. Messages are never deleted (they belong to the patient's record).
 *
 * Writing order for a send (the outbox pattern): the row is written first – status "queued", or "outbox" when the
 * outbox provider is in use – together with its audit row; then the provider is called; then the outcome is
 * written (sent / failed) with its own audit row. A crash in between leaves a visible "queued" row, never a
 * message sent with no record of it.
 */
import type { Selectable } from "kysely";
import { COMMS_ID_PREFIXES as P } from "../../../../modules/pms/comms/ids";
import type {
  ActionStatus,
  Message,
  MessageChannel,
  MessageDirection,
  MessageKind,
  MessagePurpose,
  MessageStatus,
  MessageSummary,
  ReplyIntent,
} from "../../../../modules/pms/comms/types";
import type { PmsActor } from "../../../../modules/pms/core/types";
import type { BatchQuery } from "../../../db/batch";
import { runBatch } from "../../../db/batch";
import type { PmsMessagesTable } from "../../../db/pms-schema/comms";
import { RepoInputError, assertId, assertTenantId, decryptField, encryptField, nowIso, numOrNull, pmsAudit, pmsAuditQuery, pmsId, writeWithAudit, type DbContext, type RepoContext } from "../context";

const T = "pms_messages";
const MESSAGES = { foreignKey: "The patient or template does not exist in this clinic.", unique: "This message has already been recorded." };

const SUMMARY_COLUMNS = [
  "tenant_id",
  "id",
  "patient_id",
  "direction",
  "channel",
  "purpose",
  "kind",
  "template_id",
  "appointment_id",
  "in_reply_to_id",
  "to_address",
  "from_address",
  "segments",
  "status",
  "provider",
  "error_code",
  "reply_intent",
  "action_status",
  "sent_at",
  "delivered_at",
  "created_by",
  "created_at",
] as const;

type Row = Selectable<PmsMessagesTable>;

function toSummary(r: Pick<Row, (typeof SUMMARY_COLUMNS)[number]>): MessageSummary {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    patientId: r.patient_id,
    direction: r.direction as MessageDirection,
    channel: r.channel as MessageChannel,
    purpose: r.purpose as MessagePurpose,
    kind: r.kind as MessageKind,
    templateId: r.template_id,
    appointmentId: r.appointment_id,
    inReplyToId: r.in_reply_to_id,
    toAddress: r.to_address,
    fromAddress: r.from_address,
    segments: numOrNull(r.segments),
    status: r.status as MessageStatus,
    provider: r.provider,
    errorCode: r.error_code,
    replyIntent: (r.reply_intent as ReplyIntent | null) ?? null,
    actionStatus: (r.action_status as ActionStatus) ?? "none",
    sentAt: r.sent_at,
    deliveredAt: r.delivered_at,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

function toMessage(ctx: Pick<RepoContext, "cipher">, r: Row): Message {
  return {
    ...toSummary(r),
    subject: decryptField(ctx, r.tenant_id, T, "subject_enc", r.id, r.subject_enc),
    body: decryptField(ctx, r.tenant_id, T, "body_enc", r.id, r.body_enc) ?? "",
    providerMessageId: r.provider_message_id,
    actionedBy: r.actioned_by,
    actionedAt: r.actioned_at,
    failedAt: r.failed_at,
    updatedAt: r.updated_at,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Outbound
 * ----------------------------------------------------------------------------------------------*/

export interface OutboundDraft {
  patientId: string;
  channel: MessageChannel;
  purpose: MessagePurpose;
  kind: Exclude<MessageKind, "reply">;
  /** A clinic template's id (never a standard one). */
  templateId: string | null;
  appointmentId: string | null;
  toAddress: string;
  /** Phone digits or the lower-case email (replies are matched on it). */
  addressKey: string;
  subject: string | null;
  body: string;
  segments: number | null;
  /** "queued" before the provider is called; "outbox" when the outbox provider keeps it. */
  status: "queued" | "outbox";
  provider: string;
}

/** The INSERT of an outbound message (for a batch). The body is encrypted here. */
export function outboundInsertQuery(ctx: RepoContext, tenantId: string, draft: OutboundDraft, actor: PmsActor): { id: string; query: BatchQuery } {
  assertTenantId(tenantId);
  if (!draft.body) throw new RepoInputError("A message needs some text.");
  const id = pmsId(P.message, ctx);
  const at = nowIso(ctx);
  const query = ctx.db.insertInto(T).values({
    tenant_id: tenantId,
    id,
    patient_id: draft.patientId,
    direction: "outbound",
    channel: draft.channel,
    purpose: draft.purpose,
    kind: draft.kind,
    template_id: draft.templateId,
    appointment_id: draft.appointmentId,
    in_reply_to_id: null,
    to_address: draft.toAddress,
    from_address: null,
    address_key: draft.addressKey,
    subject_enc: draft.channel === "email" ? encryptField(ctx, tenantId, T, "subject_enc", id, draft.subject) : null,
    body_enc: encryptField(ctx, tenantId, T, "body_enc", id, draft.body) as string,
    segments: draft.segments,
    status: draft.status,
    provider: draft.provider,
    provider_message_id: null,
    error_code: null,
    reply_intent: null,
    action_status: "none",
    actioned_by: null,
    actioned_at: null,
    sent_at: draft.status === "outbox" ? at : null,
    delivered_at: null,
    failed_at: null,
    created_by: actor.userId,
    created_at: at,
    updated_at: at,
  });
  return { id, query };
}

/** Writes one outbound message with its audit row ("pms.message.send"). */
export async function createOutboundMessage(ctx: RepoContext, tenantId: string, draft: OutboundDraft, actor: PmsActor): Promise<string> {
  const { id, query } = outboundInsertQuery(ctx, tenantId, draft, actor);
  await writeWithAudit(
    ctx,
    [
      query,
      pmsAuditQuery(ctx, tenantId, actor, {
        action: "pms.message.send",
        targetType: "pms_message",
        targetId: id,
        detail: { channel: draft.channel, kind: draft.kind, purpose: draft.purpose, status: draft.status, provider: draft.provider, patientId: draft.patientId },
      }),
    ],
    MESSAGES,
  );
  return id;
}

export type SendOutcome = { status: "outbox" } | { status: "sent"; providerMessageId: string } | { status: "failed"; errorCode: string };

/** The UPDATE that records a provider's answer for a queued message (for a batch). */
export function outcomeUpdateQuery(ctx: DbContext, tenantId: string, id: string, outcome: SendOutcome): BatchQuery {
  const at = nowIso(ctx);
  const set =
    outcome.status === "sent"
      ? { status: "sent", provider_message_id: outcome.providerMessageId, sent_at: at, updated_at: at }
      : outcome.status === "failed"
        ? { status: "failed", error_code: outcome.errorCode.slice(0, 40), failed_at: at, updated_at: at }
        : { status: "outbox", sent_at: at, updated_at: at };
  return ctx.db.updateTable(T).set(set).where("tenant_id", "=", tenantId).where("id", "=", id).where("status", "=", "queued");
}

/** Records the providers' answers for queued messages, with one audit row for the lot. */
export async function recordSendOutcomes(ctx: DbContext, tenantId: string, outcomes: readonly { id: string; outcome: SendOutcome }[], actor: PmsActor): Promise<void> {
  assertTenantId(tenantId);
  if (outcomes.length === 0) return;
  for (let i = 0; i < outcomes.length; i += 40) {
    const chunk = outcomes.slice(i, i + 40);
    const counts = { sent: 0, failed: 0, outbox: 0 };
    for (const o of chunk) counts[o.outcome.status] += 1;
    await runBatch(ctx.db, [
      ...chunk.map((o) => outcomeUpdateQuery(ctx, tenantId, o.id, o.outcome)),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.message.status", targetType: "pms_message", targetId: chunk[0].id, detail: { count: chunk.length, ...counts } }),
    ]);
  }
}

/** A delivery receipt from the provider (delivered / failed), found by the provider's message id. */
export async function recordDeliveryReceipt(
  ctx: DbContext,
  tenantId: string,
  provider: string,
  receipt: { providerMessageId: string; status: "delivered" | "failed"; errorCode?: string | null; at?: string | null },
  actor: PmsActor,
): Promise<boolean> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  const row = await ctx.db
    .selectFrom(T)
    .select(["id", "status"])
    .where("tenant_id", "=", tenantId)
    .where("provider", "=", provider)
    .where("provider_message_id", "=", receipt.providerMessageId)
    .where("direction", "=", "outbound")
    .executeTakeFirst();
  if (!row || (row.status !== "sent" && row.status !== "delivered")) return false;
  const set =
    receipt.status === "delivered"
      ? { status: "delivered", delivered_at: receipt.at ?? at, updated_at: at }
      : { status: "failed", failed_at: receipt.at ?? at, error_code: (receipt.errorCode ?? "undelivered").slice(0, 40), updated_at: at };
  const result = await ctx.db.updateTable(T).set(set).where("tenant_id", "=", tenantId).where("id", "=", row.id).where("status", "in", ["sent", "delivered"]).executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) return false;
  await pmsAudit(ctx, tenantId, actor, { action: "pms.message.status", targetType: "pms_message", targetId: row.id, detail: { status: receipt.status, source: "receipt" } });
  return true;
}

/* ------------------------------------------------------------------------------------------------
 * Inbound
 * ----------------------------------------------------------------------------------------------*/

export interface InboundDraft {
  patientId: string | null;
  inReplyToId: string | null;
  appointmentId: string | null;
  fromAddress: string;
  addressKey: string;
  body: string;
  provider: string;
  providerMessageId: string | null;
  intent: ReplyIntent;
  actionStatus: ActionStatus;
  receivedAt: string;
}

export function inboundInsertQuery(ctx: RepoContext, tenantId: string, draft: InboundDraft): { id: string; query: BatchQuery } {
  assertTenantId(tenantId);
  const id = pmsId(P.message, ctx);
  const at = nowIso(ctx);
  const query = ctx.db.insertInto(T).values({
    tenant_id: tenantId,
    id,
    patient_id: draft.patientId,
    direction: "inbound",
    channel: "sms",
    purpose: "service",
    kind: "reply",
    template_id: null,
    appointment_id: draft.appointmentId,
    in_reply_to_id: draft.inReplyToId,
    to_address: null,
    from_address: draft.fromAddress,
    address_key: draft.addressKey,
    subject_enc: null,
    // An empty text is stored as one space (the column needs ciphertext).
    body_enc: encryptField(ctx, tenantId, T, "body_enc", id, draft.body === "" ? " " : draft.body) as string,
    segments: null,
    status: "received",
    provider: draft.provider,
    provider_message_id: draft.providerMessageId,
    error_code: null,
    reply_intent: draft.intent,
    action_status: draft.actionStatus,
    actioned_by: null,
    actioned_at: null,
    sent_at: draft.receivedAt,
    delivered_at: null,
    failed_at: null,
    created_by: null,
    created_at: at,
    updated_at: at,
  });
  return { id, query };
}

/** An inbound message already stored under this provider id (a webhook delivered twice). */
export async function findByProviderMessageId(ctx: DbContext, tenantId: string, provider: string, providerMessageId: string): Promise<MessageSummary | null> {
  assertTenantId(tenantId);
  const r = await ctx.db
    .selectFrom(T)
    .select(SUMMARY_COLUMNS)
    .where("tenant_id", "=", tenantId)
    .where("provider", "=", provider)
    .where("provider_message_id", "=", providerMessageId)
    .executeTakeFirst();
  return r ? toSummary(r) : null;
}

/** The latest text sent to a number since a time that invited a reply (what an inbound text answers). */
export async function findReplyTarget(ctx: DbContext, tenantId: string, addressKey: string, sinceIso: string): Promise<MessageSummary | null> {
  assertTenantId(tenantId);
  const r = await ctx.db
    .selectFrom(T)
    .select(SUMMARY_COLUMNS)
    .where("tenant_id", "=", tenantId)
    .where("address_key", "=", addressKey)
    .where("direction", "=", "outbound")
    .where("channel", "=", "sms")
    .where("created_at", ">=", sinceIso)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  return r ? toSummary(r) : null;
}

/** Marks a reply as dealt with (only replies waiting for action). */
export async function markReplyDone(ctx: DbContext, tenantId: string, id: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "message id");
  const at = nowIso(ctx);
  const result = await ctx.db
    .updateTable(T)
    .set({ action_status: "done", actioned_by: actor.userId, actioned_at: at, updated_at: at })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .where("action_status", "=", "to_action")
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) return false;
  await pmsAudit(ctx, tenantId, actor, { action: "pms.message.reply_done", targetType: "pms_message", targetId: id });
  return true;
}

/* ------------------------------------------------------------------------------------------------
 * Reading
 * ----------------------------------------------------------------------------------------------*/

export interface ListMessagesOptions {
  patientId?: string;
  direction?: MessageDirection;
  channel?: MessageChannel;
  kind?: MessageKind;
  status?: MessageStatus;
  actionStatus?: ActionStatus;
  appointmentId?: string;
  /** Keyset paging: messages older than this id (newest first). */
  beforeId?: string;
  /** Default 50, at most 200. */
  limit?: number;
}

/** Messages, newest first (summaries – nothing decrypted). */
export async function listMessages(ctx: DbContext, tenantId: string, options: ListMessagesOptions = {}): Promise<MessageSummary[]> {
  assertTenantId(tenantId);
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 50)), 200);
  let q = ctx.db.selectFrom(T).select(SUMMARY_COLUMNS).where("tenant_id", "=", tenantId);
  if (options.patientId) q = q.where("patient_id", "=", options.patientId);
  if (options.direction) q = q.where("direction", "=", options.direction);
  if (options.channel) q = q.where("channel", "=", options.channel);
  if (options.kind) q = q.where("kind", "=", options.kind);
  if (options.status) q = q.where("status", "=", options.status);
  if (options.actionStatus) q = q.where("action_status", "=", options.actionStatus);
  if (options.appointmentId) q = q.where("appointment_id", "=", options.appointmentId);
  if (options.beforeId) q = q.where("id", "<", options.beforeId);
  return (await q.orderBy("id", "desc").limit(limit).execute()).map(toSummary);
}

/** One message, subject and body decrypted. */
export async function getMessage(ctx: RepoContext, tenantId: string, id: string): Promise<Message | null> {
  assertTenantId(tenantId);
  const r = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return r ? toMessage(ctx, r) : null;
}

/** Replies to a message (summaries, oldest first). */
export async function listRepliesTo(ctx: DbContext, tenantId: string, messageId: string): Promise<MessageSummary[]> {
  assertTenantId(tenantId);
  return (
    await ctx.db.selectFrom(T).select(SUMMARY_COLUMNS).where("tenant_id", "=", tenantId).where("in_reply_to_id", "=", messageId).orderBy("id").limit(50).execute()
  ).map(toSummary);
}

/** Message counts for the overview: waiting for action, in the outbox, failed. */
export async function messageCounts(ctx: DbContext, tenantId: string): Promise<{ toAction: number; outbox: number; failed: number; queued: number }> {
  assertTenantId(tenantId);
  const rows = await ctx.db
    .selectFrom(T)
    .select((eb) => ["status", "action_status", eb.fn.countAll<number>().as("n")])
    .where("tenant_id", "=", tenantId)
    .groupBy(["status", "action_status"])
    .execute();
  const out = { toAction: 0, outbox: 0, failed: 0, queued: 0 };
  for (const r of rows) {
    const n = Number(r.n);
    if (r.action_status === "to_action") out.toAction += n;
    if (r.status === "outbox") out.outbox += n;
    if (r.status === "failed") out.failed += n;
    if (r.status === "queued") out.queued += n;
  }
  return out;
}

/**
 * The latest reply per appointment (for the diary: "confirmed by text", "asked to cancel"). In groups of 90.
 */
export async function appointmentReplyStates(ctx: DbContext, tenantId: string, appointmentIds: readonly string[]): Promise<Map<string, { intent: ReplyIntent; at: string; messageId: string; actionStatus: ActionStatus }>> {
  assertTenantId(tenantId);
  const out = new Map<string, { intent: ReplyIntent; at: string; messageId: string; actionStatus: ActionStatus }>();
  const unique = Array.from(new Set(appointmentIds));
  for (let i = 0; i < unique.length; i += 90) {
    const rows = await ctx.db
      .selectFrom(T)
      .select(["id", "appointment_id", "reply_intent", "action_status", "created_at"])
      .where("tenant_id", "=", tenantId)
      .where("direction", "=", "inbound")
      .where("appointment_id", "in", unique.slice(i, i + 90))
      .orderBy("id")
      .execute();
    for (const r of rows) {
      if (!r.appointment_id || !r.reply_intent || r.reply_intent === "stop") continue;
      out.set(r.appointment_id, { intent: r.reply_intent as ReplyIntent, at: r.created_at, messageId: r.id, actionStatus: (r.action_status as ActionStatus) ?? "none" });
    }
  }
  return out;
}
