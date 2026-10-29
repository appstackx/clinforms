/**
 * Sending: a message staff write for one patient (sendPatientMessage – also the answer to a reply), a document by
 * email or a payment link (sendDocumentMessage – letters, invoices, receipts, statements), a waiting-list offer
 * (sendAppointmentNotice), Retry of a failed message (retryMessage) and the run that sends the planned appointment
 * messages that are due (runDueMessages – the cron route and "Send due messages now").
 *
 * Every send checks, at the moment of sending, what the patient agreed to (PECR – src/modules/pms/comms/consent.ts),
 * writes the message with its audit row BEFORE calling the provider (the outbox pattern, ../../repos/pms/comms/
 * messages.ts) and records the provider's answer after. Providers are OUTBOX (default: kept, never sent) or TEST
 * (a test service that never contacts anyone) – ./providers.
 */
import { randomBytes } from "node:crypto";
import { addressFor, messageBlock } from "../../../modules/pms/comms/consent";
import { quietHoursEndAt, stillWorthSending } from "../../../modules/pms/comms/schedule";
import { ManualMessageInputSchema, type ManualMessageInput } from "../../../modules/pms/comms/schemas";
import { smsAddressKey, smsInfo, toE164 } from "../../../modules/pms/comms/sms";
import { STOP_CONFIRMATION } from "../../../modules/pms/comms/defaults";
import type { DocumentType, MessageChannel, MessageKind, MessagePurpose, MessageStatus, ScheduledMessage, SkipReason, TemplateKind } from "../../../modules/pms/comms/types";
import type { PmsActor } from "../../../modules/pms/core/types";
import type { BatchQuery } from "../../db/batch";
import { RepoInputError, nowIso, parseInput, pmsAuditQuery, writeWithAudit, type RepoContext } from "../../repos/pms/context";
import { getMessagingContact, getMessagingContacts } from "../../repos/pms/comms/contacts";
import {
  claimHeldMessage,
  getMessage,
  listHeldDue,
  markReplyDoneQuery,
  outboundInsertQuery,
  recordSendOutcomes,
  replyDoneAuditQuery,
  requeueFailedMessage,
  type OutboundDraft,
  type SendOutcome,
} from "../../repos/pms/comms/messages";
import { listReminderRules } from "../../repos/pms/comms/rules";
import { claimDueMessages, closeScheduleQuery } from "../../repos/pms/comms/schedule";
import { getCommsSettings } from "../../repos/pms/comms/settings";
import { getMessageTemplate, resolveTemplate } from "../../repos/pms/comms/templates";
import { incrementUsage } from "../../repos/pms/entitlements";
import { commsLinkOrigin, commsLinkSecret, signStopToken, stopLinkUrl } from "./links";
import { resolveCommsProviders, type CommsProviders, type OutboundEmail, type OutboundSms } from "./providers";
import {
  appointmentValues,
  clinicContact,
  clinicValues,
  composeMessage,
  htmlFromStoredText,
  loadDirectory,
  patientValues,
  type AppointmentSnapshot,
  type ClinicContact,
  type Composed,
} from "./render";
import { pmsNow, pmsNowMs } from "../../../modules/pms/core/clock";

/** The diary's answer for the run: the current status of these appointments ("booked", "cancelled", …). */
export type AppointmentStatusReader = (ctx: RepoContext, tenantId: string, appointmentIds: readonly string[]) => Promise<ReadonlyMap<string, string>>;

export interface DispatchDeps {
  providers: CommsProviders;
  /** Signs stop-emails links (null: emails go without one – only when BETTER_AUTH_SECRET is missing). */
  linkSecret: string | null;
  linkOrigin: string;
  /**
   * The diary's current status of the run's appointments (src/server/pms/diary/message-sync.ts): a reminder or
   * confirmation of an appointment no longer booked is skipped even if the diary's sync was missed.
   */
  appointmentStatus?: AppointmentStatusReader;
}

