/**
 * The comms module's server reads – what the Messages screens, the letter editor and the patient record's Messages
 * tab call. Same rules as the records and billing services (src/server/pms/records/access.ts):
 *
 *   1. the member's permission FIRST: messages.send (see and send messages, answer replies), messages.templates
 *      (templates and settings), messages.letters (open and write letters – never reception, a lock);
 *   2. site scope (`actor.siteIds`): only messages, planned messages and letters of patients the member can see;
 *      ids from the request are read back from the member's own clinic and scope ("no such message" otherwise);
 *   3. lists never decrypt (a message's text and a letter's subject and body are encrypted): one message, thread
 *      or letter is opened at a time;
 *   4. a Result with a plain message – never a database message or patient data.
 */
import "server-only";
import { addressFor, messageBlock } from "../../../modules/pms/comms/consent";
import { CHANNEL_LABELS, CONSENT_SOURCE_LABELS, ERROR_LABELS, INTENT_LABELS, KIND_LABELS, SKIP_REASON_LABELS, TEMPLATE_KIND_LABELS, TEMPLATE_WHEN } from "../../../modules/pms/comms/copy";
import { STANDARD_LETTER_TEMPLATES } from "../../../modules/pms/comms/defaults";
import { contextForKind, exampleValues, fieldsFor, renderTemplate } from "../../../modules/pms/comms/merge-fields";
import { smsInfo } from "../../../modules/pms/comms/sms";
import { formatAppointmentDay, formatAppointmentTime, londonParts, londonToUtcIso, addDays } from "../../../modules/pms/comms/schedule";
import type { LetterRecipientKind, Message, MessageSummary, MessagingContact, ScheduledMessage, TemplateKind } from "../../../modules/pms/comms/types";
import type {
  LetterRowView,
  MergeFieldView,
  MessagesHomeView,
  OutboxRowView,
  OutboxState,
  PatientContactView,
  PatientMessagesView,
  ReplyRowView,
  ReplyThreadView,
  SendFormView,
  LetterEditorView,
  LetterStartView,
  PatientFacingView,
  TemplateRowView,
  ThreadMessageView,
} from "../../../modules/pms/comms/view";
import { isPlausibleRecordId } from "../../../modules/pms/records/form-values";
import { ukToday } from "../../../modules/pms/core/text";
import type { Letter, LetterTemplate, ReminderRule, CommsSettings } from "../../../modules/pms/comms/types";
import { nowIso } from "../../repos/pms/context";
import { getPatientSummaries } from "../../repos/pms/patients";
import { listCasesForPatient } from "../../repos/pms/cases";
import { listPractitioners, findPractitionerByUser } from "../../repos/pms/directory";
import { getReferrer, listReferrers } from "../../repos/pms/referrers";
import { listConsentEvents } from "../../repos/pms/comms/consent";
import { getMessagingContact, getMessagingContacts } from "../../repos/pms/comms/contacts";
import { getLetter, getLetterTemplate, listLetterTemplates, listLetters } from "../../repos/pms/comms/letters";
import { getMessage, listMessages, listRepliesTo, messageCounts } from "../../repos/pms/comms/messages";
import { listReminderRules } from "../../repos/pms/comms/rules";
import { listSchedule, scheduleByMessageIds, scheduleCounts } from "../../repos/pms/comms/schedule";
import { getCommsSettings } from "../../repos/pms/comms/settings";
import { listMessageTemplates, resolveTemplate } from "../../repos/pms/comms/templates";
import { patientVisibleInScope } from "../access";
import { attempt, fail, forbidden, notFound, ok, patientInClinic, type RecordsActor, type Result } from "../records/access";
import { providerStatus } from "./providers";
import { clinicContact, composeMessage } from "./render";
import { signatureLine } from "./letters";

export type CommsActor = RecordsActor;

export const MESSAGE_NOT_FOUND = "This message no longer exists in this clinic.";
export const LETTER_NOT_FOUND = "This letter no longer exists in this clinic.";

const DAY = 86_400_000;

/** The UK day's window as instants: [start of today, start of tomorrow). */
export function todayWindow(nowIsoText: string): { from: string; until: string; today: string } {
  const today = ukToday(new Date(nowIsoText));
  return { from: londonToUtcIso(today, "00:00"), until: londonToUtcIso(addDays(today, 1), "00:00"), today };
}

const nameOf = (p: { firstName: string; lastName: string; preferredName: string | null } | undefined | null) => (p ? `${(p.preferredName ?? "").trim() || p.firstName} ${p.lastName}` : null);

