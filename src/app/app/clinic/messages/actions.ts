"use server";
/**
 * The Messages screens' server actions. Each one: the member, the clinic's package and the permission first
 * (contract §6), then src/server/pms/comms/{views,writes,billing-mail}.ts, which check the permission and the
 * member's sites again, validate the input and write the change with its audit row. Answers: { ok: true, … } or
 * { ok: false, error } in plain words – never an internal error. Nothing leaves the system (outbox / test only).
 */
import { revalidatePath } from "next/cache";
import type { ReplyThreadView, SendFormView } from "@/modules/pms/comms/view";
import { CLINIC_BASE_PATH } from "@/modules/pms/core/modules";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { emailInvoiceFor, emailReceiptFor, emailStatementFor, sendPaymentLinkFor } from "@/server/pms/comms/billing-mail";
import { messageDetailFor, replyThreadFor, sendFormFor } from "@/server/pms/comms/views";
import { searchPatientsFor } from "@/server/pms/records/patients-service";
import {
  answerReplyFor,
  createTemplateFor,
  markReplyDoneFor,
  retryMessageFor,
  runDueNowFor,
  saveMessageSettingsFor,
  saveReminderRuleFor,
  saveTemplateFor,
  sendMessageFor,
  type SentAnswer,
} from "@/server/pms/comms/writes";

export type CommsActionResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string; fieldErrors?: Record<string, string> };

const MESSAGES = `${CLINIC_BASE_PATH}/messages`;

function refresh(patientId?: string | null) {
  revalidatePath(MESSAGES);
  if (patientId) revalidatePath(`${CLINIC_BASE_PATH}/patients/${patientId}/messages`);
}

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");

/** "To": a quick patient search (name, number, date of birth) for Send a message and New letter. */
export async function searchPatientsAction(q: string): Promise<CommsActionResult<{ hits: { id: string; name: string; number: number; dateOfBirth: string | null }[] }>> {
  const actor = await clinicActionActor({ permission: "messages.send" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const text = str(q, 80).trim();
  if (text.length < 2) return { ok: true, hits: [] };
  const r = await searchPatientsFor(actor, { q: text, status: "active", limit: 10 });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, hits: r.value.map((p) => ({ id: p.id, name: `${(p.preferredName ?? "").trim() || p.firstName} ${p.lastName}`, number: p.patientNumber, dateOfBirth: p.dateOfBirth })) };
}

export async function loadSendFormAction(patientId: string | null): Promise<CommsActionResult<{ view: SendFormView }>> {
  const actor = await clinicActionActor({ permission: "messages.send" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await sendFormFor(actor, patientId ? str(patientId, 80) : null);
  return r.ok ? { ok: true, view: r.value } : { ok: false, error: r.error };
}

export async function sendMessageAction(input: { patientId: string; channel: "sms" | "email"; purpose?: "service" | "marketing"; templateId?: string | null; subject?: string | null; body: string }): Promise<CommsActionResult<{ sent: SentAnswer }>> {
  const actor = await clinicActionActor({ permission: "messages.send" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await sendMessageFor(actor, input);
  if (!r.ok) return { ok: false, error: r.error, fieldErrors: r.fieldErrors };
  refresh(input.patientId);
  return { ok: true, sent: r.value };
}

export async function loadThreadAction(replyId: string): Promise<CommsActionResult<{ thread: ReplyThreadView }>> {
  const actor = await clinicActionActor({ permission: "messages.send" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await replyThreadFor(actor, str(replyId, 80));
  return r.ok ? { ok: true, thread: r.value } : { ok: false, error: r.error };
}

export async function answerReplyAction(replyId: string, body: string): Promise<CommsActionResult<{ sent: SentAnswer }>> {
  const actor = await clinicActionActor({ permission: "messages.send" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await answerReplyFor(actor, { replyId: str(replyId, 80), body: str(body, 1000) });
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  return { ok: true, sent: r.value };
}

export async function markReplyDoneAction(replyId: string): Promise<CommsActionResult> {
  const actor = await clinicActionActor({ permission: "messages.send" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await markReplyDoneFor(actor, str(replyId, 80));
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  return { ok: true };
}

export async function retryMessageAction(messageId: string): Promise<CommsActionResult<{ sent: SentAnswer }>> {
  const actor = await clinicActionActor({ permission: "messages.send" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await retryMessageFor(actor, str(messageId, 80));
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  return { ok: true, sent: r.value };
}

export async function loadMessageAction(messageId: string): Promise<CommsActionResult<{ subject: string | null; body: string; to: string | null; summary: string }>> {
  const actor = await clinicActionActor({ permission: "messages.send" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await messageDetailFor(actor, str(messageId, 80));
  return r.ok ? { ok: true, subject: r.value.message.subject, body: r.value.message.body, to: r.value.message.toAddress, summary: r.value.summary } : { ok: false, error: r.error };
}

export async function runDueNowAction(): Promise<CommsActionResult<{ message: string }>> {
  const actor = await clinicActionActor({ permission: "messages.templates" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await runDueNowFor(actor);
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  const v = r.value;
  return { ok: true, message: v.claimed === 0 && v.released === 0 ? "Nothing was due." : `${v.sent} sent, ${v.outbox} kept in the outbox, ${v.failed} failed, ${v.skipped} not sent.` };
}

export async function saveTemplateAction(input: { id: string; rev: number; name?: string; subject?: string | null; body: string }): Promise<CommsActionResult<{ id: string; rev: number }>> {
  const actor = await clinicActionActor({ permission: "messages.templates" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await saveTemplateFor(actor, input);
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  return { ok: true, ...r.value };
}

export async function createTemplateAction(input: { kind: "general" | "marketing"; channel: "sms" | "email"; name: string; subject?: string | null; body: string }): Promise<CommsActionResult<{ id: string }>> {
  const actor = await clinicActionActor({ permission: "messages.templates" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await createTemplateFor(actor, input);
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  return { ok: true, ...r.value };
}

export async function saveSettingsAction(rev: number, input: Record<string, unknown>): Promise<CommsActionResult<{ rev: number }>> {
  const actor = await clinicActionActor({ permission: "messages.templates" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await saveMessageSettingsFor(actor, rev, input);
  if (!r.ok) return { ok: false, error: r.error, fieldErrors: r.fieldErrors };
  refresh();
  revalidatePath(`${MESSAGES}/settings`);
  return { ok: true, ...r.value };
}

export async function saveReminderRuleAction(input: Record<string, unknown>): Promise<CommsActionResult<{ id: string }>> {
  const actor = await clinicActionActor({ permission: "messages.templates" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await saveReminderRuleFor(actor, input);
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath(`${MESSAGES}/settings`);
  return { ok: true, ...r.value };
}

/* Billing's messages (the buttons billing switched off until Messages existed). */

export async function emailInvoiceAction(invoiceId: string): Promise<CommsActionResult<{ sent: SentAnswer }>> {
  const actor = await clinicActionActor({ permission: "billing.view" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await emailInvoiceFor(actor, str(invoiceId, 80));
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  return { ok: true, sent: r.value };
}

export async function emailStatementAction(who: { patientId: string } | { payerReferrerId: string }, from: string, until: string): Promise<CommsActionResult<{ sent: SentAnswer }>> {
  const actor = await clinicActionActor({ permission: "billing.view" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const target = "patientId" in who ? { patientId: str(who.patientId, 80) } : { payerReferrerId: str(who.payerReferrerId, 80) };
  const r = await emailStatementFor(actor, target, str(from, 10), str(until, 10));
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  return { ok: true, sent: r.value };
}

export async function emailReceiptAction(paymentId: string): Promise<CommsActionResult<{ sent: SentAnswer }>> {
  const actor = await clinicActionActor({ permission: "billing.view" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await emailReceiptFor(actor, str(paymentId, 80));
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  return { ok: true, sent: r.value };
}

export async function sendPaymentLinkAction(invoiceId: string, channel: "sms" | "email"): Promise<CommsActionResult<{ sent: SentAnswer }>> {
  const actor = await clinicActionActor({ permission: "billing.pay" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await sendPaymentLinkFor(actor, str(invoiceId, 80), channel === "email" ? "email" : "sms");
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  return { ok: true, sent: r.value };
}