/** Providers and link settings from the environment (throws CommsConfigError on a bad provider setting). */
export function dispatchDepsFromEnv(env: Readonly<Record<string, string | undefined>> = process.env, appointmentStatus?: AppointmentStatusReader): DispatchDeps {
  return { providers: resolveCommsProviders(env), linkSecret: commsLinkSecret(env), linkOrigin: commsLinkOrigin(env), appointmentStatus };
}

/** Who the system is in the audit trail when no person acts (the reminder run, a reply arriving). */
export const SYSTEM_ACTOR: PmsActor = { userId: null, sessionId: null };

function stopUrl(deps: DispatchDeps, tenantId: string, patientId: string, purpose: MessagePurpose, now: Date): string | null {
  if (!deps.linkSecret) return null;
  return stopLinkUrl(deps.linkOrigin, signStopToken({ tenantId, patientId, channel: "email", purpose }, deps.linkSecret, now.getTime()));
}

interface DraftArgs {
  patientId: string | null;
  channel: MessageChannel;
  purpose: MessagePurpose;
  kind: Exclude<MessageKind, "reply">;
  address: string;
  composed: Composed;
  templateId: string | null;
  appointmentId: string | null;
  providerId: string;
  outbox: boolean;
  inReplyToId?: string | null;
  documentType?: DocumentType | null;
  documentId?: string | null;
  /** Held for the quiet hours until then (UTC ISO): written queued, the provider is not called now. */
  holdUntil?: string | null;
}

function draftFor(a: DraftArgs): OutboundDraft {
  return {
    patientId: a.patientId,
    channel: a.channel,
    purpose: a.purpose,
    kind: a.kind,
    templateId: a.templateId,
    appointmentId: a.appointmentId,
    toAddress: a.address,
    addressKey: a.channel === "sms" ? smsAddressKey(a.address) : a.address.toLowerCase(),
    subject: a.composed.subject,
    body: a.composed.text,
    segments: a.composed.segments,
    status: a.outbox && !a.holdUntil ? "outbox" : "queued",
    provider: a.providerId,
    inReplyToId: a.inReplyToId ?? null,
    documentType: a.documentType ?? null,
    documentId: a.documentId ?? null,
    holdUntil: a.holdUntil ?? null,
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

/**
 * `heldUntil`: a text held for the clinic's quiet hours (status "queued") – the message run releases it then (UTC
 * ISO; show it in UK time, e.g. "Held until 08:00 (quiet hours)").
 */
export type SendResult = { ok: true; messageId: string; status: MessageStatus; heldUntil?: string } | { ok: false; reason: SkipReason | "not_found" | "bad_template" | "bad_reply"; message: string };

/**
 * Writes one message (with its audit row, and `extra` queries in the same batch – e.g. marking the reply it answers
 * as dealt with), then hands it to the provider unless the outbox keeps it, then records the answer.
 */
async function deliver(
  ctx: RepoContext,
  tenantId: string,
  args: Omit<DraftArgs, "providerId" | "outbox">,
  clinic: ClinicContact,
  sender: string | null,
  actor: PmsActor,
  deps: DispatchDeps,
  extra: BatchQuery[] = [],
): Promise<SendResult> {
  const provider = args.channel === "sms" ? deps.providers.sms : deps.providers.email;
  const outbox = provider.mode === "outbox";
  const draft = draftFor({ ...args, providerId: provider.id, outbox });
  const { id, query } = outboundInsertQuery(ctx, tenantId, draft, actor);
  await writeWithAudit(
    ctx,
    [
      query,
      pmsAuditQuery(ctx, tenantId, actor, {
        action: "pms.message.send",
        targetType: "pms_message",
        targetId: id,
        detail: {
          channel: draft.channel,
          kind: draft.kind,
          purpose: draft.purpose,
          status: draft.status,
          provider: draft.provider,
          patientId: draft.patientId,
          ...(draft.documentType ? { documentType: draft.documentType, documentId: draft.documentId ?? null } : {}),
          ...(draft.holdUntil ? { held: true } : {}),
        },
      }),
      ...extra,
    ],
    { foreignKey: "The patient or template does not exist in this clinic." },
  );
  if (draft.holdUntil) return { ok: true, messageId: id, status: "queued", heldUntil: draft.holdUntil };
  if (outbox) return { ok: true, messageId: id, status: "outbox" };
  const outcome = await callProvider(deps, args.channel, id, args.address, args.composed, clinic, sender);
  await recordSendOutcomes(ctx, tenantId, [{ id, outcome }], actor);
  if (outcome.status === "sent" && args.channel === "sms" && args.composed.segments) await incrementUsage(ctx, tenantId, "sms_segments", args.composed.segments);
  return { ok: true, messageId: id, status: outcome.status };
}

/**
 * A message staff write to one patient (general or marketing), typed or started from a template – or the answer to
 * one of the patient's replies (`inReplyToId`: that reply is marked dealt with in the same batch). The text may use
 * the patient and clinic merge fields; appointment fields are refused (no appointment here).
 */
export async function sendPatientMessage(ctx: RepoContext, tenantId: string, input: ManualMessageInput, actor: PmsActor, deps: DispatchDeps): Promise<SendResult> {
  const d = parseInput(ManualMessageInputSchema, input, "Message");
  const purpose: MessagePurpose = d.purpose ?? "service";
  const kind: TemplateKind = purpose === "marketing" ? "marketing" : "general";
  const contact = await getMessagingContact(ctx, tenantId, d.patientId);
  if (!contact) return { ok: false, reason: "not_found", message: "The patient does not exist in this clinic." };
  const block = messageBlock(contact, d.channel, purpose, { automatic: false, kind });
  if (block) return { ok: false, reason: block, message: block };
  let templateId: string | null = null;
  if (d.templateId) {
    const t = await getMessageTemplate(ctx, tenantId, d.templateId);
    if (!t || t.standard || !t.active || t.channel !== d.channel || t.kind !== kind) return { ok: false, reason: "bad_template", message: "Choose an active template for this kind of message." };
    templateId = t.id;
  }
  const extra: BatchQuery[] = [];
  if (d.inReplyToId) {
    const reply = await getMessage(ctx, tenantId, d.inReplyToId);
    if (!reply || reply.direction !== "inbound" || reply.patientId !== contact.id) return { ok: false, reason: "bad_reply", message: "That reply is not this patient's." };
    if (reply.actionStatus === "to_action") {
      const at = nowIso(ctx);
      extra.push(markReplyDoneQuery(ctx, tenantId, reply.id, actor, at), replyDoneAuditQuery(ctx, tenantId, reply.id, actor, at));
    }
  }
  const now = ctx.now ? ctx.now() : pmsNow();
  const settings = await getCommsSettings(ctx, tenantId);
  const clinic = await clinicContact(ctx, tenantId, settings);
  const composed = composeMessage({
    kind,
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
  return deliver(
    ctx,
    tenantId,
    { patientId: contact.id, channel: d.channel, purpose, kind, address, composed, templateId, appointmentId: null, inReplyToId: d.inReplyToId ?? null },
    clinic,
    settings.smsSender,
    actor,
    deps,
    extra,
  );
}

export interface DocumentMessageInput {
  kind: Extract<TemplateKind, "letter" | "invoice" | "receipt" | "statement" | "payment_link" | "portal_link">;
  channel: MessageChannel;
  /** The patient it is to or about (a letter to a GP: the patient the letter is about; a payer's statement: null). */
  patientId: string | null;
  /** Where it goes: a patient's own address is checked against their preferences; someone else's is as given. */
  to: { kind: "patient" } | { kind: "other"; address: string };
  values: Record<string, string | null>;
  documentType: DocumentType | null;
  documentId: string | null;
}

/**
 * A document by email (a letter, an invoice, a receipt, a statement) or a payment link by text or email, written
 * from the clinic's default template for its kind (else the standard one). To the patient: their address and
 * preferences (deceased refused; texts need texts allowed). To someone else (a GP, an insurer): the address given.
 */
export async function sendDocumentMessage(ctx: RepoContext, tenantId: string, input: DocumentMessageInput, actor: PmsActor, deps: DispatchDeps): Promise<SendResult> {
  const settings = await getCommsSettings(ctx, tenantId);
  const clinic = await clinicContact(ctx, tenantId, settings);
  let address: string;
  let forPatient: Record<string, string | null> = {};
  if (input.to.kind === "patient") {
    if (!input.patientId) throw new RepoInputError("A message to the patient needs the patient.");
    const contact = await getMessagingContact(ctx, tenantId, input.patientId);
    if (!contact) return { ok: false, reason: "not_found", message: "The patient does not exist in this clinic." };
    const block = messageBlock(contact, input.channel, "service", { automatic: false, kind: input.kind });
    if (block) return { ok: false, reason: block, message: block };
    address = addressFor(contact, input.channel) as string;
    forPatient = patientValues(contact);
  } else {
    address = input.to.address.trim();
    if (input.channel === "email" ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) : !/^\+?[0-9 ]{8,20}$/.test(address)) {
      return { ok: false, reason: input.channel === "email" ? "no_email" : "no_mobile", message: "The address is not valid." };
    }
  }
  const template = await resolveTemplate(ctx, tenantId, input.kind, input.channel, null);
  if (!template) return { ok: false, reason: "bad_template", message: "There is no template for this message." };
  const composed = composeMessage({
    kind: input.kind,
    channel: input.channel,
    purpose: "service",
    subject: template.subject,
    body: template.body,
    values: { ...forPatient, ...clinicValues(clinic), ...input.values },
    settings,
    clinic,
    stopUrl: null,
  });
  return deliver(
    ctx,
    tenantId,
    {
      patientId: input.patientId,
      channel: input.channel,
      purpose: "service",
      kind: input.kind,
      address,
      composed,
      templateId: template.standard ? null : template.id,
      appointmentId: null,
      documentType: input.documentType,
      documentId: input.documentId,
    },
    clinic,
    settings.smsSender,
    actor,
    deps,
  );
}

/**
 * A one-off appointment notice that is not planned (a waiting-list offer of a free slot): by text if the patient
 * can get texts, else by email. A TEXT written in the clinic's quiet hours (UK time) is held until they end
 * (Khuram, 28/10/2026): written "queued" with hold_until, released by the message run (releaseHeldMessages). If the
 * quiet hours end too late for the offered slot, the offer goes by email instead when the patient has one, else it
 * is not sent ("too_late"). Emails are never held.
 */
export async function sendAppointmentNotice(
  ctx: RepoContext,
  tenantId: string,
  input: { patientId: string; kind: "offer"; appointment: AppointmentSnapshot; appointmentRef: string | null },
  actor: PmsActor,
  deps: DispatchDeps,
): Promise<SendResult> {
  const contact = await getMessagingContact(ctx, tenantId, input.patientId);
  if (!contact) return { ok: false, reason: "not_found", message: "The patient does not exist in this clinic." };
  const smsBlock = messageBlock(contact, "sms", "service", { automatic: false, kind: input.kind });
  const emailBlock = messageBlock(contact, "email", "service", { automatic: false, kind: input.kind });
  let channel: MessageChannel | null = !smsBlock ? "sms" : !emailBlock ? "email" : null;
  if (!channel) return { ok: false, reason: smsBlock ?? "opted_out", message: smsBlock ?? "opted_out" };
  const [settings, directory] = await Promise.all([getCommsSettings(ctx, tenantId), loadDirectory(ctx, tenantId)]);
  const now = ctx.now ? ctx.now() : pmsNow();
  let holdUntil: string | null = null;
  if (channel === "sms") {
    holdUntil = quietHoursEndAt(now.toISOString(), settings.quietStart, settings.quietEnd);
    if (holdUntil && Date.parse(holdUntil) >= Date.parse(input.appointment.startsAt)) {
      // The quiet hours end after the offered slot starts: by email now if possible, else not at all.
      if (emailBlock) return { ok: false, reason: "too_late", message: "The quiet hours end after the offered time – the text was not sent." };
      channel = "email";
      holdUntil = null;
    }
  }
  const clinic = await clinicContact(ctx, tenantId, settings);
  const template = await resolveTemplate(ctx, tenantId, input.kind, channel, null);
  if (!template) return { ok: false, reason: "bad_template", message: "There is no template for this message." };
  const composed = composeMessage({
    kind: input.kind,
    channel,
    purpose: "service",
    subject: template.subject,
    body: template.body,
    values: { ...patientValues(contact), ...clinicValues(clinic), ...appointmentValues(input.appointment, directory, clinic) },
    settings,
    clinic,
    stopUrl: channel === "email" ? stopUrl(deps, tenantId, contact.id, "service", now) : null,
  });
  return deliver(
    ctx,
    tenantId,
    { patientId: contact.id, channel, purpose: "service", kind: input.kind, address: addressFor(contact, channel) as string, composed, templateId: template.standard ? null : template.id, appointmentId: input.appointmentRef, holdUntil },
    clinic,
    settings.smsSender,
    actor,
    deps,
  );
}

/**
 * The one last text after a STOP reply (design round 3, "Quiet hours and opt-out"): it confirms the opt-out and says
 * whether reminders will come by email. Sent although texts are now off – it answers the patient's own STOP.
 */
export async function sendStopConfirmation(ctx: RepoContext, tenantId: string, patientId: string, actor: PmsActor, deps: DispatchDeps): Promise<SendResult> {
  const contact = await getMessagingContact(ctx, tenantId, patientId);
  if (!contact || contact.status === "deceased" || !addressFor(contact, "sms")) return { ok: false, reason: "no_mobile", message: "no_mobile" };
  const settings = await getCommsSettings(ctx, tenantId);
  const clinic = await clinicContact(ctx, tenantId, settings);
  const byEmail = contact.reminderEmail && Boolean(contact.email);
  const text = `${clinic.shortName}: ${byEmail ? STOP_CONFIRMATION : "you won't get more texts from us."}`;
  const composed: Composed = { subject: null, text, html: null, segments: smsInfo(text).segments, headers: {} };
  return deliver(ctx, tenantId, { patientId: contact.id, channel: "sms", purpose: "service", kind: "general", address: addressFor(contact, "sms") as string, composed, templateId: null, appointmentId: null }, clinic, settings.smsSender, actor, deps);
}

/** Retry on the outbox: a FAILED message is sent again, as written, to the same address (attempts counted). */
export async function retryMessage(ctx: RepoContext, tenantId: string, id: string, actor: PmsActor, deps: DispatchDeps): Promise<SendResult> {
  const before = await getMessage(ctx, tenantId, id);
  if (!before || before.direction !== "outbound" || !before.toAddress) return { ok: false, reason: "not_found", message: "This message no longer exists in this clinic." };
  if (before.status !== "failed") return { ok: false, reason: "provider_error", message: "Only a message that failed can be sent again." };
  if (before.patientId && !before.documentType) {
    const contact = await getMessagingContact(ctx, tenantId, before.patientId);
    const block = contact ? messageBlock(contact, before.channel, before.purpose, { automatic: false, kind: before.kind }) : "archived";
    if (block) return { ok: false, reason: block, message: block };
  }
  if (!(await requeueFailedMessage(ctx, tenantId, id, actor))) return { ok: false, reason: "provider_error", message: "This message cannot be sent again (it has been tried too often, or it changed)." };
  const settings = await getCommsSettings(ctx, tenantId);
  const clinic = await clinicContact(ctx, tenantId, settings);
  const composed: Composed = {
    subject: before.subject,
    text: before.body,
    html: before.channel === "email" ? htmlFromStoredText(clinic.name, before.body) : null,
    segments: before.segments,
    headers: {},
  };
  const outcome = await callProvider(deps, before.channel, id, before.toAddress, composed, clinic, settings.smsSender);
  await recordSendOutcomes(ctx, tenantId, [{ id, outcome }], actor);
  if (outcome.status === "sent" && before.channel === "sms" && before.segments) await incrementUsage(ctx, tenantId, "sms_segments", before.segments);
  return { ok: true, messageId: id, status: outcome.status };
}

export interface RunSummary {
  claimed: number;
  /** Texts held for the quiet hours released by this run (waiting-list offers). */
  released: number;
  sent: number;
  outbox: number;
  failed: number;
  skipped: number;
  reasons: Partial<Record<SkipReason, number>>;
}

const emptySummary = (): RunSummary => ({ claimed: 0, released: 0, sent: 0, outbox: 0, failed: 0, skipped: 0, reasons: {} });

/** Kinds that need the appointment still booked when they go (the cancellation notices and the DNA follow-up do not). */
const NEEDS_BOOKED: ReadonlySet<string> = new Set(["confirmation", "reminder", "moved"]);

/**
 * Sends the planned messages that are due for one clinic (at most `limit`, up to 90 per call). Each claimed row
 * ends as sent (with its message), skipped (with the reason) or failed – in batches of 20 rows with one audit row
 * per batch ("pms.message.bulk_send": counts only).
 */
/**
 * What a message run reads once and every round of it reuses (the clinic's settings, directory, rules, contact
 * details and templates do not change between rounds a few seconds apart): runAllDueMessages passes one.
 */
export type RunCache = Map<string, Promise<unknown>>;

function cached<T>(cache: RunCache | undefined, key: string, load: () => Promise<T>): Promise<T> {
  if (!cache) return load();
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) cache.set(key, (p = load()));
  return p;
}

/** Schedule rows (with their messages) written per batch: 2 statements each + 1 audit row stay under 100. */
const SEND_WRITE_CHUNK = 45;

export async function runDueMessages(ctx: RepoContext, tenantId: string, deps: DispatchDeps, options: { limit?: number; actor?: PmsActor; cache?: RunCache } = {}): Promise<RunSummary> {
  const actor = options.actor ?? SYSTEM_ACTOR;
  const summary = emptySummary();
  const held = await releaseHeldMessages(ctx, tenantId, deps, { actor });
  summary.released = held.released;
  summary.sent += held.sent;
  summary.outbox += held.outbox;
  summary.failed += held.failed;
  const token = `run_${randomBytes(12).toString("base64url")}`;
  const rows = await claimDueMessages(ctx, tenantId, token, Math.min(options.limit ?? 90, 90));
  summary.claimed = rows.length;
  if (rows.length === 0) return summary;
  const now = ctx.now ? ctx.now() : pmsNow();
  const nowText = now.toISOString();
  const cache = options.cache;
  const templates: RunCache = cache ?? new Map();
  const [settings, directory, contacts, rules, statuses] = await Promise.all([
    cached(cache, "settings", () => getCommsSettings(ctx, tenantId)),
    cached(cache, "directory", () => loadDirectory(ctx, tenantId)),
    getMessagingContacts(ctx, tenantId, rows.map((r) => r.patientId)),
    cached(cache, "rules", () => listReminderRules(ctx, tenantId)),
    deps.appointmentStatus ? deps.appointmentStatus(ctx, tenantId, rows.map((r) => r.appointmentId)) : Promise.resolve(null),
  ]);
  const clinic = await cached(cache, "clinic", () => clinicContact(ctx, tenantId, settings));
  const ruleTemplate = new Map(rules.map((r) => [r.id, r.templateId]));
  const templateFor = async (row: ScheduledMessage) => {
    const preferred = row.ruleId ? (ruleTemplate.get(row.ruleId) ?? null) : null;
    const key = `${row.kind}:${row.channel}:${preferred ?? "-"}`;
    return (await cached(templates, `template:${key}`, () => resolveTemplate(ctx, tenantId, row.kind, row.channel, preferred))) ?? null;
  };

  type Planned = { row: ScheduledMessage; queries: BatchQuery[]; send?: { id: string; address: string; composed: Composed } };
  const planned: Planned[] = [];
  for (const row of rows) {
    const skip = (reason: SkipReason): Planned => {
      summary.skipped++;
      summary.reasons[reason] = (summary.reasons[reason] ?? 0) + 1;
      return { row, queries: [closeScheduleQuery(ctx, tenantId, row.id, token, { status: "skipped", reason })] };
    };
    if (!stillWorthSending(row.kind, row.startsAt, nowText)) {
      planned.push(skip("too_late"));
      continue;
    }
    if (statuses && NEEDS_BOOKED.has(row.kind) && statuses.get(row.appointmentId) !== "booked") {
      planned.push(skip("appointment_cancelled"));
      continue;
    }
    const contact = contacts.get(row.patientId);
    if (!contact) {
      planned.push(skip("archived"));
      continue;
    }
    const block = messageBlock(contact, row.channel, "service", { automatic: true, kind: row.kind });
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
    const draft = draftFor({
      patientId: contact.id,
      channel: row.channel,
      purpose: "service",
      kind: row.kind,
      address,
      composed,
      templateId: template.standard ? null : template.id,
      appointmentId: row.appointmentId,
      providerId: provider.id,
      outbox,
    });
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
  for (let i = 0; i < planned.length; i += SEND_WRITE_CHUNK) {
    const chunk = planned.slice(i, i + SEND_WRITE_CHUNK);
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

/**
 * Releases the texts held for the quiet hours whose time has come (waiting-list offers – sendAppointmentNotice):
 * each is claimed conditionally (claimHeldMessage – two runs never both send it), then filed in the outbox or handed
 * to the provider as written, and the answer recorded. Part of every message run.
 */
export async function releaseHeldMessages(
  ctx: RepoContext,
  tenantId: string,
  deps: DispatchDeps,
  options: { actor?: PmsActor; limit?: number } = {},
): Promise<{ released: number; sent: number; outbox: number; failed: number }> {
  const actor = options.actor ?? SYSTEM_ACTOR;
  const out = { released: 0, sent: 0, outbox: 0, failed: 0 };
  const now = nowIso(ctx);
  const ids = await listHeldDue(ctx, tenantId, now, options.limit ?? 90);
  if (ids.length === 0) return out;
  const settings = await getCommsSettings(ctx, tenantId);
  const clinic = await clinicContact(ctx, tenantId, settings);
  const outcomes: { id: string; outcome: SendOutcome }[] = [];
  let segments = 0;
  for (const id of ids) {
    const m = await getMessage(ctx, tenantId, id);
    if (!m || m.direction !== "outbound" || !m.toAddress) continue;
    const provider = m.channel === "sms" ? deps.providers.sms : deps.providers.email;
    const outbox = provider.mode === "outbox";
    if (!(await claimHeldMessage(ctx, tenantId, id, now, outbox, actor))) continue;
    out.released++;
    if (outbox) {
      out.outbox++;
      continue;
    }
    const composed: Composed = { subject: m.subject, text: m.body, html: m.channel === "email" ? htmlFromStoredText(clinic.name, m.body) : null, segments: m.segments, headers: {} };
    const outcome = await callProvider(deps, m.channel, id, m.toAddress, composed, clinic, settings.smsSender);
    outcomes.push({ id, outcome });
    if (outcome.status === "sent") {
      out.sent++;
      if (m.channel === "sms" && m.segments) segments += m.segments;
    } else if (outcome.status === "failed") out.failed++;
  }
  await recordSendOutcomes(ctx, tenantId, outcomes, actor);
  if (segments > 0) await incrementUsage(ctx, tenantId, "sms_segments", segments);
  return out;
}

/** Sends everything due for a clinic, in rounds of 90, until nothing is due or the time budget is used. */
export async function runAllDueMessages(ctx: RepoContext, tenantId: string, deps: DispatchDeps, options: { budgetMs?: number; actor?: PmsActor } = {}): Promise<RunSummary> {
  const total = emptySummary();
  const started = pmsNowMs();
  const cache: RunCache = new Map();
  for (let round = 0; round < 50; round++) {
    const r = await runDueMessages(ctx, tenantId, deps, { actor: options.actor, cache });
    total.claimed += r.claimed;
    total.released += r.released;
    total.sent += r.sent;
    total.outbox += r.outbox;
    total.failed += r.failed;
    total.skipped += r.skipped;
    for (const [k, v] of Object.entries(r.reasons)) total.reasons[k as SkipReason] = (total.reasons[k as SkipReason] ?? 0) + (v ?? 0);
    if (r.claimed < 90 || pmsNowMs() - started > (options.budgetMs ?? 40_000)) break;
  }
  return total;
}
