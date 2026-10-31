/**
 * Records of the comms module as the repositories return them (camelCase; message and letter text decrypted only
 * in the single-record reads). Pure types – browser-safe. Inputs: ./schemas.ts.
 */
import type {
  ACTION_STATUSES,
  APPOINTMENT_MESSAGE_KINDS,
  CONSENT_SOURCES,
  DOCUMENT_TYPES,
  LETTER_RECIPIENT_KINDS,
  LETTER_SENT_VIA,
  LETTER_STATUSES,
  MESSAGE_CHANNELS,
  MESSAGE_DIRECTIONS,
  MESSAGE_KINDS,
  MESSAGE_PURPOSES,
  MESSAGE_STATUSES,
  REMINDER_TIMINGS,
  REPLY_INTENTS,
  SCHEDULE_STATUSES,
  SKIP_REASONS,
  TEMPLATE_KINDS,
} from "./schemas";

export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];
export type MessagePurpose = (typeof MESSAGE_PURPOSES)[number];
export type AppointmentMessageKind = (typeof APPOINTMENT_MESSAGE_KINDS)[number];
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];
export type ReplyIntent = (typeof REPLY_INTENTS)[number];
export type ActionStatus = (typeof ACTION_STATUSES)[number];
export type ConsentSource = (typeof CONSENT_SOURCES)[number];
export type ReminderTiming = (typeof REMINDER_TIMINGS)[number];
export type SkipReason = (typeof SKIP_REASONS)[number];
export type LetterStatus = (typeof LETTER_STATUSES)[number];
export type LetterRecipientKind = (typeof LETTER_RECIPIENT_KINDS)[number];
export type LetterSentVia = (typeof LETTER_SENT_VIA)[number];
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface CommsSettings {
  tenantId: string;
  /** 0 = nothing saved yet (the defaults below apply). */
  rev: number;
  confirmationsSms: boolean;
  confirmationsEmail: boolean;
  changeNotices: boolean;
  dnaFollowUp: boolean;
  smsSender: string | null;
  replyPhone: string | null;
  replyEmail: string | null;
  repliesEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  updatedAt: string | null;
}

export interface MessageTemplate {
  tenantId: string;
  /** A clinic template's id, or "standard:<key>" for a standard template (not stored). */
  id: string;
  rev: number;
  kind: TemplateKind;
  channel: MessageChannel;
  name: string;
  subject: string | null;
  body: string;
  isDefault: boolean;
  active: boolean;
  /** A standard template (read-only; "make a copy" to change it). */
  standard: boolean;
  importRef: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ReminderRule {
  tenantId: string;
  id: string;
  rev: number;
  name: string;
  channel: MessageChannel;
  timing: ReminderTiming;
  hoursBefore: number | null;
  daysBefore: number | null;
  sendAt: string | null;
  templateId: string | null;
  serviceIds: string[] | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A message the system will send for an appointment (confirmation, reminder, notice). */
export interface ScheduledMessage {
  tenantId: string;
  id: string;
  appointmentId: string;
  patientId: string;
  kind: AppointmentMessageKind;
  channel: MessageChannel;
  ruleId: string | null;
  dueAt: string;
  status: ScheduleStatus;
  startsAt: string;
  endsAt: string | null;
  siteId: string | null;
  practitionerId: string | null;
  serviceId: string | null;
  messageId: string | null;
  skipReason: SkipReason | null;
  attempts: number;
  /** A text moved out of the quiet hours. */
  held: boolean;
  createdAt: string;
  updatedAt: string;
}

/** What lists show: nothing decrypted. */
export interface MessageSummary {
  tenantId: string;
  id: string;
  patientId: string | null;
  direction: MessageDirection;
  channel: MessageChannel;
  purpose: MessagePurpose;
  kind: MessageKind;
  templateId: string | null;
  appointmentId: string | null;
  inReplyToId: string | null;
  toAddress: string | null;
  fromAddress: string | null;
  segments: number | null;
  status: MessageStatus;
  provider: string;
  errorCode: string | null;
  replyIntent: ReplyIntent | null;
  actionStatus: ActionStatus;
  sentAt: string | null;
  deliveredAt: string | null;
  documentType: DocumentType | null;
  documentId: string | null;
  attempts: number;
  /** A text held for the quiet hours (status queued) – released by the message run at this time. */
  holdUntil: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface Message extends MessageSummary {
  /** Decrypted (emails). */
  subject: string | null;
  /** Decrypted. */
  body: string;
  providerMessageId: string | null;
  actionedBy: string | null;
  actionedAt: string | null;
  failedAt: string | null;
  updatedAt: string;
}

export interface ConsentEvent {
  tenantId: string;
  id: string;
  patientId: string;
  channel: MessageChannel;
  purpose: MessagePurpose;
  action: "opt_in" | "opt_out";
  source: ConsentSource;
  messageId: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface LetterTemplate {
  tenantId: string;
  /** A clinic template's id, or "standard:<key>". */
  id: string;
  rev: number;
  name: string;
  recipientKind: LetterRecipientKind;
  subject: string;
  body: string;
  active: boolean;
  standard: boolean;
  importRef: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface LetterSummary {
  tenantId: string;
  id: string;
  rev: number;
  patientId: string;
  caseId: string | null;
  templateId: string | null;
  /** The template's name when the letter started ("Discharge letter to the GP") – plain, what lists show. */
  templateName: string | null;
  practitionerId: string | null;
  recipientKind: LetterRecipientKind;
  recipientReferrerId: string | null;
  recipientName: string | null;
  letterOn: string;
  status: LetterStatus;
  finalisedAt: string | null;
  finalisedBy: string | null;
  /** The signer's name, profession and registration, written when the letter is signed. */
  signatureText: string | null;
  sentAt: string | null;
  sentVia: LetterSentVia | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Letter extends LetterSummary {
  recipientAddress: string[] | null;
  recipientPostcode: string | null;
  recipientEmail: string | null;
  /** Decrypted. */
  subject: string;
  /** Decrypted. */
  body: string;
  voidedAt: string | null;
}

/** The plain contact and preference fields a message needs (read from the shared patient record). */
export interface MessagingContact {
  id: string;
  title: string | null;
  firstName: string;
  preferredName: string | null;
  lastName: string;
  phoneMobile: string | null;
  email: string | null;
  status: "active" | "archived" | "deceased";
  reminderSms: boolean;
  reminderEmail: boolean;
  marketingSms: boolean;
  marketingEmail: boolean;
}

/** Result of a server action in the comms screens. */
export type CommsActionResult = { ok: true; message?: string; id?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };
