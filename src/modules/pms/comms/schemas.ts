/**
 * The comms module's inputs (zod v4): message settings, message and letter templates, reminder rules, the
 * appointment snapshot the diary hands over, manual messages, replies, consent changes and letters.
 * SOURCE OF TRUTH for what the comms repositories (src/server/repos/pms/comms/*) accept. Pure – browser-safe.
 *
 * Conventions as in core/schemas.ts: camelCase, dates "YYYY-MM-DD", times "HH:MM" (Europe/London), optional text
 * undefined = unchanged, null or "" = clear it. Message and letter bodies are encrypted at rest by the
 * repositories; templates are the clinic's own boilerplate and stay plain (they never hold patient data).
 */
import { z } from "zod";
import {
  AddressLinesSchema,
  EmailSchema,
  IsoDateSchema,
  MarketingSourceSchema,
  PhoneSchema,
  PmsIdSchema,
  PostcodeSchema,
  ImportRefSchema,
  optionalText,
  requiredText,
} from "../core/schemas";
import { checkTemplate, contextForKind } from "./merge-fields";

/* ------------------------------------------------------------------------------------------------
 * Enumerations
 * ----------------------------------------------------------------------------------------------*/

export const MESSAGE_CHANNELS = ["sms", "email"] as const;
export const MessageChannelSchema = z.enum(MESSAGE_CHANNELS);

/** Service messages (appointments, the patient's care) vs marketing (PECR: opt-in only). */
export const MESSAGE_PURPOSES = ["service", "marketing"] as const;
export const MessagePurposeSchema = z.enum(MESSAGE_PURPOSES);

/** Appointment messages the system sends by itself. */
export const APPOINTMENT_MESSAGE_KINDS = ["confirmation", "reminder", "moved", "cancelled"] as const;
export const AppointmentMessageKindSchema = z.enum(APPOINTMENT_MESSAGE_KINDS);

/** What a template is for. "general" = a message staff send by hand; "marketing" = news and offers (opt-in). */
export const TEMPLATE_KINDS = [...APPOINTMENT_MESSAGE_KINDS, "general", "marketing"] as const;
export const TemplateKindSchema = z.enum(TEMPLATE_KINDS);

/** Kinds in the message log ("reply" = a text the patient sent back). */
export const MESSAGE_KINDS = [...TEMPLATE_KINDS, "reply"] as const;

export const MESSAGE_DIRECTIONS = ["outbound", "inbound"] as const;

/**
 * queued    – written, not yet handed to the provider;
 * outbox    – the outbox provider: recorded here and NOT sent (the default until a provider is set up);
 * sent      – the provider accepted it; delivered / failed – the provider's receipt;
 * received  – an inbound reply.
 */
export const MESSAGE_STATUSES = ["queued", "outbox", "sent", "delivered", "failed", "received"] as const;

export const SCHEDULE_STATUSES = ["pending", "processing", "sent", "skipped", "cancelled", "failed"] as const;

export const REPLY_INTENTS = ["confirm", "cancel", "stop", "unknown"] as const;

/** Inbound replies that need a person: to_action → done. */
export const ACTION_STATUSES = ["none", "to_action", "done"] as const;

export const CONSENT_SOURCES = ["staff", "sms_reply", "email_link", "import", "portal"] as const;
export const ConsentSourceSchema = z.enum(CONSENT_SOURCES);

export const REMINDER_TIMINGS = ["hours_before", "days_before"] as const;
export const ReminderTimingSchema = z.enum(REMINDER_TIMINGS);

/** Why a planned or requested message was not sent. */
export const SKIP_REASONS = [
  "deceased",
  "archived",
  "no_mobile",
  "no_email",
  "opted_out",
  "no_marketing_consent",
  "too_late",
  "appointment_cancelled",
  "not_entitled",
  "provider_error",
] as const;

export const LETTER_STATUSES = ["draft", "final", "void"] as const;
export const LETTER_RECIPIENT_KINDS = ["patient", "gp", "referrer", "other"] as const;
export const LetterRecipientKindSchema = z.enum(LETTER_RECIPIENT_KINDS);
export const LETTER_SENT_VIA = ["post", "email", "hand"] as const;
export const LetterSentViaSchema = z.enum(LETTER_SENT_VIA);

/* ------------------------------------------------------------------------------------------------
 * Primitives
 * ----------------------------------------------------------------------------------------------*/

/** "HH:MM", 24 h, Europe/London. */
export const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const HhmmSchema = z.string().trim().regex(HHMM_PATTERN, "Enter a time as HH:MM (24 hour)");

/** An instant: ISO-8601 with a zone ("2026-10-27T14:30:00.000Z" or "+01:00"). */
export function isIsoInstant(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));
}
export const IsoInstantSchema = z.string().refine(isIsoInstant, "Not a date and time with its time zone");