async function namesOf(actor: CommsActor, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const list = ids.filter((x): x is string => Boolean(x));
  if (!list.length) return new Map();
  const m = await getPatientSummaries(actor.repo(), actor.tenantId, list);
  return new Map(Array.from(m.entries()).map(([id, p]) => [id, nameOf(p) as string]));
}

/** "Reminder · Wed 28/10 at 11:30" – from plain fields only. */
function summaryOf(kind: TemplateKind, startsAt: string | null): string {
  const label = TEMPLATE_KIND_LABELS[kind] ?? KIND_LABELS[kind as keyof typeof KIND_LABELS] ?? "Message";
  return startsAt ? `${label} · ${formatAppointmentDay(startsAt)} at ${formatAppointmentTime(startsAt)}` : label;
}

function messageState(m: MessageSummary): OutboxState {
  switch (m.status) {
    case "queued":
      return "sending";
    case "outbox":
      return "outbox";
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "failed":
      return "failed";
    default:
      return "sent";
  }
}

function canSeeMessage(actor: CommsActor, m: Pick<MessageSummary, "documentType" | "kind">): boolean {
  return m.documentType !== "letter" || actor.can("messages.letters");
}

function messageRow(actor: CommsActor, m: MessageSummary, names: Map<string, string>, schedule: Map<string, ScheduledMessage>): OutboxRowView {
  const state = messageState(m);
  const sch = schedule.get(m.id);
  const kind = (m.kind === "reply" ? "general" : m.kind) as TemplateKind;
  return {
    id: m.id,
    messageId: m.id,
    at: m.sentAt ?? m.createdAt,
    patientId: m.patientId,
    patientName: m.patientId ? (names.get(m.patientId) ?? null) : null,
    address: m.toAddress,
    channel: m.channel,
    kind,
    summary: summaryOf(kind, sch?.startsAt ?? null),
    state,
    why: state === "failed" ? (ERROR_LABELS[m.errorCode ?? ""] ?? "Not delivered") : state === "outbox" ? "Kept in the outbox – not sent" : m.attempts > 1 && state === "sent" ? `Sent on try ${m.attempts}` : null,
    canRetry: state === "failed" && actor.can("messages.send") && canSeeMessage(actor, m),
  };
}

function scheduleRow(s: ScheduledMessage, names: Map<string, string>, contacts: Map<string, MessagingContact>): OutboxRowView {
  const contact = contacts.get(s.patientId);
  const state: OutboxState = s.status === "pending" || s.status === "processing" ? (s.held ? "held" : "planned") : s.status === "cancelled" ? "cancelled" : "skipped";
  return {
    id: s.id,
    messageId: null,
    at: s.status === "pending" || s.status === "processing" ? s.dueAt : s.updatedAt,
    patientId: s.patientId,
    patientName: names.get(s.patientId) ?? null,
    address: contact ? addressFor(contact, s.channel) : null,
    channel: s.channel,
    kind: s.kind,
    summary: summaryOf(s.kind, s.startsAt),
    state,
    why: state === "held" ? `Quiet hours – will send ${formatAppointmentTime(s.dueAt)}` : state === "skipped" || state === "cancelled" ? (s.skipReason ? SKIP_REASON_LABELS[s.skipReason] : state === "cancelled" ? "No longer needed." : null) : null,
    canRetry: false,
  };
}

/** The Messages page header and the outbox's "Today" line. messages.send. */
export async function messagesHomeFor(actor: CommsActor): Promise<Result<MessagesHomeView>> {
  if (!actor.can("messages.send")) return forbidden();
  return attempt("comms.home", async () => {
    const ctx = actor.repo();
    const scope = actor.siteIds ?? null;
    const w = todayWindow(nowIso(ctx));
    const [settings, today, overall, sched] = await Promise.all([
      getCommsSettings(ctx, actor.tenantId),
      messageCounts(ctx, actor.tenantId, { since: w.from, siteIds: scope }),
      messageCounts(ctx, actor.tenantId, { siteIds: scope }),
      scheduleCounts(ctx, actor.tenantId, w, scope),
    ]);
    return ok({
      counts: { planned: sched.planned, sent: today.sent, failed: today.failed, held: sched.held, optedOut: sched.optedOut, outbox: today.outbox },
      quietStart: settings.quietStart,
      quietEnd: settings.quietEnd,
      toAction: overall.toAction,
      mode: providerStatus(),
      canManage: actor.can("messages.templates"),
      canLetters: actor.can("messages.letters"),
    });
  });
}

