/**
 * The standard templates every clinic starts with (written for this product – no third-party wording) and the
 * defaults of the message settings. A clinic uses a standard template until it saves its own default for that
 * kind and channel ("make a copy" in the template screen). Pure.
 *
 * Wording rules (design round 3, "Patient-facing messages"):
 * - Messages go out under the CLINIC's name (texts: its short sender name), never the product's.
 * - Appointment messages name the time, place and practitioner only – never the condition or treatment.
 * - Texts fit one 160-character GSM-7 text with typical values (straight quotes only: a curly quote makes the whole
 *   text UCS-2, 70 characters a part), and end "STOP to opt out".
 * - Emails say why the patient gets them; the reminder emails' footer has the stop-emails link (booking
 *   confirmations still go – they answer the patient's own booking).
 */
import type { CommsSettings, LetterRecipientKind, MessageChannel, TemplateKind } from "./types";

export const STANDARD_PREFIX = "standard:";

export interface StandardMessageTemplate {
  key: string;
  kind: TemplateKind;
  channel: MessageChannel;
  name: string;
  subject: string | null;
  body: string;
}

const lines = (...l: string[]) => l.join("\n");

/** The appointment card of an email ("When: …" lines become a small table in the HTML version). */
const APPOINTMENT_CARD = ["When: {{appointment.date}}, {{appointment.time}}–{{appointment.end_time}}", "What: {{appointment.type}}", "With: {{appointment.with}}", "Where: {{site.name}}, {{site.address}}"];

