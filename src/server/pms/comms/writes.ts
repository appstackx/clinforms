/**
 * The comms module's server writes – what the Messages screens' and the letter editor's server actions call. Same
 * rules as ./views.ts: the permission FIRST (messages.send / messages.templates / messages.letters; billing's
 * documents also billing.view, payment links billing.pay), every id read back from the member's own clinic and site
 * scope, input validated (the repositories validate again), plain answers. Every change is written with its audit
 * row in the same batch by the repositories (src/server/repos/pms/comms/*).
 *
 * Nothing leaves the system: the providers are the OUTBOX (default) or a TEST service (./providers).
 */
import "server-only";
import { z } from "zod";
import { SKIP_REASON_LABELS } from "../../../modules/pms/comms/copy";
import { CommsSettingsInputSchema, HhmmSchema, LetterSentViaSchema, MessageChannelSchema } from "../../../modules/pms/comms/schemas";
import type { LetterRecipientKind, SkipReason } from "../../../modules/pms/comms/types";
import { formatPence, formatUkDate } from "../../../modules/pms/core/text";
import { PmsIdSchema } from "../../../modules/pms/core/schemas";
import { isPlausibleRecordId } from "../../../modules/pms/records/form-values";
import { findPractitionerByUser } from "../../repos/pms/directory";
import { finaliseLetter, getLetter, markLetterSent, updateLetter, voidLetter } from "../../repos/pms/comms/letters";
import { getMessage, markReplyDone } from "../../repos/pms/comms/messages";
import { createReminderRule, updateReminderRule } from "../../repos/pms/comms/rules";
import { updateCommsSettings } from "../../repos/pms/comms/settings";
import { copyStandardTemplate, createMessageTemplate, getMessageTemplate, updateMessageTemplate } from "../../repos/pms/comms/templates";
import { patientVisibleInScope } from "../access";
import { diaryDispatchDeps } from "../diary/message-sync";
import { attempt, fail, forbidden, notFound, ok, patientInClinic, saveFailure, type Result } from "../records/access";
import { reconcileDiaryMessages } from "../diary/message-sync";
import { runAllDueMessages, retryMessage, sendDocumentMessage, sendPatientMessage, type DispatchDeps, type RunSummary, type SendResult } from "./dispatch";
import { CommsConfigError } from "./providers";

/** A standard template's id ("standard:<key>"). */
const STANDARD_PREFIX_GUARD = /^standard:/;
import { fillLetterFields, signatureLine, startLetter } from "./letters";
import { LETTER_NOT_FOUND, MESSAGE_NOT_FOUND, type CommsActor } from "./views";

export const NOT_CONFIGURED = "The message service is not set up correctly. Nothing was sent – ask the clinic owner.";

/** The providers (outbox / test) and the diary's status reader; tests pass their own. */
function depsOrFail(deps?: DispatchDeps): DispatchDeps | null {
  if (deps) return deps;
  try {
    return diaryDispatchDeps();
  } catch (err) {
    if (err instanceof CommsConfigError) return null;
    throw err;
  }
}

/** A refused send in plain words. */
function sendFailure(r: Extract<SendResult, { ok: false }>) {
  if (r.reason === "not_found") return notFound();
  if (r.reason === "bad_template") return fail("invalid", r.message);
  if (r.reason === "bad_reply") return fail("invalid", r.message);
  return fail("invalid", SKIP_REASON_LABELS[r.reason as SkipReason] ?? "This message cannot be sent.");
}

export interface SentAnswer {
  messageId: string;
  status: string;
  /** "Sent", "In the outbox – not sent", "Failed: …" */
  label: string;
}

function sentAnswer(r: Extract<SendResult, { ok: true }>): SentAnswer {
  const label = r.status === "outbox" ? "Kept in the outbox – not sent." : r.status === "failed" ? "The message service did not accept it. It is in the outbox as failed – you can retry." : "Sent.";
  return { messageId: r.messageId, status: r.status, label };
}

/* ------------------------------------------------------------------------------------------------
 * Messages to patients
 * ----------------------------------------------------------------------------------------------*/