/** Replies waiting for someone – the nav badge. 0 without messages.send. */
export async function unansweredRepliesFor(actor: CommsActor): Promise<number> {
  if (!actor.can("messages.send")) return 0;
  try {
    return (await messageCounts(actor.repo(), actor.tenantId, { siteIds: actor.siteIds ?? null })).toAction;
  } catch {
    return 0;
  }
}

export type OutboxFilter = "all" | "planned" | "sent" | "failed" | "skipped";

/**
 * The outbox (design round 2c): messages of the last two days, planned messages of the next seven, and planned
 * messages skipped or cancelled today – by time. messages.send.
 */
export async function outboxFor(actor: CommsActor, filter: OutboxFilter = "all"): Promise<Result<OutboxRowView[]>> {
  if (!actor.can("messages.send")) return forbidden();
  return attempt("comms.outbox", async () => {
    const ctx = actor.repo();
    const scope = actor.siteIds ?? null;
    const now = nowIso(ctx);
    const w = todayWindow(now);
    const since = londonToUtcIso(addDays(w.today, -1), "00:00");
    const [messages, planned, skipped] = await Promise.all([
      filter === "planned" || filter === "skipped" ? Promise.resolve([] as MessageSummary[]) : listMessages(ctx, actor.tenantId, { direction: "outbound", since, siteIds: scope, limit: 200, ...(filter === "failed" ? { status: "failed" as const } : {}) }),
      filter === "all" || filter === "planned" ? listSchedule(ctx, actor.tenantId, { statuses: ["pending", "processing"], dueUntil: new Date(Date.parse(now) + 7 * DAY).toISOString(), siteIds: scope, limit: 200 }) : Promise.resolve([] as ScheduledMessage[]),
      filter === "all" || filter === "skipped" ? listSchedule(ctx, actor.tenantId, { statuses: ["skipped", "cancelled"], updatedSince: w.from, siteIds: scope, limit: 100 }) : Promise.resolve([] as ScheduledMessage[]),
    ]);
    const shown = messages.filter((m) => (filter === "sent" ? m.status === "sent" || m.status === "delivered" || m.status === "outbox" : true));
    const sched = [...planned, ...skipped];
    const [names, bySchedule, contacts] = await Promise.all([
      namesOf(actor, [...shown.map((m) => m.patientId), ...sched.map((s) => s.patientId)]),
      scheduleByMessageIds(ctx, actor.tenantId, shown.map((m) => m.id)),
      getMessagingContacts(ctx, actor.tenantId, sched.map((s) => s.patientId)),
    ]);
    const rows = [...shown.map((m) => messageRow(actor, m, names, bySchedule)), ...sched.map((s) => scheduleRow(s, names, contacts))];
    rows.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id.localeCompare(b.id)));
    return ok(rows);
  });
}

/** One message (its text decrypted) – for the outbox's "View". A letter's email needs messages.letters. */
export async function messageDetailFor(actor: CommsActor, messageId: unknown): Promise<Result<{ message: Message; patientName: string | null; summary: string; why: string | null }>> {
  if (!actor.can("messages.send")) return forbidden();
  if (!isPlausibleRecordId(messageId)) return fail("not_found", MESSAGE_NOT_FOUND);
  return attempt("comms.message", async () => {
    const ctx = actor.repo();
    const m = await getMessage(ctx, actor.tenantId, messageId);
    if (!m) return fail("not_found", MESSAGE_NOT_FOUND);
    if (m.patientId && actor.siteIds && !(await patientVisibleInScope(ctx, actor.tenantId, m.patientId, actor.siteIds))) return fail("not_found", MESSAGE_NOT_FOUND);
    if (!m.patientId && actor.siteIds) return fail("not_found", MESSAGE_NOT_FOUND);
    if (!canSeeMessage(actor, m)) return forbidden();
    const names = await namesOf(actor, [m.patientId]);
    const sch = await scheduleByMessageIds(ctx, actor.tenantId, [m.id]);
    const row = messageRow(actor, m, names, sch);
    return ok({ message: m, patientName: row.patientName, summary: row.summary, why: row.why });
  });
}

