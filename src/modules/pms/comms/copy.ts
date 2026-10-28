/** Plain-English labels of the comms screens (UK English, neutral). Pure. */
import type {
  ActionStatus,
  ConsentSource,
  LetterRecipientKind,
  LetterSentVia,
  LetterStatus,
  MessageChannel,
  MessageKind,
  MessagePurpose,
  MessageStatus,
  ReplyIntent,
  ScheduleStatus,
  SkipReason,
  TemplateKind,
} from "./types";

export const CHANNEL_LABELS: Readonly<Record<MessageChannel, string>> = { sms: "Text", email: "Email" };

export const PURPOSE_LABELS: Readonly<Record<MessagePurpose, string>> = { service: "About their care", marketing: "Marketing" };

export const TEMPLATE_KIND_LABELS: Readonly<Record<TemplateKind, string>> = {
  confirmation: "Booking confirmation",
  reminder: "Appointment reminder",
  moved: "Appointment moved",
  cancelled: "Cancelled with notice",
  late_cancelled: "Late cancellation",
  dna: "Did not attend",
  offer: "Waiting list offer",
  general: "Message",
  marketing: "Marketing",
  payment_link: "Payment link",
  invoice: "Invoice",
  receipt: "Receipt",
  statement: "Statement",
  letter: "Letter",
  portal_link: "Portal sign-in",
};

export const KIND_LABELS: Readonly<Record<MessageKind, string>> = { ...TEMPLATE_KIND_LABELS, reply: "Reply" };

/** When a template's messages go (the template list's second line). */
export const TEMPLATE_WHEN: Readonly<Record<TemplateKind, string>> = {
  confirmation: "When booked (if the booking asks for it)",
  reminder: "Before the appointment (Message settings)",
  moved: "When the clinic moves an appointment",
  cancelled: "When an appointment is cancelled with notice",
  late_cancelled: "When cancelled under 24 hours before",
  dna: "1 hour after a missed appointment",
  offer: "Offer slot by text (waiting list)",
  general: "Sent by hand",
  marketing: "Sent by hand – opted-in patients only",
  payment_link: "Billing: payment link",
  invoice: "Billing: email an invoice",
  receipt: "Billing: email a receipt",
  statement: "Billing: email a statement",
  letter: "Letters: send by email",
  portal_link: "Patient portal sign-in",
};

/** What the status means for the person reading the log. */
export const STATUS_LABELS: Readonly<Record<MessageStatus, string>> = {
  queued: "Sending",
  outbox: "In the outbox – not sent",
  sent: "Sent",
  delivered: "Delivered",
  failed: "Failed",
  received: "Received",
};

/** Why a message failed (the provider's error codes and the test service's). */
export const ERROR_LABELS: Readonly<Record<string, string>> = {
  test_undeliverable: "Number not reachable",
  test_bounced: "Email address bounced",
  provider_error: "The message service did not accept it",
  undelivered: "Not delivered",
};

export const SCHEDULE_STATUS_LABELS: Readonly<Record<ScheduleStatus, string>> = {
  pending: "Planned",
  processing: "Sending",
  sent: "Done",
  skipped: "Not sent",
  cancelled: "Cancelled",
  failed: "Failed",
};

export const INTENT_LABELS: Readonly<Record<ReplyIntent, string>> = {
  confirm: "Confirmed",
  cancel: "Asked to cancel",
  stop: "Asked for no more texts",
  unknown: "Needs reading",
};

export const ACTION_STATUS_LABELS: Readonly<Record<ActionStatus, string>> = { none: "", to_action: "To action", done: "Dealt with" };

export const SKIP_REASON_LABELS: Readonly<Record<SkipReason, string>> = {
  deceased: "The patient's record says they have died.",
  archived: "The patient's record is archived.",
  no_mobile: "There is no mobile number on the record.",
  no_email: "There is no email address on the record.",
  opted_out: "Opted out of this kind of message by this route.",
  no_marketing_consent: "The patient has not agreed to marketing by this route.",
  too_late: "It was too close to the appointment to send.",
  appointment_cancelled: "The appointment was cancelled.",
  not_entitled: "The clinic does not use this part of the system.",
  provider_error: "The message service did not accept it.",
};

export const CONSENT_SOURCE_LABELS: Readonly<Record<ConsentSource, string>> = {
  staff: "Recorded by staff",
  sms_reply: "Patient replied STOP",
  email_link: "Patient used the stop-emails link",
  import: "Imported",
  portal: "Patient changed it online",
};

export const LETTER_STATUS_LABELS: Readonly<Record<LetterStatus, string>> = { draft: "Draft", final: "Final", void: "Withdrawn" };

export const RECIPIENT_KIND_LABELS: Readonly<Record<LetterRecipientKind, string>> = {
  patient: "The patient",
  gp: "The patient's GP",
  referrer: "A referrer or payer",
  other: "Someone else",
};

export const SENT_VIA_LABELS: Readonly<Record<LetterSentVia, string>> = { post: "By post", email: "By email", hand: "By hand" };

/** The outbox notice shown wherever messages appear while no provider sends them. */
export const OUTBOX_NOTICE =
  "Messages are written and kept here in the outbox. Nothing is sent to patients until the clinic's text and email service is switched on.";
export const TEST_MODE_NOTICE = "Test mode: messages go to a test service and never reach a patient.";
