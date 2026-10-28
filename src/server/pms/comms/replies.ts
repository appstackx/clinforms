/**
 * A text reply from a patient (the SMS provider's webhook, or the "simulate a reply" test tool on a message):
 *
 * 1. stored once (a webhook delivered twice is recognised by the provider's message id);
 * 2. matched to the latest text the clinic sent to that number in the last REPLY_WINDOW_DAYS (its patient and
 *    appointment), else to the one active patient with that mobile number, else left unmatched;
 * 3. read: YES confirms (no action needed when it matched an appointment), NO asks to cancel and anything unclear
 *    go to the clinic's "to action" list, STOP switches texts off (appointment texts and marketing texts) with a
 *    record of how (pms_consent_events).
 *
 * Nothing in the diary changes by itself: the diary reads the replies (appointmentReplyStates) and staff act.
 */
import { interpretReply, replyNeedsAction } from "../../../modules/pms/comms/replies";
import { APPOINTMENT_MESSAGE_KINDS, InboundSmsSchema, type InboundSms } from "../../../modules/pms/comms/schemas";
import { smsAddressKey } from "../../../modules/pms/comms/sms";
import type { ReplyIntent } from "../../../modules/pms/comms/types";
import type { PmsActor } from "../../../modules/pms/core/types";
import { RepoInputError, nowIso, parseInput, pmsAuditQuery, writeWithAudit, type RepoContext } from "../../repos/pms/context";
import { changeConsent } from "../../repos/pms/comms/consent";
import { findPatientsByMobile } from "../../repos/pms/comms/contacts";
import { findByProviderMessageId, findReplyTarget, getMessage, inboundInsertQuery } from "../../repos/pms/comms/messages";
import { SYSTEM_ACTOR, sendStopConfirmation, type DispatchDeps } from "./dispatch";

export const REPLY_WINDOW_DAYS = 14;

export interface InboundResult {
  messageId: string;
  intent: ReplyIntent;
  patientId: string | null;
  appointmentId: string | null;
  duplicate: boolean;
  needsAction: boolean;
}

export async function recordInboundSms(ctx: RepoContext, tenantId: string, input: InboundSms, provider: string, actor: PmsActor = SYSTEM_ACTOR, deps?: DispatchDeps): Promise<InboundResult> {
  const d = parseInput(InboundSmsSchema, input, "Reply");
  const key = smsAddressKey(d.from);
  if (!/^\d{8,15}$/.test(key)) throw new RepoInputError("Reply: the sender's number is not a phone number.");
  if (d.providerMessageId) {
    const seen = await findByProviderMessageId(ctx, tenantId, provider, d.providerMessageId);
    if (seen) {
      return { messageId: seen.id, intent: seen.replyIntent ?? "unknown", patientId: seen.patientId, appointmentId: seen.appointmentId, duplicate: true, needsAction: seen.actionStatus === "to_action" };
    }
  }
  const at = nowIso(ctx);
  let target = null as Awaited<ReturnType<typeof findReplyTarget>>;
  if (d.inReplyToId) {
    const m = await getMessage(ctx, tenantId, d.inReplyToId);
    if (!m || m.direction !== "outbound" || m.channel !== "sms") throw new RepoInputError("Reply: that message is not a text the clinic sent.");
    if (m.patientId && key !== (m.toAddress ? smsAddressKey(m.toAddress) : key)) throw new RepoInputError("Reply: the number does not match the text it answers.");
    target = m;
  } else {
    target = await findReplyTarget(ctx, tenantId, key, new Date(Date.parse(at) - REPLY_WINDOW_DAYS * 86_400_000).toISOString());
  }
  let patientId = target?.patientId ?? null;
  if (!patientId) {
    const matches = await findPatientsByMobile(ctx, tenantId, key);
    if (matches.length === 1) patientId = matches[0];
  }
  const appointmentId = target && (APPOINTMENT_MESSAGE_KINDS as readonly string[]).includes(target.kind) ? target.appointmentId : null;
  const intent = interpretReply(d.text);
  const needsAction = replyNeedsAction(intent, Boolean(appointmentId)) || !patientId;
  const { id, query } = inboundInsertQuery(ctx, tenantId, {
    patientId,
    inReplyToId: target?.id ?? null,
    appointmentId,
    fromAddress: d.from,
    addressKey: key,
    body: d.text,
    provider,
    providerMessageId: d.providerMessageId ?? null,
    intent,
    actionStatus: needsAction ? "to_action" : "none",
    receivedAt: d.receivedAt ? new Date(d.receivedAt).toISOString() : at,
  });
  await writeWithAudit(
    ctx,
    [
      query,
      pmsAuditQuery(ctx, tenantId, actor, {
        action: "pms.message.receive",
        targetType: "pms_message",
        targetId: id,
        detail: { intent, matched: Boolean(patientId), appointment: Boolean(appointmentId), provider, patientId },
      }),
    ],
    { unique: "This reply has already been recorded." },
  );
  if (intent === "stop" && patientId) {
    // STOP ends texts from the clinic: appointment texts and marketing texts.
    await changeConsent(ctx, tenantId, { patientId, channel: "sms", purpose: "service", value: false, source: "sms_reply", messageId: id }, actor);
    await changeConsent(ctx, tenantId, { patientId, channel: "sms", purpose: "marketing", value: false, source: "sms_reply", messageId: id }, actor);
    if (deps) await sendStopConfirmation(ctx, tenantId, patientId, actor, deps);
  }
  return { messageId: id, intent, patientId, appointmentId, duplicate: false, needsAction };
}