export const STANDARD_MESSAGE_TEMPLATES: readonly StandardMessageTemplate[] = [
  // Texts
  {
    key: "sms-confirmation",
    kind: "confirmation",
    channel: "sms",
    name: "Booking confirmation (text)",
    subject: null,
    body: "{{clinic.short_name}}: you're booked for {{appointment.day}} at {{appointment.time}} with {{appointment.with}}, {{site.name}}. To change it call {{site.phone}}. {{optout.sms}}",
  },
  {
    key: "sms-reminder",
    kind: "reminder",
    channel: "sms",
    name: "Appointment reminder (text)",
    subject: null,
    body: "{{clinic.short_name}}: reminder of your appt {{appointment.day}} at {{appointment.time}} with {{appointment.with}}, {{site.name}}. {{reply.instructions}} {{optout.sms}}",
  },
  {
    key: "sms-moved",
    kind: "moved",
    channel: "sms",
    name: "Appointment moved (text)",
    subject: null,
    body: "{{clinic.short_name}}: your appt has moved to {{appointment.day}} at {{appointment.time}} with {{appointment.with}}, {{site.name}}. Qs: {{site.phone}}. {{optout.sms}}",
  },
  {
    key: "sms-cancelled",
    kind: "cancelled",
    channel: "sms",
    name: "Cancelled with notice (text)",
    subject: null,
    body: "{{clinic.short_name}}: your appt {{appointment.day}} at {{appointment.time}} is cancelled. No charge. To rebook call {{site.phone}}. {{optout.sms}}",
  },
  {
    key: "sms-late-cancelled",
    kind: "late_cancelled",
    channel: "sms",
    name: "Late cancellation (text)",
    subject: null,
    body: "{{clinic.short_name}}: your appt {{appointment.day}} at {{appointment.time}} is cancelled. As this was under 24h notice, a fee may apply. Qs: {{site.phone}}. {{optout.sms}}",
  },
  {
    key: "sms-dna",
    kind: "dna",
    channel: "sms",
    name: "Did not attend (text)",
    subject: null,
    body: "{{clinic.short_name}}: we missed you at {{appointment.time}} on {{appointment.day}}. Please call {{site.phone}} to rebook. A missed-appt fee may apply. {{optout.sms}}",
  },
  {
    key: "sms-offer",
    kind: "offer",
    channel: "sms",
    name: "Waiting list: slot offered (text)",
    subject: null,
    body: "{{clinic.short_name}}: a slot is free {{appointment.day}} at {{appointment.time}} with {{appointment.with}}, {{site.name}}. Want it? Call {{site.phone}}. {{optout.sms}}",
  },
  {
    key: "sms-payment-link",
    kind: "payment_link",
    channel: "sms",
    name: "Payment link (text)",
    subject: null,
    body: "{{clinic.short_name}}: you have {{billing.balance}} to pay. You can pay securely here: {{billing.link}} Thank you.",
  },
  {
    key: "sms-general",
    kind: "general",
    channel: "sms",
    name: "Message (text)",
    subject: null,
    body: "{{clinic.short_name}}: ",
  },
  // Emails
  {
    key: "email-confirmation",
    kind: "confirmation",
    channel: "email",
    name: "Booking confirmation (email)",
    subject: "Booked: {{appointment.day}} at {{appointment.time}}",
    body: lines(
      "Hi {{patient.first_name}}, you're booked in.",
      "",
      ...APPOINTMENT_CARD,
      "",
      "Need to change it? Please call us on {{site.phone}} at least 24 hours before. After that, or if you don't come, a fee may be charged.",
    ),
  },
  {
    key: "email-reminder",
    kind: "reminder",
    channel: "email",
    name: "Appointment reminder (email)",
    subject: "Reminder: your appointment on {{appointment.day}} at {{appointment.time}}",
    body: lines(
      "Hi {{patient.first_name}}, this is a reminder of your appointment.",
      "",
      ...APPOINTMENT_CARD,
      "",
      "If you cannot come, please call us on {{site.phone}} as soon as possible so we can offer the time to someone else.",
    ),
  },
  {
    key: "email-moved",
    kind: "moved",
    channel: "email",
    name: "Appointment moved (email)",
    subject: "Your appointment has moved to {{appointment.day}} at {{appointment.time}}",
    body: lines("Hi {{patient.first_name}}, your appointment has moved. The new time is:", "", ...APPOINTMENT_CARD, "", "If the new time does not suit you, please call us on {{site.phone}}."),
  },
  {
    key: "email-cancelled",
    kind: "cancelled",
    channel: "email",
    name: "Cancelled with notice (email)",
    subject: "Your appointment on {{appointment.day}} is cancelled",
    body: lines("Hi {{patient.first_name}}, your appointment on {{appointment.date}} at {{appointment.time}} has been cancelled. There is no charge.", "", "To book another appointment, please call us on {{site.phone}}."),
  },
  {
    key: "email-late-cancelled",
    kind: "late_cancelled",
    channel: "email",
    name: "Late cancellation (email)",
    subject: "Your appointment on {{appointment.day}} is cancelled",
    body: lines(
      "Hi {{patient.first_name}}, your appointment on {{appointment.date}} at {{appointment.time}} has been cancelled.",
      "",
      "As this was less than 24 hours before the appointment, a late-cancellation fee may apply. If you have any questions, please call us on {{site.phone}}.",
    ),
  },
  {
    key: "email-dna",
    kind: "dna",
    channel: "email",
    name: "Did not attend (email)",
    subject: "We missed you on {{appointment.day}}",
    body: lines("Hi {{patient.first_name}}, we missed you at your appointment on {{appointment.date}} at {{appointment.time}}.", "", "Please call us on {{site.phone}} to book another time. A missed-appointment fee may apply."),
  },
  {
    key: "email-offer",
    kind: "offer",
    channel: "email",
    name: "Waiting list: slot offered (email)",
    subject: "An appointment is free on {{appointment.day}}",
    body: lines("Hi {{patient.first_name}}, an appointment has come free:", "", ...APPOINTMENT_CARD, "", "If you would like it, please call us on {{site.phone}}. It is not held until you confirm."),
  },
  {
    key: "email-payment-link",
    kind: "payment_link",
    channel: "email",
    name: "Payment link (email)",
    subject: "Your payment to {{clinic.name}}",
    body: lines("Hi {{patient.first_name}}, you have {{billing.balance}} to pay.", "", "You can pay securely here: {{billing.link}}", "", "Thank you."),
  },
  {
    key: "email-invoice",
    kind: "invoice",
    channel: "email",
    name: "Invoice (email)",
    subject: "Invoice {{billing.number}} from {{clinic.name}}",
    body: lines("Hello, here is invoice {{billing.number}} for {{billing.amount}}, due by {{billing.due_date}}.", "", "{{billing.document}}", "", "If you have any questions, please call us on {{clinic.phone}}."),
  },
  {
    key: "email-receipt",
    kind: "receipt",
    channel: "email",
    name: "Receipt (email)",
    subject: "Your receipt from {{clinic.name}}",
    body: lines("Hello, thank you for your payment of {{billing.amount}}.", "", "{{billing.document}}"),
  },
  {
    key: "email-statement",
    kind: "statement",
    channel: "email",
    name: "Statement (email)",
    subject: "Your statement from {{clinic.name}}",
    body: lines("Hello, here is your statement. The amount still to pay is {{billing.balance}}.", "", "{{billing.document}}", "", "If you have any questions, please call us on {{clinic.phone}}."),
  },
  {
    key: "email-letter",
    kind: "letter",
    channel: "email",
    name: "Letter (email)",
    subject: "{{document.title}}",
    body: lines("Dear {{recipient.name}},", "", "Please find below a letter from {{clinic.name}}.", "", "{{document.body}}"),
  },
  {
    key: "email-portal-link",
    kind: "portal_link",
    channel: "email",
    name: "Portal sign-in (email)",
    subject: "Your sign-in link",
    body: lines(
      "Hi {{patient.first_name}}, here's your link to see your appointments and forms:",
      "",
      "{{portal.link}}",
      "",
      "The link works once and expires in {{portal.expires}}. Don't forward this email.",
      "",
      "Didn't ask for this? You can ignore it – nobody can sign in without the link.",
    ),
  },
  {
    key: "email-general",
    kind: "general",
    channel: "email",
    name: "Message (email)",
    subject: "A message from {{clinic.name}}",
    body: lines("Hi {{patient.first_name}},", "", "", "", "{{clinic.name}}"),
  },
];