/** The replies inbox: waiting first, then the last 30 days. messages.send. */
export async function repliesFor(actor: CommsActor): Promise<Result<ReplyRowView[]>> {
  if (!actor.can("messages.send")) return forbidden();
  return attempt("comms.replies", async () => {
    const ctx = actor.repo();
    const scope = actor.siteIds ?? null;
    const [waiting, recent] = await Promise.all([
      listMessages(ctx, actor.tenantId, { direction: "inbound", actionStatus: "to_action", siteIds: scope, limit: 100 }),
      listMessages(ctx, actor.tenantId, { direction: "inbound", since: new Date(Date.parse(nowIso(ctx)) - 30 * DAY).toISOString(), siteIds: scope, limit: 100 }),
    ]);
    // A reply from a number that matched no patient has no patient: it shows for members who see every site.
    const unmatched = scope === null ? (await listMessages(ctx, actor.tenantId, { direction: "inbound", actionStatus: "to_action", limit: 50 })).filter((m) => !m.patientId) : [];
    const seen = new Set<string>();
    const all = [...waiting, ...unmatched, ...recent].filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
    const names = await namesOf(actor, all.map((m) => m.patientId));
    return ok(
      all.map((m) => ({ id: m.id, patientId: m.patientId, patientName: m.patientId ? (names.get(m.patientId) ?? null) : null, from: m.fromAddress, at: m.sentAt ?? m.createdAt, intent: m.replyIntent, toAction: m.actionStatus === "to_action" })),
    );
  });
}

/** One reply's thread: the text it answers, the reply, and answers since (decrypted). messages.send. */
export async function replyThreadFor(actor: CommsActor, replyId: unknown): Promise<Result<ReplyThreadView>> {
  if (!actor.can("messages.send")) return forbidden();
  if (!isPlausibleRecordId(replyId)) return fail("not_found", MESSAGE_NOT_FOUND);
  return attempt("comms.thread", async () => {
    const ctx = actor.repo();
    const reply = await getMessage(ctx, actor.tenantId, replyId);
    if (!reply || reply.direction !== "inbound") return fail("not_found", MESSAGE_NOT_FOUND);
    if (actor.siteIds && (!reply.patientId || !(await patientVisibleInScope(ctx, actor.tenantId, reply.patientId, actor.siteIds)))) return fail("not_found", MESSAGE_NOT_FOUND);
    const msgs: Message[] = [];
    if (reply.inReplyToId) {
      const original = await getMessage(ctx, actor.tenantId, reply.inReplyToId);
      if (original && canSeeMessage(actor, original)) msgs.push(original);
    }
    msgs.push(reply);
    for (const a of await listRepliesTo(ctx, actor.tenantId, reply.id)) {
      const full = await getMessage(ctx, actor.tenantId, a.id);
      if (full) msgs.push(full);
    }
    const names = await namesOf(actor, [reply.patientId]);
    const sch = await scheduleByMessageIds(ctx, actor.tenantId, msgs.map((m) => m.id));
    const thread: ThreadMessageView[] = msgs.map((m) => ({
      id: m.id,
      direction: m.direction,
      channel: m.channel,
      text: m.body,
      at: m.sentAt ?? m.createdAt,
      label:
        m.direction === "inbound"
          ? `Reply · ${m.replyIntent ? INTENT_LABELS[m.replyIntent] : ""}`
          : `${summaryOf((m.kind === "reply" ? "general" : m.kind) as TemplateKind, sch.get(m.id)?.startsAt ?? null)} · ${CHANNEL_LABELS[m.channel]} · ${m.status === "delivered" ? "Delivered" : m.status === "outbox" ? "In the outbox" : m.status === "failed" ? "Failed" : "Sent"}`,
    }));
    let answerChannel: ReplyThreadView["answerChannel"] = null;
    let why: string | null = "This reply is not matched to a patient. Find the patient and message them from their record.";
    if (reply.patientId) {
      const c = await getMessagingContact(ctx, actor.tenantId, reply.patientId);
      const sms = c ? messageBlock(c, "sms", "service", { automatic: false, kind: "general" }) : "archived";
      const email = c ? messageBlock(c, "email", "service", { automatic: false, kind: "general" }) : "archived";
      answerChannel = !sms ? "sms" : !email ? "email" : null;
      why = answerChannel ? null : SKIP_REASON_LABELS[sms ?? "opted_out"];
    }
    return ok({
      reply: { id: reply.id, patientId: reply.patientId, patientName: reply.patientId ? (names.get(reply.patientId) ?? null) : null, from: reply.fromAddress, at: reply.sentAt ?? reply.createdAt, intent: reply.replyIntent, toAction: reply.actionStatus === "to_action" },
      messages: thread,
      answerChannel,
      answerBlockedWhy: why,
    });
  });
}