/** An alphanumeric SMS sender name: 3–11 letters, digits or spaces, at least one letter (UK networks' rule). */
export const SMS_SENDER_PATTERN = /^(?=.*[A-Za-z])[A-Za-z0-9 ]{3,11}$/;

export const SMS_BODY_MAX = 918; // 6 GSM-7 segments
export const EMAIL_BODY_MAX = 8000;
export const LETTER_BODY_MAX = 20000;

/* ------------------------------------------------------------------------------------------------
 * Message settings (one row per clinic)
 * ----------------------------------------------------------------------------------------------*/

export const CommsSettingsInputSchema = z
  .object({
    /** Send a booking confirmation by text / email when an appointment is booked. */
    confirmationsSms: z.boolean().optional(),
    confirmationsEmail: z.boolean().optional(),
    /** Tell the patient when the clinic moves or cancels an appointment. */
    changeNotices: z.boolean().optional(),
    /** Name shown as the sender of texts (where the network allows it). */
    smsSender: z
      .union([z.string(), z.null()])
      .optional()
      .transform((v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v))
      .refine((v) => v === undefined || v === null || SMS_SENDER_PATTERN.test(v), "3–11 letters, digits or spaces, with at least one letter"),
    /** The number patients call (shown in messages when the site has none). */
    replyPhone: PhoneSchema,
    replyEmail: EmailSchema,
    /** Reminders by text invite "Reply YES to confirm or NO to cancel". */
    repliesEnabled: z.boolean().optional(),
    /** No texts between these times (UK time). Equal times = no quiet hours. */
    quietStart: HhmmSchema.optional(),
    quietEnd: HhmmSchema.optional(),
  })
  .strict();
export type CommsSettingsInput = z.input<typeof CommsSettingsInputSchema>;

/* ------------------------------------------------------------------------------------------------
 * Message templates
 * ----------------------------------------------------------------------------------------------*/

const templateShape = {
  kind: TemplateKindSchema,
  channel: MessageChannelSchema,
  name: requiredText(120),
  /** Email only. */
  subject: optionalText(200),
  body: requiredText(EMAIL_BODY_MAX),
  /** The template automatic messages of its kind and channel use (one per kind and channel). */
  isDefault: z.boolean().optional(),
  active: z.boolean().optional(),
  importRef: ImportRefSchema,
};

function checkTemplateInput(v: { kind?: string; channel?: string; subject?: string | null; body?: string }, ctx: z.RefinementCtx): void {
  if (!v.kind || !v.channel) return;
  const channel = v.channel as (typeof MESSAGE_CHANNELS)[number];
  const kind = v.kind as (typeof TEMPLATE_KINDS)[number];
  if (channel === "email" && v.subject === null) ctx.addIssue({ code: "custom", path: ["subject"], message: "An email needs a subject" });
  if (channel === "sms" && typeof v.body === "string" && v.body.length > SMS_BODY_MAX) {
    ctx.addIssue({ code: "custom", path: ["body"], message: `A text can be at most ${SMS_BODY_MAX} characters` });
  }
  for (const [path, text] of [
    ["body", v.body],
    ["subject", v.subject],
  ] as const) {
    if (typeof text !== "string") continue;
    const result = checkTemplate(text, contextForKind(kind), channel);
    for (const error of result.errors) ctx.addIssue({ code: "custom", path: [path], message: error });
  }
}

export const MessageTemplateInputSchema = z
  .object(templateShape)
  .superRefine((v, ctx) => {
    if (v.channel === "email" && !v.subject) ctx.addIssue({ code: "custom", path: ["subject"], message: "An email needs a subject" });
    checkTemplateInput(v, ctx);
  });
export type MessageTemplateInput = z.input<typeof MessageTemplateInputSchema>;

/** Kind and channel never change (make a new template instead). The repository re-checks the merge fields. */
export const MessageTemplatePatchSchema = z.object({
  name: templateShape.name.optional(),
  subject: templateShape.subject,
  body: templateShape.body.optional(),
  isDefault: templateShape.isDefault,
  active: templateShape.active,
});
export type MessageTemplatePatch = z.input<typeof MessageTemplatePatchSchema>;

/** Re-checks a template's merged result after a patch (kind and channel from the stored row). */
export function messageTemplateCheck(kind: (typeof TEMPLATE_KINDS)[number], channel: (typeof MESSAGE_CHANNELS)[number]) {
  return z
    .object({ subject: z.union([z.string(), z.null()]), body: z.string() })
    .superRefine((v, ctx) => {
      if (channel === "email" && !v.subject) ctx.addIssue({ code: "custom", path: ["subject"], message: "An email needs a subject" });
      checkTemplateInput({ kind, channel, subject: v.subject, body: v.body }, ctx);
    });
}