export function standardMessageTemplate(kind: TemplateKind, channel: MessageChannel): StandardMessageTemplate | null {
  return STANDARD_MESSAGE_TEMPLATES.find((t) => t.kind === kind && t.channel === channel) ?? null;
}

export function standardMessageTemplateByKey(key: string): StandardMessageTemplate | null {
  return STANDARD_MESSAGE_TEMPLATES.find((t) => t.key === key) ?? null;
}

export const DEFAULT_COMMS_SETTINGS: Omit<CommsSettings, "tenantId"> = {
  rev: 0,
  confirmationsSms: true,
  confirmationsEmail: true,
  changeNotices: true,
  dnaFollowUp: true,
  smsSender: null,
  replyPhone: null,
  replyEmail: null,
  repliesEnabled: true,
  quietStart: "20:00",
  quietEnd: "08:00",
  updatedAt: null,
};

/** The reminders most clinics use; offered with one click on the settings screen. */
export const USUAL_REMINDER = { name: "Text the day before", channel: "sms", timing: "hours_before", hoursBefore: 24 } as const;
export const USUAL_EMAIL_REMINDER = { name: "Email two days before", channel: "email", timing: "days_before", daysBefore: 2, sendAt: "10:00" } as const;

/** Text added where a template uses {{reply.instructions}} (texts, when replies are on). */
export const REPLY_INSTRUCTIONS = "Reply C to cancel.";
/** Every text that may be followed by more ends with this (design: "STOP to opt out"); marketing texts always. */
export const SMS_OPT_OUT = "STOP to opt out";
/** The last text after a STOP reply (design round 3). */
export const STOP_CONFIRMATION = "you won't get more texts from us. We'll email reminders instead.";


/* ------------------------------------------------------------------------------------------------
 * Letters
 * ----------------------------------------------------------------------------------------------*/

export interface StandardLetterTemplate {
  key: string;
  name: string;
  recipientKind: LetterRecipientKind;
  subject: string;
  body: string;
}

