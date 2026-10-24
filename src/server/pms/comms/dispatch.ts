/**
 * Sending: a message staff write for one patient (sendPatientMessage) and the run that sends the planned
 * appointment messages that are due (runDueMessages – the cron route and the "Send due messages now" button).
 *
 * Both check, at the moment of sending, what the patient agreed to (PECR – src/modules/pms/comms/consent.ts),
 * write the message with its audit row BEFORE calling the provider (the outbox pattern, ../../repos/pms/comms/
 * messages.ts) and record the provider's answer after. With the outbox provider (the default) nothing leaves the
 * system: the message is kept with status "outbox".
 */
import { randomBytes } from "node:crypto";
import { addressFor, messageBlock } from "../../../modules/pms/comms/consent";
import { stillWorthSending } from "../../../modules/pms/comms/schedule";
import { ManualMessageInputSchema, type ManualMessageInput } from "../../../modules/pms/comms/schemas";
import { smsAddressKey, toE164 } from "../../../modules/pms/comms/sms";
import type { MessageChannel, MessagePurpose, MessageStatus, ScheduledMessage, SkipReason, TemplateKind } from "../../../modules/pms/comms/types";
import type { PmsActor } from "../../../modules/pms/core/types";
import type { BatchQuery } from "../../db/batch";
import { parseInput, pmsAuditQuery, writeWithAudit, type RepoContext } from "../../repos/pms/context";
import { getMessagingContact, getMessagingContacts } from "../../repos/pms/comms/contacts";
import { createOutboundMessage, outboundInsertQuery, recordSendOutcomes, type OutboundDraft, type SendOutcome } from "../../repos/pms/comms/messages";
import { listReminderRules } from "../../repos/pms/comms/rules";
import { claimDueMessages, closeScheduleQuery } from "../../repos/pms/comms/schedule";
import { getCommsSettings } from "../../repos/pms/comms/settings";
import { getMessageTemplate, resolveTemplate } from "../../repos/pms/comms/templates";
import { incrementUsage } from "../../repos/pms/entitlements";
import { commsLinkOrigin, commsLinkSecret, signStopToken, stopLinkUrl } from "./links";
import { resolveCommsProviders, type CommsProviders, type OutboundEmail, type OutboundSms } from "./providers";
import { appointmentValues, clinicContact, clinicValues, composeMessage, loadDirectory, patientValues, type ClinicContact, type Composed } from "./render";

export interface DispatchDeps {
  providers: CommsProviders;
  /** Signs stop-emails links (null: emails go without one – only when BETTER_AUTH_SECRET is missing). */
  linkSecret: string | null;
  linkOrigin: string;
}

/** Providers and link settings from the environment (throws CommsConfigError on a bad provider setting). */
export function dispatchDepsFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): DispatchDeps {
  return { providers: resolveCommsProviders(env), linkSecret: commsLinkSecret(env), linkOrigin: commsLinkOrigin(env) };
}

/** Who the system is in the audit trail when no person acts (the reminder run, a reply arriving). */
export const SYSTEM_ACTOR: PmsActor = { userId: null, sessionId: null };

function stopUrl(deps: DispatchDeps, tenantId: string, patientId: string, purpose: MessagePurpose, now: Date): string | null {
  if (!deps.linkSecret) return null;
  return stopLinkUrl(deps.linkOrigin, signStopToken({ tenantId, patientId, channel: "email", purpose }, deps.linkSecret, now.getTime()));
}

function draftFor(patientId: string, channel: MessageChannel, purpose: MessagePurpose, kind: OutboundDraft["kind"], address: string, composed: Composed, templateId: string | null, appointmentId: string | null, providerId: string, outbox: boolean): OutboundDraft {
  return {
    patientId,
    channel,
    purpose,
    kind,
    templateId,
    appointmentId,
    toAddress: address,
    addressKey: channel === "sms" ? smsAddressKey(address) : address.toLowerCase(),
    subject: composed.subject,
    body: composed.text,
    segments: composed.segments,
    status: outbox ? "outbox" : "queued",
    provider: providerId,
  };
}

async function callProvider(deps: DispatchDeps, channel: MessageChannel, id: string, address: string, composed: Composed, clinic: ClinicContact, sender: string | null): Promise<SendOutcome> {
  try {
    if (channel === "sms") {
      const sms: OutboundSms = { messageId: id, to: toE164(address), from: sender, body: composed.text };
      return await deps.providers.sms.send(sms);
    }
    const email: OutboundEmail = { messageId: id, to: address, fromName: clinic.name, replyTo: clinic.email, subject: composed.subject ?? clinic.name, text: composed.text, html: composed.html ?? "", headers: composed.headers };
    return await deps.providers.email.send(email);
  } catch {
    return { status: "failed", errorCode: "provider_error" };
  }
}

export type SendResult = { ok: true; messageId: string; status: MessageStatus } | { ok: false; reason: SkipReason | "not_found" | "bad_template"; message: string };

/**
 * A message staff write to one patient (general or marketing), typed or started from a template. The text may
 * use the patient and clinic merge fields; appointment fields are refused (no appointment here).
 */