/* ------------------------------------------------------------------------------------------------
 * Reminder rules ("1 day before at 10:00 by text")
 * ----------------------------------------------------------------------------------------------*/

const ruleShape = {
  name: requiredText(80),
  channel: MessageChannelSchema,
  timing: ReminderTimingSchema,
  /** hours_before: 1–168 hours before the start. */
  hoursBefore: z.union([z.number().int().min(1, "At least 1 hour").max(168, "At most 168 hours (7 days)"), z.null()]).optional(),
  /** days_before: 1–14 days before, at sendAt (UK time). */
  daysBefore: z.union([z.number().int().min(1, "At least 1 day").max(14, "At most 14 days"), z.null()]).optional(),
  sendAt: z.union([HhmmSchema, z.null()]).optional(),
  /** A reminder template of the same channel; null = the clinic's default reminder. */
  templateId: z.union([PmsIdSchema, z.null()]).optional(),
  /** Only these appointment types (null = all). */
  serviceIds: z.union([z.array(PmsIdSchema).max(50, "At most 50 appointment types"), z.null()]).optional(),
  active: z.boolean().optional(),
};

function checkRule(v: { timing?: string; hoursBefore?: number | null; daysBefore?: number | null; sendAt?: string | null }, ctx: z.RefinementCtx): void {
  if (v.timing === "hours_before" && !v.hoursBefore) ctx.addIssue({ code: "custom", path: ["hoursBefore"], message: "Enter how many hours before" });
  if (v.timing === "days_before") {
    if (!v.daysBefore) ctx.addIssue({ code: "custom", path: ["daysBefore"], message: "Enter how many days before" });
    if (!v.sendAt) ctx.addIssue({ code: "custom", path: ["sendAt"], message: "Enter the time to send it" });
  }
}

export const ReminderRuleInputSchema = z.object(ruleShape).superRefine(checkRule);
export type ReminderRuleInput = z.input<typeof ReminderRuleInputSchema>;
export const ReminderRulePatchSchema = z.object(ruleShape).partial();
export type ReminderRulePatch = z.input<typeof ReminderRulePatchSchema>;
/** The rule after a patch is merged with the stored row. */
export const ReminderRuleMergedSchema = z.object(ruleShape).superRefine(checkRule);

/* ------------------------------------------------------------------------------------------------
 * The appointment as the diary hands it over (comms keeps the snapshot it needs to write the message)
 * ----------------------------------------------------------------------------------------------*/

export const AppointmentForMessagesSchema = z.object({
  id: PmsIdSchema,
  patientId: PmsIdSchema,
  startsAt: IsoInstantSchema,
  endsAt: z.union([IsoInstantSchema, z.null()]).optional(),
  siteId: z.union([PmsIdSchema, z.null()]).optional(),
  practitionerId: z.union([PmsIdSchema, z.null()]).optional(),
  serviceId: z.union([PmsIdSchema, z.null()]).optional(),
  /** false = cancelled, did not attend or otherwise not going ahead (pending reminders are cancelled). */
  active: z.boolean(),
});
export type AppointmentForMessages = z.input<typeof AppointmentForMessagesSchema>;

/** What the diary asks for besides reminders: a booking confirmation, a "moved" notice, a cancellation notice. */
export const APPOINTMENT_NOTIFY = ["none", "confirmation", "moved", "cancelled"] as const;
export const AppointmentNotifySchema = z.enum(APPOINTMENT_NOTIFY);

/* ------------------------------------------------------------------------------------------------
 * A message staff send by hand (from the patient's record)
 * ----------------------------------------------------------------------------------------------*/

export const ManualMessageInputSchema = z
  .object({
    patientId: PmsIdSchema,
    channel: MessageChannelSchema,
    purpose: MessagePurposeSchema.optional(),
    /** A template the text started from (general or marketing). */
    templateId: z.union([PmsIdSchema, z.null()]).optional(),
    subject: optionalText(200),
    body: requiredText(EMAIL_BODY_MAX),
  })
  .superRefine((v, ctx) => {
    if (v.channel === "email" && !v.subject) ctx.addIssue({ code: "custom", path: ["subject"], message: "An email needs a subject" });
    if (v.channel === "sms" && v.body.length > SMS_BODY_MAX) ctx.addIssue({ code: "custom", path: ["body"], message: `A text can be at most ${SMS_BODY_MAX} characters` });
    const result = checkTemplate(v.body, v.purpose === "marketing" ? "marketing" : "general", v.channel);
    for (const error of result.errors) ctx.addIssue({ code: "custom", path: ["body"], message: error });
  });
export type ManualMessageInput = z.input<typeof ManualMessageInputSchema>;