function templateMeta(t: { kind: TemplateKind; channel: "sms" | "email" }, rules: readonly ReminderRule[]): string {
  const ch = CHANNEL_LABELS[t.channel];
  if (t.kind === "reminder") {
    const r = rules.filter((x) => x.active && x.channel === t.channel);
    if (r.length) return `${ch} · ${r.map((x) => (x.timing === "hours_before" ? `${x.hoursBefore} h before` : `${x.daysBefore} day${x.daysBefore === 1 ? "" : "s"} before at ${x.sendAt}`)).join(", ")}`;
    return `${ch} · no reminder set up`;
  }
  return `${ch} · ${TEMPLATE_WHEN[t.kind]}`;
}

/** The merge fields an editor offers for a template's kind and channel (with the preview's example values). */
export function mergeFieldsFor(kind: TemplateKind | "letter-body", channel: "sms" | "email" | null): MergeFieldView[] {
  const fields = kind === "letter-body" ? fieldsFor("letter", null) : fieldsFor(contextForKind(kind), channel);
  return fields.map((f) => ({ key: f.key, label: f.label, example: f.example }));
}

/** Templates (the clinic's own and the standard ones). Anyone with messages.send sees them; editing needs messages.templates. */
export async function templatesFor(actor: CommsActor): Promise<Result<{ rows: TemplateRowView[]; canEdit: boolean; examples: Record<string, string> }>> {
  if (!actor.can("messages.send")) return forbidden();
  return attempt("comms.templates", async () => {
    const ctx = actor.repo();
    const [rows, rules, settings] = await Promise.all([listMessageTemplates(ctx, actor.tenantId, { includeInactive: true }), listReminderRules(ctx, actor.tenantId), getCommsSettings(ctx, actor.tenantId)]);
    const clinic = await clinicContact(ctx, actor.tenantId, settings);
    const examples = { ...exampleValues(), "clinic.name": clinic.name, "clinic.short_name": clinic.shortName, "clinic.phone": clinic.phone ?? "01632 960100", "reply.instructions": "Reply C to cancel.", "optout.sms": "STOP to opt out" };
    return ok({
      rows: rows.map((t) => ({ id: t.id, name: t.name, kind: t.kind, channel: t.channel, subject: t.subject, body: t.body, standard: t.standard, isDefault: t.isDefault, active: t.active, rev: t.rev, meta: templateMeta(t, rules) })),
      canEdit: actor.can("messages.templates"),
      examples,
    });
  });
}

/** Message settings: quiet hours, confirmations, notices, the text sender, reminders. messages.templates. */
export async function messageSettingsFor(actor: CommsActor): Promise<Result<{ settings: CommsSettings; rules: ReminderRule[] }>> {
  if (!actor.can("messages.templates")) return forbidden();
  return attempt("comms.settings", async () => {
    const ctx = actor.repo();
    const [settings, rules] = await Promise.all([getCommsSettings(ctx, actor.tenantId), listReminderRules(ctx, actor.tenantId)]);
    return ok({ settings, rules });
  });
}

function contactView(c: MessagingContact): PatientContactView {
  const why = (r: ReturnType<typeof messageBlock>) => (r ? SKIP_REASON_LABELS[r] : null);
  return {
    id: c.id,
    name: nameOf(c) as string,
    mobile: c.phoneMobile,
    email: c.email,
    sms: why(messageBlock(c, "sms", "service", { automatic: false, kind: "general" })),
    smsMarketing: why(messageBlock(c, "sms", "marketing", { automatic: false })),
    emailService: why(messageBlock(c, "email", "service", { automatic: false, kind: "general" })),
    emailMarketing: why(messageBlock(c, "email", "marketing", { automatic: false })),
  };
}

/** "Send a message": the patient's channels and the templates for typed messages. messages.send. */
export async function sendFormFor(actor: CommsActor, patientId: unknown): Promise<Result<SendFormView>> {
  if (!actor.can("messages.send")) return forbidden();
  return attempt("comms.send_form", async () => {
    const ctx = actor.repo();
    let patient: PatientContactView | null = null;
    if (patientId) {
      const p = await patientInClinic(actor, patientId);
      if (!p) return notFound();
      const c = await getMessagingContact(ctx, actor.tenantId, p.id);
      if (c) patient = contactView(c);
    }
    const [templates, settings] = await Promise.all([listMessageTemplates(ctx, actor.tenantId), getCommsSettings(ctx, actor.tenantId)]);
    const clinic = await clinicContact(ctx, actor.tenantId, settings);
    return ok({
      patient,
      templates: templates
        .filter((t) => (t.kind === "general" || t.kind === "marketing") && t.active)
        .map((t) => ({ id: t.standard ? "" : t.id, name: t.name, channel: t.channel, purpose: t.kind === "marketing" ? ("marketing" as const) : ("service" as const), subject: t.subject, body: t.body })),
      shortName: clinic.shortName,
      clinicName: clinic.name,
    });
  });
}