const SendSchema = z.object({
  patientId: PmsIdSchema,
  channel: MessageChannelSchema,
  purpose: z.enum(["service", "marketing"]).optional(),
  templateId: z.preprocess((v) => (v === "" ? null : v), z.union([PmsIdSchema, z.null()]).optional()),
  subject: z.union([z.string().max(200), z.null()]).optional(),
  body: z.string().trim().min(1, "Write the message").max(8000),
});
export type SendMessageRequest = z.input<typeof SendSchema>;

/** "Send a message" to one patient (record, Messages tab). messages.send; marketing only to opted-in patients. */
export async function sendMessageFor(actor: CommsActor, input: unknown, deps?: DispatchDeps): Promise<Result<SentAnswer>> {
  if (!actor.can("messages.send")) return forbidden();
  const parsed = SendSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Check the message.");
  return attempt("comms.send", async () => {
    const p = await patientInClinic(actor, parsed.data.patientId);
    if (!p) return notFound();
    const d = depsOrFail(deps);
    if (!d) return fail("error", NOT_CONFIGURED);
    const r = await sendPatientMessage(actor.repo(), actor.tenantId, { ...parsed.data, patientId: p.id, subject: parsed.data.channel === "email" ? (parsed.data.subject ?? null) : null }, actor.actor, d);
    return r.ok ? ok(sentAnswer(r)) : sendFailure(r);
  });
}

const AnswerSchema = z.object({ replyId: PmsIdSchema, body: z.string().trim().min(1, "Write your answer").max(918) });

/** Answers a patient's reply (by text when they can get texts, else by email); the reply is marked dealt with. */
export async function answerReplyFor(actor: CommsActor, input: unknown, deps?: DispatchDeps): Promise<Result<SentAnswer>> {
  if (!actor.can("messages.send")) return forbidden();
  const parsed = AnswerSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Check the answer.");
  return attempt("comms.answer", async () => {
    const ctx = actor.repo();
    const reply = await getMessage(ctx, actor.tenantId, parsed.data.replyId);
    if (!reply || reply.direction !== "inbound") return fail("not_found", MESSAGE_NOT_FOUND);
    if (!reply.patientId) return fail("invalid", "This reply is not matched to a patient. Find the patient and message them from their record.");
    if (!(await patientInClinic(actor, reply.patientId))) return fail("not_found", MESSAGE_NOT_FOUND);
    const d = depsOrFail(deps);
    if (!d) return fail("error", NOT_CONFIGURED);
    let r = await sendPatientMessage(ctx, actor.tenantId, { patientId: reply.patientId, channel: "sms", body: parsed.data.body, inReplyToId: reply.id }, actor.actor, d);
    if (!r.ok && (r.reason === "opted_out" || r.reason === "no_mobile")) {
      r = await sendPatientMessage(ctx, actor.tenantId, { patientId: reply.patientId, channel: "email", subject: "Your message to us", body: parsed.data.body, inReplyToId: reply.id }, actor.actor, d);
    }
    return r.ok ? ok(sentAnswer(r)) : sendFailure(r);
  });
}

/** "Mark as dealt with" on a reply (no answer needed). messages.send. */
export async function markReplyDoneFor(actor: CommsActor, replyId: unknown): Promise<Result<{ done: boolean }>> {
  if (!actor.can("messages.send")) return forbidden();
  if (!isPlausibleRecordId(replyId)) return fail("not_found", MESSAGE_NOT_FOUND);
  return attempt("comms.reply_done", async () => {
    const ctx = actor.repo();
    const reply = await getMessage(ctx, actor.tenantId, replyId);
    if (!reply || reply.direction !== "inbound") return fail("not_found", MESSAGE_NOT_FOUND);
    if (actor.siteIds && (!reply.patientId || !(await patientVisibleInScope(ctx, actor.tenantId, reply.patientId, actor.siteIds)))) return fail("not_found", MESSAGE_NOT_FOUND);
    return ok({ done: await markReplyDone(ctx, actor.tenantId, reply.id, actor.actor) });
  });
}

