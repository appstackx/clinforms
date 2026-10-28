/**
 * What the comms screens receive from the server (src/server/pms/comms/views.ts) – plain data, browser-safe. Lists
 * never carry a message's text (it is encrypted at rest and only one message is opened at a time): an outbox row
 * says what the message is for ("Reminder · Wed 28/10 11:30") from plain fields.
 */
import type { LetterRecipientKind, LetterStatus, MessageChannel, MessagePurpose, ReplyIntent, TemplateKind } from "./types";

/** Outbox row status (design round 2c): Planned, Held – quiet hours, Sent, Delivered, Failed, In the outbox, Opted out / Not sent, Cancelled. */
export type OutboxState = "planned" | "held" | "sending" | "outbox" | "sent" | "delivered" | "failed" | "skipped" | "cancelled";

export interface OutboxRowView {
  /** "msg_…" for a message, "msch_…" for a planned one. */
  id: string;
  messageId: string | null;
  /** When it goes / went (ISO). */
  at: string;
  patientId: string | null;
  patientName: string | null;
  /** Phone number or email address. */
  address: string | null;
  channel: MessageChannel;
  kind: TemplateKind;
  /** "Reminder · Wed 28/10 at 11:30" – never the message text. */
  summary: string;
  state: OutboxState;
  /** Why it failed or was not sent, or when a held text goes. */
  why: string | null;
  canRetry: boolean;
}

export interface OutboxCounts {
  planned: number;
  sent: number;
  failed: number;
  held: number;
  optedOut: number;
  outbox: number;
}

export interface MessagesHomeView {
  counts: OutboxCounts;
  quietStart: string;
  quietEnd: string;
  /** Replies waiting for someone (the tab's and the nav's number). */
  toAction: number;
  /** "outbox" = nothing leaves the system; "test" = a test service; "misconfigured". */
  mode: { sms: "outbox" | "test" | "misconfigured"; email: "outbox" | "test" | "misconfigured" };
  /** messages.templates: may change templates and settings, and run the due messages now. */
  canManage: boolean;
  /** messages.letters: may open and write letters. */
  canLetters: boolean;
}

export interface ReplyRowView {
  id: string;
  patientId: string | null;
  patientName: string | null;
  from: string | null;
  at: string;
  intent: ReplyIntent | null;
  toAction: boolean;
}

export interface ThreadMessageView {
  id: string;
  direction: "outbound" | "inbound";
  channel: MessageChannel;
  text: string;
  at: string;
  label: string;
}

export interface ReplyThreadView {
  reply: ReplyRowView;
  /** The message it answers, the reply and any answers since, oldest first (decrypted – one thread at a time). */
  messages: ThreadMessageView[];
  /** Whether the patient can still be texted (answer by text), else by email, else neither. */
  answerChannel: MessageChannel | null;
  answerBlockedWhy: string | null;
}

export interface TemplateRowView {
  id: string;
  name: string;
  kind: TemplateKind;
  channel: MessageChannel;
  subject: string | null;
  body: string;
  standard: boolean;
  isDefault: boolean;
  active: boolean;
  rev: number;
  /** "Text · 24 h before" etc. */
  meta: string;
}

export interface MergeFieldView {
  key: string;
  label: string;
  example: string;
}

export interface LetterRowView {
  id: string;
  patientId: string;
  patientName: string;
  /** The template's name (letters' subjects are encrypted – lists show the template). */
  title: string;
  recipientName: string | null;
  recipientKind: LetterRecipientKind;
  letterOn: string;
  status: LetterStatus;
  sentVia: string | null;
  authorName: string | null;
}

export interface PatientContactView {
  id: string;
  name: string;
  mobile: string | null;
  email: string | null;
  /** Each channel: null = can be used; otherwise why not (plain words). */
  sms: string | null;
  smsMarketing: string | null;
  emailService: string | null;
  emailMarketing: string | null;
}

export interface SendFormView {
  patient: PatientContactView | null;
  templates: { id: string; name: string; channel: MessageChannel; purpose: MessagePurpose; subject: string | null; body: string }[];
  /** For the editor's preview. */
  shortName: string;
  clinicName: string;
}

export interface PatientMessagesView {
  patient: PatientContactView;
  rows: OutboxRowView[];
  letters: LetterRowView[];
  consent: { at: string; label: string }[];
  canSend: boolean;
  canLetters: boolean;
}