async function letterRows(actor: CommsActor, letters: Awaited<ReturnType<typeof listLetters>>): Promise<LetterRowView[]> {
  const ctx = actor.repo();
  const names = await namesOf(actor, letters.map((l) => l.patientId));
  const templateNames = new Map<string, string>();
  for (const id of Array.from(new Set(letters.map((l) => l.templateId).filter((x): x is string => Boolean(x))))) {
    const t = await getLetterTemplate(ctx, actor.tenantId, id);
    if (t) templateNames.set(id, t.name);
  }
  const practitioners = new Map((await listPractitioners(ctx, actor.tenantId, { includeInactive: true })).map((p) => [p.id, p.displayName]));
  return letters.map((l) => ({
    id: l.id,
    patientId: l.patientId,
    patientName: names.get(l.patientId) ?? "",
    title: l.templateName || (l.templateId && templateNames.get(l.templateId)) || "Letter",
    recipientName: l.recipientName,
    recipientKind: l.recipientKind,
    letterOn: l.letterOn,
    status: l.status,
    sentVia: l.sentVia,
    authorName: l.practitionerId ? (practitioners.get(l.practitionerId) ?? null) : null,
  }));
}

/** Letters (titles only – the template's name, recipient, status): reception sees them, cannot open them. messages.send. */
export async function lettersFor(actor: CommsActor, options: { patientId?: unknown } = {}): Promise<Result<LetterRowView[]>> {
  if (!actor.can("messages.send") && !actor.can("messages.letters")) return forbidden();
  return attempt("comms.letters", async () => {
    const ctx = actor.repo();
    let patientId: string | undefined;
    if (options.patientId !== undefined) {
      const p = await patientInClinic(actor, options.patientId);
      if (!p) return notFound();
      patientId = p.id;
    }
    let rows = await listLetters(ctx, actor.tenantId, { patientId, limit: 100 });
    if (actor.siteIds && !patientId) {
      const visible: typeof rows = [];
      for (const l of rows) if (await patientVisibleInScope(ctx, actor.tenantId, l.patientId, actor.siteIds)) visible.push(l);
      rows = visible;
    }
    return ok(await letterRows(actor, rows));
  });
}


const RECIPIENT_HINT: Record<LetterRecipientKind, string> = { gp: "To the GP · clinical", referrer: "To a referrer or payer · clinical", patient: "To the patient", other: "To someone else" };

/** Starting a letter for a patient: templates, the patient's cases, possible recipients. messages.letters. */
export async function letterStartFor(actor: CommsActor, patientId: unknown): Promise<Result<LetterStartView>> {
  if (!actor.can("messages.letters")) return forbidden();
  return attempt("comms.letter_start", async () => {
    const ctx = actor.repo();
    const p = await patientInClinic(actor, patientId);
    if (!p) return notFound();
    const [templates, cases] = await Promise.all([listLetterTemplates(ctx, actor.tenantId), listCasesForPatient(ctx, actor.tenantId, p.id)]);
    const recipients: LetterStartView["recipients"] = [];
    if (p.gpName || p.gpPractice) recipients.push({ value: "gp", label: [p.gpName, p.gpPractice].filter(Boolean).join(" – "), kind: "gp" });
    recipients.push({ value: "patient", label: `${nameOf(p)} (the patient)`, kind: "patient" });
    const refIds = Array.from(new Set(cases.map((c) => c.payerReferrerId).filter((x): x is string => Boolean(x))));
    for (const id of refIds) {
      const r = await getReferrer(ctx, actor.tenantId, id);
      if (r) recipients.push({ value: `referrer:${r.id}`, label: r.contactName ? `${r.contactName}, ${r.name}` : r.name, kind: "referrer" });
    }
    void listReferrers;
    return ok({
      patient: { id: p.id, name: nameOf(p) as string },
      templates: templates.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name, recipientKind: t.recipientKind, standard: t.standard, hint: RECIPIENT_HINT[t.recipientKind] })),
      cases: cases.map((c) => ({ id: c.id, title: c.title })),
      recipients,
    });
  });
}


/** One letter for the editor and the A4 page (decrypted). messages.letters – reception never. */
export async function letterFor(actor: CommsActor, letterId: unknown): Promise<Result<LetterEditorView>> {
  if (!actor.can("messages.letters")) return forbidden();
  if (!isPlausibleRecordId(letterId)) return fail("not_found", LETTER_NOT_FOUND);
  return attempt("comms.letter", async () => {
    const ctx = actor.repo();
    const letter = await getLetter(ctx, actor.tenantId, letterId);
    if (!letter) return fail("not_found", LETTER_NOT_FOUND);
    if (actor.siteIds && !(await patientVisibleInScope(ctx, actor.tenantId, letter.patientId, actor.siteIds))) return fail("not_found", LETTER_NOT_FOUND);
    const [names, template, me, settings, emails] = await Promise.all([
      namesOf(actor, [letter.patientId]),
      letter.templateId ? getLetterTemplate(ctx, actor.tenantId, letter.templateId) : Promise.resolve(null as LetterTemplate | null),
      findPractitionerByUser(ctx, actor.tenantId, actor.userId),
      getCommsSettings(ctx, actor.tenantId),
      listMessages(ctx, actor.tenantId, { documentType: "letter", documentId: letter.id, limit: 5 }),
    ]);
    const clinic = await clinicContact(ctx, actor.tenantId, settings);
    const email = emails[0] ?? null;
    return ok({
      letter,
      patientName: names.get(letter.patientId) ?? "",
      templateName: letter.templateName ?? template?.name ?? "Letter",
      signatureWillBe: signatureLine(me?.displayName ?? actor.name ?? actor.email, me ? { profession: me.profession, registrationNumber: me.registrationNumber } : null),
      fields: mergeFieldsFor("letter-body", null),
      clinic: { name: clinic.name, lines: [...(clinic.address ?? []), clinic.postcode].filter((x): x is string => Boolean(x)), phone: clinic.phone },
      emailTo: letter.recipientEmail,
      sentByEmail: email ? { at: email.sentAt ?? email.createdAt, status: email.status } : null,
    });
  });
}