/** Retry on the outbox (a failed message, sent again as written). messages.send; a letter's email also messages.letters. */
export async function retryMessageFor(actor: CommsActor, messageId: unknown, deps?: DispatchDeps): Promise<Result<SentAnswer>> {
  if (!actor.can("messages.send")) return forbidden();
  if (!isPlausibleRecordId(messageId)) return fail("not_found", MESSAGE_NOT_FOUND);
  return attempt("comms.retry", async () => {
    const ctx = actor.repo();
    const m = await getMessage(ctx, actor.tenantId, messageId);
    if (!m || m.direction !== "outbound") return fail("not_found", MESSAGE_NOT_FOUND);
    if (actor.siteIds && (!m.patientId || !(await patientVisibleInScope(ctx, actor.tenantId, m.patientId, actor.siteIds)))) return fail("not_found", MESSAGE_NOT_FOUND);
    if (m.documentType === "letter" && !actor.can("messages.letters")) return forbidden();
    const d = depsOrFail(deps);
    if (!d) return fail("error", NOT_CONFIGURED);
    const r = await retryMessage(ctx, actor.tenantId, m.id, actor.actor, d);
    return r.ok ? ok(sentAnswer(r)) : fail("invalid", r.message);
  });
}

/** "Send due messages now" (what the scheduled run does), for this clinic. messages.templates. */
export async function runDueNowFor(actor: CommsActor, deps?: DispatchDeps): Promise<Result<RunSummary>> {
  if (!actor.can("messages.templates")) return forbidden();
  return attempt("comms.run_now", async () => {
    const d = depsOrFail(deps);
    if (!d) return fail("error", NOT_CONFIGURED);
    await reconcileDiaryMessages(actor.repo(), actor.tenantId, actor.actor);
    return ok(await runAllDueMessages(actor.repo(), actor.tenantId, d, { actor: actor.actor, budgetMs: 20_000 }));
  });
}

/* ------------------------------------------------------------------------------------------------
 * Templates and settings (messages.templates – owner and administrators by default)
 * ----------------------------------------------------------------------------------------------*/

const TemplateSaveSchema = z.object({
  id: z.string().min(1).max(80),
  rev: z.number().int().min(0),
  name: z.string().trim().min(1, "Give the template a name").max(120).optional(),
  subject: z.union([z.string().max(200), z.null()]).optional(),
  body: z.string().min(1, "Write the message").max(8000),
});

/**
 * Saves a template's wording. A standard template is copied first (the copy becomes the clinic's default for its
 * kind and channel), so "Save template" always works on the clinic's own copy.
 */
export async function saveTemplateFor(actor: CommsActor, input: unknown): Promise<Result<{ id: string; rev: number }>> {
  if (!actor.can("messages.templates")) return forbidden();
  const parsed = TemplateSaveSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Check the template.");
  const d = parsed.data;
  return attempt("comms.template_save", async () => {
    const ctx = actor.repo();
    let id = d.id;
    let rev = d.rev;
    if (STANDARD_PREFIX_GUARD.test(id)) {
      const copy = await copyStandardTemplate(ctx, actor.tenantId, id.replace(STANDARD_PREFIX_GUARD, ""), actor.actor, d.name);
      id = copy.id;
      rev = copy.rev;
    } else if (!isPlausibleRecordId(id)) return notFound();
    const current = await getMessageTemplate(ctx, actor.tenantId, id);
    if (!current) return notFound();
    const r = await updateMessageTemplate(ctx, actor.tenantId, id, rev, { name: d.name, subject: current.channel === "email" ? (d.subject ?? current.subject) : undefined, body: d.body, isDefault: true }, actor.actor);
    if (!r.ok) return saveFailure(r);
    return ok({ id, rev: r.rev });
  });
}

const NewTemplateSchema = z.object({
  kind: z.enum(["general", "marketing"]),
  channel: MessageChannelSchema,
  name: z.string().trim().min(1, "Give the template a name").max(120),
  subject: z.union([z.string().max(200), z.null()]).optional(),
  body: z.string().min(1, "Write the message").max(8000),
});

/** A new template for messages staff send by hand (general or marketing). messages.templates. */
export async function createTemplateFor(actor: CommsActor, input: unknown): Promise<Result<{ id: string }>> {
  if (!actor.can("messages.templates")) return forbidden();
  const parsed = NewTemplateSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Check the template.");
  return attempt("comms.template_new", async () => {
    const t = await createMessageTemplate(actor.repo(), actor.tenantId, { ...parsed.data, subject: parsed.data.channel === "email" ? (parsed.data.subject ?? null) : null }, actor.actor);
    return ok({ id: t.id });
  });
}