export async function sendPatientMessage(ctx: RepoContext, tenantId: string, input: ManualMessageInput, actor: PmsActor, deps: DispatchDeps): Promise<SendResult> {
  const d = parseInput(ManualMessageInputSchema, input, "Message");
  const purpose: MessagePurpose = d.purpose ?? "service";
  const contact = await getMessagingContact(ctx, tenantId, d.patientId);
  if (!contact) return { ok: false, reason: "not_found", message: "The patient does not exist in this clinic." };
  const block = messageBlock(contact, d.channel, purpose, { automatic: false });
  if (block) return { ok: false, reason: block, message: block };
  let templateId: string | null = null;
  if (d.templateId) {
    const t = await getMessageTemplate(ctx, tenantId, d.templateId);
    const kind: TemplateKind = purpose === "marketing" ? "marketing" : "general";
    if (!t || t.standard || !t.active || t.channel !== d.channel || t.kind !== kind) return { ok: false, reason: "bad_template", message: "Choose an active template for this kind of message." };
    templateId = t.id;
  }
  const now = ctx.now ? ctx.now() : new Date();
  const settings = await getCommsSettings(ctx, tenantId);
  const clinic = await clinicContact(ctx, tenantId, settings);
  const composed = composeMessage({
    kind: purpose === "marketing" ? "marketing" : "general",
    channel: d.channel,
    purpose,
    subject: d.subject ?? null,
    body: d.body,
    values: { ...patientValues(contact), ...clinicValues(clinic) },
    settings,
    clinic,
    stopUrl: d.channel === "email" ? stopUrl(deps, tenantId, contact.id, purpose, now) : null,
  });
  const address = addressFor(contact, d.channel) as string;
  const provider = d.channel === "sms" ? deps.providers.sms : deps.providers.email;
  const outbox = provider.mode === "outbox";
  const id = await createOutboundMessage(ctx, tenantId, draftFor(contact.id, d.channel, purpose, purpose === "marketing" ? "marketing" : "general", address, composed, templateId, null, provider.id, outbox), actor);
  if (outbox) return { ok: true, messageId: id, status: "outbox" };
  const outcome = await callProvider(deps, d.channel, id, address, composed, clinic, settings.smsSender);
  await recordSendOutcomes(ctx, tenantId, [{ id, outcome }], actor);
  if (outcome.status === "sent" && d.channel === "sms" && composed.segments) await incrementUsage(ctx, tenantId, "sms_segments", composed.segments);
  return { ok: true, messageId: id, status: outcome.status };
}

export interface RunSummary {
  claimed: number;
  sent: number;
  outbox: number;
  failed: number;
  skipped: number;
  reasons: Partial<Record<SkipReason, number>>;
}

const emptySummary = (): RunSummary => ({ claimed: 0, sent: 0, outbox: 0, failed: 0, skipped: 0, reasons: {} });

/**
 * Sends the planned messages that are due for one clinic (at most `limit`, up to 90 per call). Each claimed row
 * ends as sent (with its message), skipped (with the reason) or failed – in batches of 20 rows with one audit row
 * per batch ("pms.message.bulk_send": counts only).
 */