/** A patient's record → Messages: messages, planned messages, letters (titles), preference changes. messages.send. */
export async function patientMessagesFor(actor: CommsActor, patientId: unknown): Promise<Result<PatientMessagesView>> {
  if (!actor.can("messages.send")) return forbidden();
  return attempt("comms.patient", async () => {
    const ctx = actor.repo();
    const p = await patientInClinic(actor, patientId);
    if (!p) return notFound();
    const c = await getMessagingContact(ctx, actor.tenantId, p.id);
    if (!c) return notFound();
    const [messages, planned, letters, consent] = await Promise.all([
      listMessages(ctx, actor.tenantId, { patientId: p.id, limit: 100 }),
      listSchedule(ctx, actor.tenantId, { patientId: p.id, statuses: ["pending", "processing", "skipped", "cancelled"], limit: 100 }),
      listLetters(ctx, actor.tenantId, { patientId: p.id, limit: 50 }),
      listConsentEvents(ctx, actor.tenantId, p.id, 20),
    ]);
    const names = new Map([[p.id, nameOf(p) as string]]);
    const bySchedule = await scheduleByMessageIds(ctx, actor.tenantId, messages.map((m) => m.id));
    const contacts = new Map([[c.id, c]]);
    const nowMs = Date.parse(nowIso(ctx));
    const rows = [
      ...messages.filter((m) => m.direction === "outbound").map((m) => messageRow(actor, m, names, bySchedule)),
      ...messages
        .filter((m) => m.direction === "inbound")
        .map((m) => ({
          id: m.id,
          messageId: m.id,
          at: m.sentAt ?? m.createdAt,
          patientId: m.patientId,
          patientName: names.get(p.id) ?? null,
          address: m.fromAddress,
          channel: m.channel,
          kind: "general" as TemplateKind,
          summary: `Reply from the patient${m.replyIntent ? ` · ${INTENT_LABELS[m.replyIntent]}` : ""}`,
          state: "sent" as OutboxState,
          why: m.actionStatus === "to_action" ? "Waiting for an answer" : null,
          canRetry: false,
        })),
      // Planned: still to go, or not sent in the last 30 days.
      ...planned.filter((s) => s.status === "pending" || s.status === "processing" || Date.parse(s.updatedAt) > nowMs - 30 * DAY).map((s) => scheduleRow(s, names, contacts)),
    ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return ok({
      patient: contactView(c),
      rows,
      letters: await letterRows(actor, letters),
      consent: consent.map((e) => ({ at: e.createdAt, label: `${e.action === "opt_out" ? "Stopped" : "Agreed to"} ${e.purpose === "marketing" ? "marketing" : "appointment"} ${e.channel === "sms" ? "texts" : "emails"} – ${CONSENT_SOURCE_LABELS[e.source]}` })),
      canSend: actor.can("messages.send"),
      canLetters: actor.can("messages.letters"),
    });
  });
}

/**
 * The dashboard's failed-messages tile (M8 data source): failed messages of the last 7 days in the member's
 * scope, the count and the newest five. messages.send (0 and none otherwise).
 */
export async function failedMessagesSummaryFor(actor: CommsActor): Promise<{ count: number; rows: OutboxRowView[] }> {
  if (!actor.can("messages.send")) return { count: 0, rows: [] };
  const r = await outboxFor(actor, "failed");
  if (!r.ok) return { count: 0, rows: [] };
  const rows = r.value.filter((x) => Date.parse(x.at) > Date.now() - 7 * DAY).reverse();
  return { count: rows.length, rows: rows.slice(0, 5) };
}

/**
 * The patient-facing messages page (design round 3, "Patient-facing messages"): what patients actually receive –
 * the clinic's current templates written out with fictional values, exactly as the send run writes them (same
 * code), with the texts' length. messages.send.
 */
export async function patientFacingFor(actor: CommsActor): Promise<Result<PatientFacingView>> {
  if (!actor.can("messages.send")) return forbidden();
  return attempt("comms.patient_facing", async () => {
    const ctx = actor.repo();
    const settings = await getCommsSettings(ctx, actor.tenantId);
    const clinic = await clinicContact(ctx, actor.tenantId, settings);
    const ex = exampleValues();
    const values = { ...ex, "clinic.name": clinic.name, "clinic.short_name": clinic.shortName, "clinic.phone": clinic.phone ?? ex["clinic.phone"], "site.phone": clinic.phone ?? ex["site.phone"], "billing.balance": "£55.00", "billing.link": "https://pay.example.com/3Qe1", "portal.link": "https://clinic.example.com/portal/7Hx2", "portal.expires": "15 minutes" };
    const stop = "https://clinic.example.com/api/clinic-messages/unsubscribe?t=…";
    const write = async (kind: TemplateKind, channel: "sms" | "email") => {
      const t = await resolveTemplate(ctx, actor.tenantId, kind, channel, null);
      if (!t) return null;
      return composeMessage({ kind, channel, purpose: "service", subject: t.subject, body: t.body, values, settings, clinic, stopUrl: channel === "email" ? stop : null });
    };
    const texts: PatientFacingView["texts"] = [];
    for (const [kind, title, when] of [
      ["reminder", "Appointment reminder", "Before the appointment · held if in quiet hours"],
      ["confirmation", "Booking confirmation", "When booked, if the booking asks for it"],
      ["cancelled", "Cancelled with notice", "Straight after a cancellation"],
      ["late_cancelled", "Late cancellation", "Cancelled under 24 h before"],
      ["dna", "Did not attend", "1 h after the appointment"],
      ["offer", "Waiting list offer", "Offer slot by text"],
    ] as const) {
      const c = await write(kind, "sms");
      if (!c) continue;
      const info = smsInfo(c.text);
      texts.push({ title, when, text: c.text, units: info.units, segments: info.segments, gsm7: info.encoding === "gsm7" });
    }
    const emails: PatientFacingView["emails"] = [];
    for (const [kind, title] of [
      ["confirmation", "Booking confirmation email"],
      ["portal_link", "Portal sign-in email"],
    ] as const) {
      const c = await write(kind, "email");
      if (c) emails.push({ title, subject: c.subject ?? "", text: c.text });
    }
    const letter = STANDARD_LETTER_TEMPLATES.find((l) => l.key === "appointment-letter");
    const letterValues = { ...values, "patient.full_name": "Ms Megan Hart", "appointments.upcoming": "Wed 28/10/2026  11:30  with Sarah Reid\nWed 04/11/2026  11:30  with Sarah Reid\nWed 11/11/2026  11:30  with Sarah Reid" };
    return ok({
      clinicName: clinic.name,
      shortName: clinic.shortName,
      replyPhone: clinic.phone,
      replyEmail: clinic.email,
      texts,
      emails,
      quietStart: settings.quietStart,
      quietEnd: settings.quietEnd,
      letter: { title: letter?.name ?? "Appointment letter", body: renderTemplate(letter?.body ?? "", letterValues, { missing: "empty" }).text },
    });
  });
}

export { londonParts };