/* ------------------------------------------------------------------------------------------------
 * Inbound texts (the SMS provider's webhook, or the "simulate a reply" test tool)
 * ----------------------------------------------------------------------------------------------*/

export const InboundSmsSchema = z.object({
  /** The patient's number as the provider gives it ("+447700900123"). */
  from: z.string().trim().min(6).max(24),
  text: z.string().max(1600),
  /** The provider's id of the inbound message (a webhook sent twice is stored once). */
  providerMessageId: z.union([z.string().trim().min(1).max(120), z.null()]).optional(),
  receivedAt: z.union([IsoInstantSchema, z.null()]).optional(),
  /** Simulated replies point at the message they answer. */
  inReplyToId: z.union([PmsIdSchema, z.null()]).optional(),
});
export type InboundSms = z.input<typeof InboundSmsSchema>;

/** A delivery receipt from the provider. */
export const DeliveryReceiptSchema = z.object({
  providerMessageId: z.string().trim().min(1).max(120),
  status: z.enum(["delivered", "failed"]),
  errorCode: z.union([z.string().trim().regex(/^[a-z0-9_.-]{1,40}$/i), z.null()]).optional(),
  at: z.union([IsoInstantSchema, z.null()]).optional(),
});
export type DeliveryReceipt = z.input<typeof DeliveryReceiptSchema>;

/* ------------------------------------------------------------------------------------------------
 * Consent (message preferences) – the flags live on the shared patient record; comms records how they changed
 * ----------------------------------------------------------------------------------------------*/

export const ConsentChangeSchema = z
  .object({
    patientId: PmsIdSchema,
    channel: MessageChannelSchema,
    purpose: MessagePurposeSchema,
    /** true = opt in, false = opt out. */
    value: z.boolean(),
    source: ConsentSourceSchema,
    /** How the patient agreed to marketing (required to opt in to marketing). */
    marketingConsentSource: z.union([MarketingSourceSchema, z.null()]).optional(),
    messageId: z.union([PmsIdSchema, z.null()]).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.purpose === "marketing" && v.value && !v.marketingConsentSource) {
      ctx.addIssue({ code: "custom", path: ["marketingConsentSource"], message: "Record how the patient agreed to marketing" });
    }
  });
export type ConsentChange = z.input<typeof ConsentChangeSchema>;

/* ------------------------------------------------------------------------------------------------
 * Letters and letter templates
 * ----------------------------------------------------------------------------------------------*/

const letterTemplateShape = {
  name: requiredText(120),
  recipientKind: LetterRecipientKindSchema,
  subject: requiredText(200),
  body: requiredText(LETTER_BODY_MAX),
  active: z.boolean().optional(),
  importRef: ImportRefSchema,
};

function checkLetterTemplate(v: { subject?: string; body?: string }, ctx: z.RefinementCtx): void {
  for (const [path, text] of [
    ["subject", v.subject],
    ["body", v.body],
  ] as const) {
    if (typeof text !== "string") continue;
    for (const error of checkTemplate(text, "letter", null).errors) ctx.addIssue({ code: "custom", path: [path], message: error });
  }
}

export const LetterTemplateInputSchema = z.object(letterTemplateShape).superRefine(checkLetterTemplate);
export type LetterTemplateInput = z.input<typeof LetterTemplateInputSchema>;
export const LetterTemplatePatchSchema = z.object(letterTemplateShape).partial().superRefine(checkLetterTemplate);
export type LetterTemplatePatch = z.input<typeof LetterTemplatePatchSchema>;

const letterShape = {
  caseId: z.union([PmsIdSchema, z.null()]).optional(),
  practitionerId: z.union([PmsIdSchema, z.null()]).optional(),
  recipientKind: LetterRecipientKindSchema,
  /** The GP, insurer, solicitor… from the clinic's directory, when the letter goes to one. */
  recipientReferrerId: z.union([PmsIdSchema, z.null()]).optional(),
  recipientName: optionalText(160),
  recipientAddress: AddressLinesSchema,
  recipientPostcode: PostcodeSchema,
  recipientEmail: EmailSchema,
  letterOn: IsoDateSchema,
  subject: requiredText(200),
  body: requiredText(LETTER_BODY_MAX),
};

export const LetterInputSchema = z.object({
  patientId: PmsIdSchema,
  /** The template the letter was written from (a clinic template id, or a standard one's key). */
  templateId: z.union([PmsIdSchema, z.null()]).optional(),
  ...letterShape,
});
export type LetterInput = z.input<typeof LetterInputSchema>;

export const LetterPatchSchema = z.object(letterShape).omit({ recipientKind: true }).partial();
export type LetterPatch = z.input<typeof LetterPatchSchema>;