/** Quiet hours, confirmations, notices, the sender name, replies. messages.templates. */
export async function saveMessageSettingsFor(actor: CommsActor, rev: unknown, input: unknown): Promise<Result<{ rev: number }>> {
  if (!actor.can("messages.templates")) return forbidden();
  if (typeof rev !== "number" || !Number.isInteger(rev) || rev < 0) return fail("invalid", "Reload the page and try again.");
  const parsed = CommsSettingsInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Check the settings.", { fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) });
  return attempt("comms.settings_save", async () => {
    const r = await updateCommsSettings(actor.repo(), actor.tenantId, rev, parsed.data, actor.actor);
    return r.ok ? ok({ rev: r.rev }) : saveFailure(r);
  });
}

const RuleSchema = z.object({
  id: z.union([PmsIdSchema, z.null()]).optional(),
  rev: z.number().int().min(0).optional(),
  name: z.string().trim().min(1).max(80),
  channel: MessageChannelSchema,
  timing: z.enum(["hours_before", "days_before"]),
  hoursBefore: z.union([z.number().int(), z.null()]).optional(),
  daysBefore: z.union([z.number().int(), z.null()]).optional(),
  sendAt: z.union([HhmmSchema, z.null()]).optional(),
  active: z.boolean().optional(),
});

/** Adds or changes a reminder ("24 hours before by text"). messages.templates. */
export async function saveReminderRuleFor(actor: CommsActor, input: unknown): Promise<Result<{ id: string }>> {
  if (!actor.can("messages.templates")) return forbidden();
  const parsed = RuleSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Check the reminder.");
  const { id, rev, ...rule } = parsed.data;
  return attempt("comms.rule_save", async () => {
    const ctx = actor.repo();
    if (id) {
      const r = await updateReminderRule(ctx, actor.tenantId, id, rev ?? 0, rule, actor.actor);
      return r.ok ? ok({ id }) : saveFailure(r);
    }
    const created = await createReminderRule(ctx, actor.tenantId, rule, actor.actor);
    return ok({ id: created.id });
  });
}

/* ------------------------------------------------------------------------------------------------
 * Letters (messages.letters – never reception)
 * ----------------------------------------------------------------------------------------------*/

const StartLetterSchema = z.object({
  patientId: PmsIdSchema,
  templateId: z.string().min(1).max(80),
  caseId: z.preprocess((v) => (v === "" ? null : v), z.union([PmsIdSchema, z.null()]).optional()),
  /** "gp", "patient", "referrer:<id>", "other". */
  recipient: z.string().max(80).optional(),
});

/** Starts a letter from a template for a patient (merged; gaps to write marked). */
export async function startLetterFor(actor: CommsActor, input: unknown): Promise<Result<{ id: string }>> {
  if (!actor.can("messages.letters")) return forbidden();
  const parsed = StartLetterSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Choose a template.");
  const d = parsed.data;
  return attempt("comms.letter_start", async () => {
    const p = await patientInClinic(actor, d.patientId);
    if (!p) return notFound();
    let recipientKind: LetterRecipientKind | undefined;
    let recipientReferrerId: string | null = null;
    if (d.recipient === "gp" || d.recipient === "patient" || d.recipient === "other") recipientKind = d.recipient;
    else if (d.recipient?.startsWith("referrer:")) {
      recipientKind = "referrer";
      recipientReferrerId = d.recipient.slice(9);
      if (!isPlausibleRecordId(recipientReferrerId)) return fail("invalid", "Choose the recipient again.");
    }
    const me = await findPractitionerByUser(actor.repo(), actor.tenantId, actor.userId);
    const letter = await startLetter(
      actor.repo(),
      actor.tenantId,
      { patientId: p.id, templateId: d.templateId, caseId: d.caseId ?? null, practitionerId: me?.id ?? null, recipientKind, recipientReferrerId, clinical: actor.can("clinical.view") },
      actor.actor,
      actor.name,
    );
    return ok({ id: letter.id });
  });
}