/** "[[…]]" marks text the author must write; a letter cannot be finalised while one remains. */
export const STANDARD_LETTER_TEMPLATES: readonly StandardLetterTemplate[] = [
  {
    key: "gp-assessment",
    name: "Assessment letter to the GP",
    recipientKind: "gp",
    subject: "{{patient.full_name}}, date of birth {{patient.date_of_birth}}",
    body: [
      "Dear {{recipient.name}},",
      "",
      "I assessed your patient on [[date of the assessment]] for {{case.title}}.",
      "",
      "Assessment",
      "[[Summarise the history and the findings]]",
      "",
      "Plan",
      "[[Treatment plan and expected number of sessions]]",
      "",
      "I will write again when treatment ends. Please contact me if you have any questions.",
      "",
      "Yours sincerely,",
      "",
      "",
      "{{author.name}}",
      "{{author.profession}}, registration number {{author.registration}}",
      "{{clinic.name}}",
    ].join("\n"),
  },
  {
    key: "gp-discharge",
    name: "Discharge letter to the GP",
    recipientKind: "gp",
    subject: "Discharge: {{patient.full_name}}, date of birth {{patient.date_of_birth}}",
    body: [
      "Dear {{recipient.name}},",
      "",
      "Your patient has now finished a course of treatment with us for {{case.title}}.",
      "",
      "Outcome",
      "[[Summarise progress and the outcome measures]]",
      "",
      "Advice given",
      "[[Home exercise programme and self-management advice]]",
      "",
      "We have discharged your patient from our care. They are welcome to contact us again if their symptoms return.",
      "",
      "Yours sincerely,",
      "",
      "",
      "{{author.name}}",
      "{{author.profession}}, registration number {{author.registration}}",
      "{{clinic.name}}",
    ].join("\n"),
  },
  {
    key: "payer-progress",
    name: "Progress report to the payer",
    recipientKind: "referrer",
    subject: "{{patient.full_name}} – your reference {{case.claim_reference}}",
    body: [
      "Dear {{recipient.name}},",
      "",
      "Re: {{patient.full_name}}, date of birth {{patient.date_of_birth}}",
      "",
      "Thank you for referring this patient for treatment of {{case.title}}.",
      "",
      "Progress",
      "[[Sessions attended so far and progress against the goals]]",
      "",
      "Recommendation",
      "[[Further sessions requested, or discharge]]",
      "",
      "Yours sincerely,",
      "",
      "",
      "{{author.name}}",
      "{{author.profession}}, registration number {{author.registration}}",
      "{{clinic.name}}, {{clinic.phone}}",
    ].join("\n"),
  },
  {
    key: "patient-dna",
    name: "Missed appointment – letter to the patient",
    recipientKind: "patient",
    subject: "Your missed appointment",
    body: [
      "Dear {{patient.full_name}},",
      "",
      "We are sorry we missed you at your appointment on [[date and time of the appointment]].",
      "",
      "If you would like to continue your treatment, please call us on {{clinic.phone}} to book another appointment. If we do not hear from you within 14 days, we will assume you no longer need our help and close your course of treatment.",
      "",
      "Yours sincerely,",
      "",
      "",
      "{{author.name}}",
      "{{clinic.name}}",
    ].join("\n"),
  },
  {
    key: "patient-general",
    name: "Letter to the patient",
    recipientKind: "patient",
    subject: "[[Subject]]",
    body: ["Dear {{patient.full_name}},", "", "[[Your letter]]", "", "Yours sincerely,", "", "", "{{author.name}}", "{{clinic.name}}"].join("\n"),
  },
  {
    key: "mlc-summary",
    name: "Medico-legal summary for the solicitor",
    recipientKind: "referrer",
    subject: "{{patient.full_name}} – your reference {{case.claim_reference}}",
    body: [
      "Dear {{recipient.name}},",
      "",
      "Re: {{patient.full_name}}, date of birth {{patient.date_of_birth}}",
      "Date of injury: {{case.injury_on}}",
      "",
      "Treatment",
      "First seen on {{case.first_visit}}; {{case.sessions}} sessions attended, the latest on {{case.last_visit}}.",
      "",
      "Summary",
      "[[Presentation, progress and current status]]",
      "",
      "Prognosis",
      "[[Expected recovery and any further treatment recommended]]",
      "",
      "Yours sincerely,",
      "",
      "",
      "{{author.name}}",
      "{{author.profession}}, registration number {{author.registration}}",
      "{{clinic.name}}",
    ].join("\n"),
  },
  {
    key: "attendance",
    name: "Attendance confirmation",
    recipientKind: "patient",
    subject: "Confirmation of attendance – {{patient.full_name}}",
    body: [
      "To whom it may concern,",
      "",
      "This is to confirm that {{patient.full_name}} attended appointments at {{clinic.name}} on: {{appointments.attended}}.",
      "",
      "Yours faithfully,",
      "",
      "",
      "{{author.name}}",
      "{{clinic.name}}",
    ].join("\n"),
  },
  {
    key: "appointment-letter",
    name: "Appointment letter",
    recipientKind: "patient",
    subject: "Your appointments",
    body: [
      "Dear {{patient.full_name}},",
      "",
      "Here are your next appointments:",
      "",
      "{{appointments.upcoming}}",
      "",
      "To change or cancel, please call us on {{clinic.phone}}. Changes are free with at least 24 hours' notice; otherwise a fee may be charged.",
      "",
      "Yours sincerely,",
      "",
      "",
      "{{clinic.name}}",
    ].join("\n"),
  },
];

export function standardLetterTemplateByKey(key: string): StandardLetterTemplate | null {
  return STANDARD_LETTER_TEMPLATES.find((t) => t.key === key) ?? null;
}