export async function runDueMessages(ctx: RepoContext, tenantId: string, deps: DispatchDeps, options: { limit?: number; actor?: PmsActor } = {}): Promise<RunSummary> {
  const actor = options.actor ?? SYSTEM_ACTOR;
  const summary = emptySummary();
  const token = `run_${randomBytes(12).toString("base64url")}`;
  const rows = await claimDueMessages(ctx, tenantId, token, Math.min(options.limit ?? 90, 90));
  summary.claimed = rows.length;
  if (rows.length === 0) return summary;
  const now = ctx.now ? ctx.now() : new Date();
  const nowIso = now.toISOString();
  const [settings, directory, contacts, rules] = await Promise.all([
    getCommsSettings(ctx, tenantId),
    loadDirectory(ctx, tenantId),
    getMessagingContacts(ctx, tenantId, rows.map((r) => r.patientId)),
    listReminderRules(ctx, tenantId),
  ]);
  const clinic = await clinicContact(ctx, tenantId, settings);
  const ruleTemplate = new Map(rules.map((r) => [r.id, r.templateId]));
  const templates = new Map<string, Awaited<ReturnType<typeof resolveTemplate>>>();
  const templateFor = async (row: ScheduledMessage) => {
    const preferred = row.ruleId ? (ruleTemplate.get(row.ruleId) ?? null) : null;
    const key = `${row.kind}:${row.channel}:${preferred ?? "-"}`;
    if (!templates.has(key)) templates.set(key, await resolveTemplate(ctx, tenantId, row.kind, row.channel, preferred));
    return templates.get(key) ?? null;
  };

  type Planned = { row: ScheduledMessage; queries: BatchQuery[]; send?: { id: string; address: string; composed: Composed } };
  const planned: Planned[] = [];
  for (const row of rows) {
    const skip = (reason: SkipReason): Planned => {
      summary.skipped++;
      summary.reasons[reason] = (summary.reasons[reason] ?? 0) + 1;
      return { row, queries: [closeScheduleQuery(ctx, tenantId, row.id, token, { status: "skipped", reason })] };
    };
    if (!stillWorthSending(row.kind, row.startsAt, nowIso)) {
      planned.push(skip("too_late"));
      continue;
    }
    const contact = contacts.get(row.patientId);
    if (!contact) {
      planned.push(skip("archived"));
      continue;
    }
    const block = messageBlock(contact, row.channel, "service", { automatic: true });
    if (block) {
      planned.push(skip(block));
      continue;
    }
    const template = await templateFor(row);
    if (!template) {
      planned.push(skip("provider_error"));
      continue;
    }
    const composed = composeMessage({
      kind: row.kind,
      channel: row.channel,
      purpose: "service",
      subject: template.subject,
      body: template.body,
      values: { ...patientValues(contact), ...clinicValues(clinic), ...appointmentValues(row, directory, clinic) },
      settings,
      clinic,
      stopUrl: row.channel === "email" ? stopUrl(deps, tenantId, contact.id, "service", now) : null,
    });
    const address = addressFor(contact, row.channel) as string;
    const provider = row.channel === "sms" ? deps.providers.sms : deps.providers.email;
    const outbox = provider.mode === "outbox";
    const draft = draftFor(contact.id, row.channel, "service", row.kind, address, composed, template.standard ? null : template.id, row.appointmentId, provider.id, outbox);
    const { id, query } = outboundInsertQuery(ctx, tenantId, draft, actor);
    if (outbox) summary.outbox++;
    planned.push({ row, queries: [query, closeScheduleQuery(ctx, tenantId, row.id, token, { status: "sent", messageId: id })], send: outbox ? undefined : { id, address, composed } });
  }

  const toSend: NonNullable<Planned["send"]>[] = [];
  const audit = (chunk: Planned[]) =>
    pmsAuditQuery(ctx, tenantId, actor, {
      action: "pms.message.bulk_send",
      targetType: "pms_message_schedule",
      targetId: chunk[0].row.id,
      detail: { count: chunk.length, messages: chunk.filter((p) => p.queries.length === 2).length, skipped: chunk.filter((p) => p.queries.length === 1).length },
    });
  for (let i = 0; i < planned.length; i += 20) {
    const chunk = planned.slice(i, i + 20);
    try {
      await writeWithAudit(ctx, [...chunk.flatMap((p) => p.queries), audit(chunk)]);
      for (const p of chunk) if (p.send) toSend.push(p.send);
      continue;
    } catch {
      // The batch was refused as a whole (one bad row): write the rows one by one; a row that still fails is
      // closed as failed so it is not retried for ever.
    }
    for (const p of chunk) {
      try {
        await writeWithAudit(ctx, [...p.queries, audit([p])]);
        if (p.send) toSend.push(p.send);
      } catch {
        if (p.queries.length === 2 && !p.send) summary.outbox--;
        summary.failed++;
        try {
          await writeWithAudit(ctx, [closeScheduleQuery(ctx, tenantId, p.row.id, token, { status: "failed", reason: "provider_error" }), audit([p])]);
        } catch {
          // Left claimed: released and retried after the stale-claim time, at most a few times.
        }
      }
    }
  }

  const outcomes: { id: string; outcome: SendOutcome }[] = [];
  let segments = 0;
  for (const s of toSend) {
    const row = planned.find((p) => p.send?.id === s.id)?.row;
    const outcome = await callProvider(deps, row?.channel ?? "sms", s.id, s.address, s.composed, clinic, settings.smsSender);
    outcomes.push({ id: s.id, outcome });
    if (outcome.status === "sent") {
      summary.sent++;
      if (row?.channel === "sms" && s.composed.segments) segments += s.composed.segments;
    } else if (outcome.status === "failed") summary.failed++;
  }
  await recordSendOutcomes(ctx, tenantId, outcomes, actor);
  if (segments > 0) await incrementUsage(ctx, tenantId, "sms_segments", segments);
  return summary;
}

/** Sends everything due for a clinic, in rounds of 90, until nothing is due or the time budget is used. */
export async function runAllDueMessages(ctx: RepoContext, tenantId: string, deps: DispatchDeps, options: { budgetMs?: number; actor?: PmsActor } = {}): Promise<RunSummary> {
  const total = emptySummary();
  const started = Date.now();
  for (let round = 0; round < 50; round++) {
    const r = await runDueMessages(ctx, tenantId, deps, { actor: options.actor });
    total.claimed += r.claimed;
    total.sent += r.sent;
    total.outbox += r.outbox;
    total.failed += r.failed;
    total.skipped += r.skipped;
    for (const [k, v] of Object.entries(r.reasons)) total.reasons[k as SkipReason] = (total.reasons[k as SkipReason] ?? 0) + (v ?? 0);
    if (r.claimed < 90 || Date.now() - started > (options.budgetMs ?? 40_000)) break;
  }
  return total;
}