async function letterInScope(actor: CommsActor, id: unknown) {
  if (!isPlausibleRecordId(id)) return null;
  const l = await getLetter(actor.repo(), actor.tenantId, id);
  if (!l) return null;
  if (actor.siteIds && !(await patientVisibleInScope(actor.repo(), actor.tenantId, l.patientId, actor.siteIds))) return null;
  return l;
}

const LetterSaveSchema = z.object({
  id: PmsIdSchema,
  rev: z.number().int().min(1),
  subject: z.string().trim().min(1, "Give the letter a subject").max(200).optional(),
  body: z.string().min(1, "Write the letter").max(20000).optional(),
  recipientName: z.union([z.string().max(160), z.null()]).optional(),
  recipientAddress: z.union([z.array(z.string().max(120)).max(6), z.null()]).optional(),
  recipientPostcode: z.union([z.string().max(10), z.null()]).optional(),
  recipientEmail: z.union([z.string().max(254), z.null()]).optional(),
});

/** Save draft. */
export async function saveLetterFor(actor: CommsActor, input: unknown): Promise<Result<{ rev: number }>> {
  if (!actor.can("messages.letters")) return forbidden();
  const parsed = LetterSaveSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Check the letter.");
  const { id, rev, ...patch } = parsed.data;
  return attempt("comms.letter_save", async () => {
    const l = await letterInScope(actor, id);
    if (!l) return fail("not_found", LETTER_NOT_FOUND);
    const clean = { ...patch, recipientEmail: patch.recipientEmail === "" ? null : patch.recipientEmail, recipientPostcode: patch.recipientPostcode === "" ? null : patch.recipientPostcode };
    if (patch.subject !== undefined || patch.body !== undefined) {
      const filled = await fillLetterFields(actor.repo(), actor.tenantId, { ...l, recipientName: clean.recipientName ?? l.recipientName, recipientAddress: clean.recipientAddress ?? l.recipientAddress, recipientPostcode: clean.recipientPostcode ?? l.recipientPostcode }, { subject: patch.subject ?? l.subject, body: patch.body ?? l.body }, actor.can("clinical.view"));
      clean.subject = filled.subject;
      clean.body = filled.body;
    }
    const r = await updateLetter(actor.repo(), actor.tenantId, l.id, rev, clean, actor.actor);
    if (!r.ok) return r.reason === "locked" ? fail("locked", "This letter is signed and can no longer change.") : saveFailure(r);
    return ok({ rev: r.rev });
  });
}

const SignSchema = z.object({ id: PmsIdSchema, rev: z.number().int().min(1), send: z.union([z.literal("email"), LetterSentViaSchema, z.null()]).optional() });

/**
 * Sign (and send): the letter is finalised with the signer's signature line (their name, profession and
 * registration number); "email" then emails it to the recipient's address through the outbox, "post"/"hand" record
 * how it went. Refused while the letter has gaps to fill.
 */
export async function signLetterFor(actor: CommsActor, input: unknown, deps?: DispatchDeps): Promise<Result<{ sent: SentAnswer | null }>> {
  if (!actor.can("messages.letters")) return forbidden();
  const parsed = SignSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", "Reload the letter and try again.");
  const d = parsed.data;
  return attempt<{ sent: SentAnswer | null }>("comms.letter_sign", async () => {
    const ctx = actor.repo();
    let l = await letterInScope(actor, d.id);
    if (!l) return fail("not_found", LETTER_NOT_FOUND);
    if (d.send === "email" && !l.recipientEmail) return fail("invalid", "Add the recipient's email address first.", { fieldErrors: { recipientEmail: "Add an email address" } });
    if (l.status === "draft") {
      const me = await findPractitionerByUser(ctx, actor.tenantId, actor.userId);
      const signature = signatureLine(me?.displayName ?? actor.name ?? actor.email, me ? { profession: me.profession, registrationNumber: me.registrationNumber } : null);
      const r = await finaliseLetter(ctx, actor.tenantId, l.id, d.rev, actor.actor, signature);
      if (!r.ok) {
        if (r.reason === "unfilled") return fail("invalid", 'Fill in every gap first: the letter still has "[not recorded: …]" or "[[…]]" text.');
        if (r.reason === "conflict") return fail("conflict", "Someone else changed this letter. Reload it to see their changes.");
        return fail("locked", "This letter can no longer change.");
      }
      l = (await getLetter(ctx, actor.tenantId, l.id)) ?? l;
    } else if (l.status === "void") return fail("locked", "This letter was withdrawn.");
    if (!d.send) return ok({ sent: null });
    if (d.send === "email") {
      const dd = depsOrFail(deps);
      if (!dd) return fail("error", NOT_CONFIGURED);
      const body = [l.body, "", l.signatureText ?? ""].join("\n").trim();
      const r = await sendDocumentMessage(
        ctx,
        actor.tenantId,
        { kind: "letter", channel: "email", patientId: l.patientId, to: { kind: "other", address: l.recipientEmail as string }, values: { "document.title": l.subject, "document.body": body, "recipient.name": l.recipientName }, documentType: "letter", documentId: l.id },
        actor.actor,
        dd,
      );
      if (!r.ok) return sendFailure(r);
      await markLetterSent(ctx, actor.tenantId, l.id, "email", actor.actor);
      return ok({ sent: sentAnswer(r) });
    }
    const m = await markLetterSent(ctx, actor.tenantId, l.id, d.send, actor.actor);
    return m.ok ? ok({ sent: null }) : fail("locked", "This letter has been sent already.");
  });
}

