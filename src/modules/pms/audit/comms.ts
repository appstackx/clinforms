/**
 * Audit actions of the comms module and their plain-English labels (owned by the comms builder – contract §7).
 * Codes: "pms.<entity>.<verb>", lower case. Every code a repository writes must be listed here. Details hold ids,
 * counts, channels and statuses only – never names, numbers, addresses or message text.
 */
export const COMMS_AUDIT_LABELS: Readonly<Record<string, string>> = {
  "pms.comms_settings.update": "Message settings changed",
  "pms.message_template.create": "Message template added",
  "pms.message_template.update": "Message template changed",
  "pms.reminder_rule.create": "Reminder added",
  "pms.reminder_rule.update": "Reminder changed",
  "pms.message_schedule.sync": "Appointment messages planned",
  "pms.message_schedule.opt_out": "Planned messages cancelled (patient opted out)",
  "pms.message_schedule.give_up": "Planned messages given up after repeated failures",
  "pms.message.retry": "Failed message sent again",
  "pms.message.send": "Message sent to a patient",
  "pms.message.bulk_send": "Planned messages sent",
  "pms.message.receive": "Reply received from a patient",
  "pms.message.status": "Message delivery updated",
  "pms.message.reply_done": "Patient's reply dealt with",
  "pms.consent.change": "Message preferences changed",
  "pms.letter_template.create": "Letter template added",
  "pms.letter_template.update": "Letter template changed",
  "pms.letter.create": "Letter started",
  "pms.letter.update": "Letter edited",
  "pms.letter.finalise": "Letter finalised",
  "pms.letter.sent": "Letter marked as sent",
  "pms.letter.void": "Letter withdrawn",
  "pms.comms_demo.seed": "Demonstration messages and letters loaded",
};

/** Names of the record types its audit rows point at (target_type → label). */
export const COMMS_AUDIT_TARGETS: Readonly<Record<string, string>> = {
  pms_comms_settings: "Message settings",
  pms_message_template: "Message template",
  pms_reminder_rule: "Reminder",
  pms_message_schedule: "Planned message",
  pms_message: "Message",
  pms_consent_event: "Message preference",
  pms_letter_template: "Letter template",
  pms_letter: "Letter",
};
