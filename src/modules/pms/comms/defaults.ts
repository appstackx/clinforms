/**
 * The standard templates every clinic starts with (written for this product – no third-party wording) and the
 * defaults of the message settings. A clinic uses a standard template until it saves its own default for that
 * kind and channel ("make a copy" in the template screen). Pure.
 *
 * Appointment messages name the time, place and practitioner only – never the condition or treatment.
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

export const STANDARD_MESSAGE_TEMPLATES: readonly StandardMessageTemplate[] = [
  {
    key: "sms-confirmation",
    kind: "confirmation",
    channel: "sms",
    name: "Booking confirmation (text)",
    subject: null,
    body: "Hi {{patient.first_name}}, your appointment with {{clinic.name}} is booked for {{appointment.date}} at {{appointment.time}} at {{site.name}}. To change it, call {{site.phone}}.",
  },
  {
    key: "sms-reminder",
    kind: "reminder",
    channel: "sms",
    name: "Reminder (text)",
    subject: null,
    body: "Hi {{patient.first_name}}, a reminder of your appointment with {{appointment.with}} on {{appointment.date}} at {{appointment.time}} at {{site.name}}. {{reply.instructions}}",
  },
  {
    key: "sms-moved",
    kind: "moved",
    channel: "sms",
    name: "Appointment moved (text)",
    subject: null,
    body: "Hi {{patient.first_name}}, your appointment with {{clinic.name}} has moved to {{appointment.date}} at {{appointment.time}} at {{site.name}}. Questions? Call {{site.phone}}.",
  },
  {
    key: "sms-cancelled",
    kind: "cancelled",
    channel: "sms",
    name: "Appointment cancelled (text)",
    subject: null,
    body: "Hi {{patient.first_name}}, your appointment on {{appointment.date}} at {{appointment.time}} has been cancelled. To book again, call {{site.phone}}.",
  },
  {
    key: "email-confirmation",
    kind: "confirmation",
    channel: "email",
    name: "Booking confirmation (email)",
    subject: "Your appointment on {{appointment.date}}",
    body: [
      "Dear {{patient.first_name}},",
      "",
      "Your appointment is booked:",
      "",
      "{{appointment.date}} at {{appointment.time}} ({{appointment.duration}})",
      "With: {{appointment.with}}",
      "Where: {{site.name}}, {{site.address}}",
      "",
      "If you need to change or cancel it, please call us on {{site.phone}} at least 24 hours before.",
      "",
      "{{clinic.name}}",
    ].join("\n"),
  },
  {
    key: "email-reminder",
    kind: "reminder",
    channel: "email",
    name: "Reminder (email)",
    subject: "Reminder: your appointment on {{appointment.date}}",
    body: [
      "Dear {{patient.first_name}},",
      "",
      "This is a reminder of your appointment:",
      "",
      "{{appointment.date}} at {{appointment.time}}",
      "With: {{appointment.with}}",
      "Where: {{site.name}}, {{site.address}}",
      "",
      "If you cannot come, please call us on {{site.phone}} as soon as possible so we can offer the time to someone else.",
      "",
      "{{clinic.name}}",
    ].join("\n"),
  },
  {
    key: "email-moved",
    kind: "moved",
    channel: "email",
    name: "Appointment moved (email)",
    subject: "Your appointment has moved to {{appointment.date}}",
    body: [
      "Dear {{patient.first_name}},",
      "",
      "Your appointment has moved. The new time is:",
      "",
      "{{appointment.date}} at {{appointment.time}}",
      "With: {{appointment.with}}",
      "Where: {{site.name}}, {{site.address}}",
      "",
      "If the new time does not suit you, please call us on {{site.phone}}.",
      "",
      "{{clinic.name}}",
    ].join("\n"),
  },
  {
    key: "email-cancelled",
    kind: "cancelled",
    channel: "email",
    name: "Appointment cancelled (email)",
    subject: "Your appointment on {{appointment.date}} has been cancelled",
    body: [
      "Dear {{patient.first_name}},",
      "",
      "Your appointment on {{appointment.date}} at {{appointment.time}} has been cancelled.",
      "",
      "To book another appointment, please call us on {{site.phone}}.",
      "",
      "{{clinic.name}}",
    ].join("\n"),
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
  smsSender: null,
  replyPhone: null,
  replyEmail: null,
  repliesEnabled: true,
  quietStart: "20:00",
  quietEnd: "08:00",
  updatedAt: null,
};

/** The reminder most clinics use; offered with one click on the reminders screen. */
export const USUAL_REMINDER = { name: "Text the day before", channel: "sms", timing: "days_before", daysBefore: 1, sendAt: "10:00" } as const;

/** Text added where a template uses {{reply.instructions}} (texts, when replies are on). */
export const REPLY_INSTRUCTIONS = "Reply YES to confirm or NO to cancel.";
/** Added to every marketing text that does not already say how to stop. */
export const SMS_OPT_OUT = "Reply STOP to opt out.";

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
];

export function standardLetterTemplateByKey(key: string): StandardLetterTemplate | null {
  return STANDARD_LETTER_TEMPLATES.find((t) => t.key === key) ?? null;
}