/** Withdraw a letter written in error (kept, marked withdrawn). */
export async function voidLetterFor(actor: CommsActor, id: unknown): Promise<Result<{ voided: true }>> {
  if (!actor.can("messages.letters")) return forbidden();
  return attempt("comms.letter_void", async () => {
    const l = await letterInScope(actor, id);
    if (!l) return fail("not_found", LETTER_NOT_FOUND);
    const r = await voidLetter(actor.repo(), actor.tenantId, l.id, actor.actor);
    return r.ok ? ok({ voided: true }) : fail("locked", "This letter was withdrawn already.");
  });
}

/* ------------------------------------------------------------------------------------------------
 * Billing's messages (enabled at M6): invoice / receipt / statement by email, payment link by text or email
 * ----------------------------------------------------------------------------------------------*/

export interface BillingDocumentMail {
  kind: "invoice" | "receipt" | "statement" | "payment_link";
  channel: "sms" | "email";
  patientId: string | null;
  /** An insurer's or solicitor's address (payer documents); null = the patient's own. */
  toAddress: string | null;
  documentId: string | null;
  number: string | null;
  amountPence: number | null;
  balancePence: number | null;
  dueOn: string | null;
  link: string | null;
  /** The document as plain text lines (the email carries it – nothing is attached). */
  documentLines: string[];
}

/** Billing's documents through the outbox. billing.view + messages.send (payment links: billing.pay too). */
export async function sendBillingMessageFor(actor: CommsActor, mail: BillingDocumentMail, deps?: DispatchDeps): Promise<Result<SentAnswer>> {
  if (!actor.can("billing.view") || !actor.can("messages.send")) return forbidden();
  if (mail.kind === "payment_link" && !actor.can("billing.pay")) return forbidden();
  return attempt("comms.billing_mail", async () => {
    if (mail.patientId && !(await patientInClinic(actor, mail.patientId))) return notFound();
    if (!mail.patientId && !mail.toAddress) return fail("invalid", "There is no email address for this account.");
    const d = depsOrFail(deps);
    if (!d) return fail("error", NOT_CONFIGURED);
    const money = (p: number | null) => (p === null ? null : formatPence(p));
    const r = await sendDocumentMessage(
      actor.repo(),
      actor.tenantId,
      {
        kind: mail.kind,
        channel: mail.channel,
        patientId: mail.patientId,
        to: mail.toAddress ? { kind: "other", address: mail.toAddress } : { kind: "patient" },
        values: {
          "billing.number": mail.number,
          "billing.amount": money(mail.amountPence),
          "billing.balance": money(mail.balancePence ?? mail.amountPence),
          "billing.due_date": mail.dueOn ? formatUkDate(mail.dueOn) : null,
          "billing.link": mail.link,
          "billing.document": mail.documentLines.join("\n"),
        },
        documentType: mail.kind === "payment_link" ? (mail.documentId ? "invoice" : null) : mail.kind,
        documentId: mail.documentId,
      },
      actor.actor,
      d,
    );
    return r.ok ? ok(sentAnswer(r)) : sendFailure(r);
  });
}

