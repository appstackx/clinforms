/** The comms module's pure rules: merge fields, text segments, when messages go, consent, replies, inputs. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { messageBlock, addressFor, greetingName } from "./consent";
import { STANDARD_LETTER_TEMPLATES, STANDARD_MESSAGE_TEMPLATES, standardMessageTemplate } from "./defaults";
import { checkTemplate, contextForKind, exampleValues, fieldsFor, hasUnfilledFields, renderTemplate } from "./merge-fields";
import { interpretReply, replyNeedsAction } from "./replies";
import {
  dedupeKey,
  formatAppointmentDate,
  formatAppointmentDateShort,
  formatAppointmentTime,
  formatDuration,
  formatLongDate,
  isQuietTime,
  londonParts,
  londonToUtcIso,
  outOfQuietHours,
  planAppointmentMessages,
  reminderDueAt,
  stillWorthSending,
} from "./schedule";
import {
  AppointmentForMessagesSchema,
  CommsSettingsInputSchema,
  ConsentChangeSchema,
  ManualMessageInputSchema,
  MessageTemplateInputSchema,
  ReminderRuleInputSchema,
  isIsoInstant,
} from "./schemas";
import { isGsm7, isSmsCapable, normaliseSmsText, smsAddressKey, smsInfo, toE164 } from "./sms";
import type { MessagingContact } from "./types";

describe("merge fields", () => {
  it("renders known fields, tidies the gaps a missing value leaves in a message", () => {
    const r = renderTemplate("Hi {{patient.first_name}}, see you at {{ appointment.time }} ({{site.name}}).", { "patient.first_name": "Megan", "appointment.time": "14:30" }, { missing: "empty" });
    assert.equal(r.text, "Hi Megan, see you at 14:30.");
    assert.deepEqual(r.missing, ["site.name"]);
  });

  it("letters show a visible marker for a missing value and cannot be finalised while one remains", () => {
    const r = renderTemplate("Dear {{gp.name}},", {}, { missing: "marker" });
    assert.equal(r.text, "Dear [not recorded: GP's name],");
    assert.equal(hasUnfilledFields(r.text), true);
    assert.equal(hasUnfilledFields("Dear Dr Ward,\n[[Summarise the findings]]"), true, "a gap to write");
    assert.equal(hasUnfilledFields("Dear Dr Ward,\nAll done."), false);
  });

  it("checks fields per context and channel: appointment messages never name the condition", () => {
    assert.deepEqual(checkTemplate("Hi {{patient.first_name}} {{appointment.date}}", "appointment", "sms").errors, []);
    assert.match(checkTemplate("{{case.title}}", "appointment", "sms").errors[0], /cannot be used in an appointment message/);
    assert.match(checkTemplate("{{appointment.date}}", "general", "sms").errors[0], /general message/);
    assert.match(checkTemplate("{{unsubscribe.link}}", "appointment", "sms").errors[0], /only be used in emails/);
    assert.match(checkTemplate("{{reply.instructions}}", "appointment", "email").errors[0], /only be used in texts/);
    assert.match(checkTemplate("{{patient.nhs_number}}", "letter", null).errors[0], /not a merge field/);
    assert.match(checkTemplate("Hi {{patient.first_name}", "general", "sms").errors[0], /braces/);
    assert.deepEqual(checkTemplate("{{case.title}} {{gp.surgery}}", "letter", null).errors, []);
    assert.equal(contextForKind("reminder"), "appointment");
    assert.equal(contextForKind("marketing"), "marketing");
  });

  it("the editor offers only the allowed fields; every example value renders", () => {
    const sms = fieldsFor("appointment", "sms").map((f) => f.key);
    assert.ok(sms.includes("reply.instructions") && !sms.includes("unsubscribe.link") && !sms.includes("case.title"));
    assert.ok(fieldsFor("letter", null).some((f) => f.key === "gp.surgery"));
    const all = renderTemplate("{{patient.first_name}} {{clinic.name}}", exampleValues(), { missing: "empty" });
    assert.equal(all.text, "Megan Riverside Physiotherapy (fictional)");
  });

  it("every standard template passes its own check", () => {
    for (const t of STANDARD_MESSAGE_TEMPLATES) {
      for (const text of [t.body, t.subject ?? ""]) assert.deepEqual(checkTemplate(text, contextForKind(t.kind), t.channel).errors, [], t.key);
      assert.equal(MessageTemplateInputSchema.safeParse({ kind: t.kind, channel: t.channel, name: t.name, subject: t.subject, body: t.body }).success, true, t.key);
    }
    for (const t of STANDARD_LETTER_TEMPLATES) for (const text of [t.subject, t.body]) assert.deepEqual(checkTemplate(text, "letter", null).errors, [], t.key);
    assert.equal(standardMessageTemplate("reminder", "sms")?.key, "sms-reminder");
    assert.equal(standardMessageTemplate("general", "sms"), null);
  });

  it("standard reminders by text stay within two segments with typical values", () => {
    const t = standardMessageTemplate("reminder", "sms");
    const text = renderTemplate(t?.body ?? "", { ...exampleValues(), "reply.instructions": "Reply YES to confirm or NO to cancel." }, { missing: "empty" }).text;
    assert.ok(smsInfo(text).segments <= 2, `${smsInfo(text).segments} segments`);
    assert.ok(isGsm7(text));
  });
});

describe("texts", () => {
  it("counts GSM-7 and UCS-2 segments", () => {
    assert.deepEqual(smsInfo("a".repeat(160)), { encoding: "gsm7", units: 160, segments: 1, perSegment: 160 });
    assert.deepEqual(smsInfo("a".repeat(161)), { encoding: "gsm7", units: 161, segments: 2, perSegment: 153 });
    assert.equal(smsInfo("€".repeat(80)).units, 160, "extension characters count twice");
    assert.equal(smsInfo("€".repeat(81)).segments, 2);
    assert.deepEqual(smsInfo("Hi 😀"), { encoding: "ucs2", units: 5, segments: 1, perSegment: 70 });
    assert.equal(smsInfo("é".repeat(71)).encoding, "gsm7", "é is in GSM-7");
    assert.equal(smsInfo("ć".repeat(71)).segments, 2, "ć is not");
    assert.equal(smsInfo("").segments, 0);
  });

  it("swaps typographic characters for plain ones", () => {
    const text = normaliseSmsText("It’s “fine” – really…");
    assert.equal(text, "It's \"fine\" - really...");
    assert.ok(isGsm7(text));
  });

  it("mobile numbers only; reply keys and E.164", () => {
    assert.equal(isSmsCapable("07700 900123"), true);
    assert.equal(isSmsCapable("+44 7700 900123"), true);
    assert.equal(isSmsCapable("01632 960001"), false, "a landline");
    assert.equal(isSmsCapable("+353 85 123 4567"), true);
    assert.equal(isSmsCapable(null), false);
    assert.equal(smsAddressKey("+44 7700 900123"), "07700900123");
    assert.equal(toE164("07700 900123"), "+447700900123");
    assert.equal(toE164("+353 85 123 4567"), "+353851234567");
  });
});

describe("UK time and when messages go", () => {
  it("converts UK wall-clock times across the clock changes", () => {
    assert.equal(londonToUtcIso("2026-07-01", "10:00"), "2026-07-01T09:00:00.000Z", "BST");
    assert.equal(londonToUtcIso("2026-12-01", "10:00"), "2026-12-01T10:00:00.000Z", "GMT");
    assert.equal(londonToUtcIso("2026-03-29", "01:30"), "2026-03-29T01:30:00.000Z", "the spring gap moves on an hour (02:30 BST)");
    assert.equal(londonParts("2026-10-25T00:30:00.000Z").time, "01:30");
    assert.equal(londonParts("2026-10-25T01:30:00.000Z").time, "01:30", "the autumn hour happens twice");
    assert.deepEqual([londonParts("2026-10-24T23:30:00.000Z").date, londonParts("2026-10-24T23:30:00.000Z").time], ["2026-10-25", "00:30"]);
  });

  it("reminder times: N hours before, or N days before at a UK time", () => {
    const start = "2026-10-27T14:30:00.000Z"; // Tuesday 27 October, 14:30 GMT
    assert.equal(reminderDueAt(start, { timing: "hours_before", hoursBefore: 24, daysBefore: null, sendAt: null }), "2026-10-26T14:30:00.000Z");
    assert.equal(reminderDueAt(start, { timing: "days_before", hoursBefore: null, daysBefore: 1, sendAt: "10:00" }), "2026-10-26T10:00:00.000Z");
    // A Monday appointment after the clocks go back: the reminder on Sunday 25 at 10:00 GMT.
    assert.equal(reminderDueAt("2026-10-26T09:00:00.000Z", { timing: "days_before", hoursBefore: null, daysBefore: 1, sendAt: "10:00" }), "2026-10-25T10:00:00.000Z");
    // Before the change: Saturday 24 October 10:00 BST = 09:00 UTC.
    assert.equal(reminderDueAt("2026-10-25T12:00:00.000Z", { timing: "days_before", hoursBefore: null, daysBefore: 1, sendAt: "10:00" }), "2026-10-24T09:00:00.000Z");
    assert.equal(reminderDueAt(start, { timing: "days_before", hoursBefore: null, daysBefore: null, sendAt: "10:00" }), null);
  });

  it("quiet hours: texts move to the end, or before the start when the appointment is early", () => {
    assert.equal(isQuietTime("21:00", "20:00", "08:00"), true);
    assert.equal(isQuietTime("07:59", "20:00", "08:00"), true);
    assert.equal(isQuietTime("08:00", "20:00", "08:00"), false);
    assert.equal(isQuietTime("12:00", "12:00", "12:00"), false, "no quiet hours");
    // 22:00 the evening before a 14:30 appointment → 08:00 that morning.
    assert.equal(outOfQuietHours("2026-12-01T22:00:00.000Z", "2026-12-02T14:30:00.000Z", "20:00", "08:00"), "2026-12-02T08:00:00.000Z");
    // 05:30 for a 08:15 appointment: 08:00 is too close → 19:45 the evening before.
    assert.equal(outOfQuietHours("2026-12-02T05:30:00.000Z", "2026-12-02T08:15:00.000Z", "20:00", "08:00"), "2026-12-01T19:45:00.000Z");
    assert.equal(outOfQuietHours("2026-12-02T12:00:00.000Z", "2026-12-03T12:00:00.000Z", "20:00", "08:00"), "2026-12-02T12:00:00.000Z");
  });

  const settings = { confirmationsSms: true, confirmationsEmail: true, changeNotices: true, quietStart: "20:00", quietEnd: "08:00" };
  const smsRule = { id: "rrule_1", channel: "sms" as const, timing: "days_before" as const, daysBefore: 1, hoursBefore: null, sendAt: "10:00", serviceIds: null, active: true };
  const emailRule = { id: "rrule_2", channel: "email" as const, timing: "hours_before" as const, daysBefore: null, hoursBefore: 48, sendAt: null, serviceIds: ["svc_classes"], active: true };

  it("plans the confirmation now and each rule's reminder; leaves out what is already too late", () => {
    const now = "2026-10-24T11:00:00.000Z";
    const plan = planAppointmentMessages({ appointment: { startsAt: "2026-10-27T14:30:00.000Z", serviceId: "svc_fu", active: true }, notify: "confirmation", settings, rules: [smsRule, emailRule], now });
    assert.deepEqual(
      plan.map((p) => [p.kind, p.channel, p.dueAt]),
      [
        ["confirmation", "sms", now],
        ["confirmation", "email", now],
        ["reminder", "sms", "2026-10-26T10:00:00.000Z"],
      ],
      "the email rule is only for classes",
    );
    assert.equal(plan[2].dedupeKey, dedupeKey("reminder", "sms", "rrule_1", "2026-10-27T14:30:00.000Z"));
    // Booked at 11:00 for 12:30 the same day: the day-before reminder has passed.
    const late = planAppointmentMessages({ appointment: { startsAt: "2026-10-24T12:30:00.000Z", active: true }, notify: "confirmation", settings, rules: [smsRule], now });
    assert.deepEqual(late.map((p) => p.kind), ["confirmation", "confirmation"]);
    // A confirmation asked for at 21:00: the text waits for 08:00, the email goes now.
    const evening = planAppointmentMessages({ appointment: { startsAt: "2026-12-03T10:00:00.000Z", active: true }, notify: "confirmation", settings, rules: [], now: "2026-12-01T21:00:00.000Z" });
    assert.deepEqual(evening.map((p) => [p.channel, p.dueAt]), [
      ["sms", "2026-12-02T08:00:00.000Z"],
      ["email", "2026-12-01T21:00:00.000Z"],
    ]);
  });

  it("cancelled appointments: no reminders, a notice only when asked and switched on; past appointments: nothing", () => {
    const now = "2026-10-24T11:00:00.000Z";
    const appt = { startsAt: "2026-10-27T14:30:00.000Z", active: false };
    assert.deepEqual(planAppointmentMessages({ appointment: appt, notify: "none", settings, rules: [smsRule], now }), []);
    assert.deepEqual(planAppointmentMessages({ appointment: appt, notify: "cancelled", settings, rules: [smsRule], now }).map((p) => p.kind), ["cancelled", "cancelled"]);
    assert.deepEqual(planAppointmentMessages({ appointment: appt, notify: "cancelled", settings: { ...settings, changeNotices: false }, rules: [smsRule], now }), []);
    assert.deepEqual(planAppointmentMessages({ appointment: { startsAt: "2026-10-24T10:00:00.000Z", active: true }, notify: "confirmation", settings, rules: [smsRule], now }), []);
    assert.deepEqual(planAppointmentMessages({ appointment: { startsAt: "2026-10-27T14:30:00.000Z", active: true }, notify: "moved", settings: { ...settings, confirmationsEmail: false }, rules: [], now }).map((p) => [p.kind, p.channel]), [["moved", "sms"]]);
  });

  it("at sending time: reminders stop 30 minutes before, everything stops at the start", () => {
    assert.equal(stillWorthSending("reminder", "2026-10-27T14:30:00.000Z", "2026-10-27T13:59:00.000Z"), true);
    assert.equal(stillWorthSending("reminder", "2026-10-27T14:30:00.000Z", "2026-10-27T14:01:00.000Z"), false);
    assert.equal(stillWorthSending("confirmation", "2026-10-27T14:30:00.000Z", "2026-10-27T14:29:00.000Z"), true);
    assert.equal(stillWorthSending("cancelled", "2026-10-27T14:30:00.000Z", "2026-10-27T14:30:00.000Z"), false);
  });

  it("formats dates and times for messages in UK time", () => {
    assert.equal(formatAppointmentDate("2026-10-27T14:30:00.000Z"), "Tuesday 27 October");
    assert.equal(formatAppointmentDateShort("2026-10-27T23:30:00.000Z"), "27/10/2026");
    assert.equal(formatAppointmentTime("2026-07-01T13:30:00.000Z"), "14:30", "BST");
    assert.equal(formatDuration("2026-10-27T14:30:00.000Z", "2026-10-27T15:45:00.000Z"), "1 hour 15 minutes");
    assert.equal(formatDuration("2026-10-27T14:30:00.000Z", null), "");
    assert.equal(formatLongDate("2026-10-24"), "24 October 2026");
  });
});

describe("consent (PECR) and who may be messaged", () => {
  const megan: MessagingContact = {
    id: "pat_1",
    title: "Ms",
    firstName: "Megan",
    preferredName: "Meg",
    lastName: "Hart",
    phoneMobile: "07700 900123",
    email: "megan.hart@example.com",
    status: "active",
    reminderSms: true,
    reminderEmail: true,
    marketingSms: false,
    marketingEmail: true,
  };
  it("service messages unless opted out; marketing only with an opt-in", () => {
    assert.equal(messageBlock(megan, "sms", "service", { automatic: true }), null);
    assert.equal(messageBlock({ ...megan, reminderSms: false }, "sms", "service", { automatic: true }), "opted_out");
    assert.equal(messageBlock(megan, "sms", "marketing", { automatic: false }), "no_marketing_consent", "never pre-ticked");
    assert.equal(messageBlock(megan, "email", "marketing", { automatic: false }), null);
  });
  it("never after death; automatic messages skip archived records; texts need a mobile", () => {
    assert.equal(messageBlock({ ...megan, status: "deceased" }, "email", "service", { automatic: false }), "deceased");
    assert.equal(messageBlock({ ...megan, status: "archived" }, "sms", "service", { automatic: true }), "archived");
    assert.equal(messageBlock({ ...megan, status: "archived" }, "sms", "service", { automatic: false }), null);
    assert.equal(messageBlock({ ...megan, phoneMobile: "01632 960001" }, "sms", "service", { automatic: true }), "no_mobile");
    assert.equal(messageBlock({ ...megan, email: null }, "email", "service", { automatic: true }), "no_email");
    assert.equal(addressFor({ ...megan, phoneMobile: "01632 960001" }, "sms"), null);
    assert.equal(greetingName(megan), "Meg");
    assert.equal(greetingName({ ...megan, preferredName: " " }), "Megan");
  });
});

describe("text replies", () => {
  it("the first word decides; STOP words opt out; cancel requests and the unclear go to a person", () => {
    assert.equal(interpretReply("Yes please!"), "confirm");
    assert.equal(interpretReply("y"), "confirm");
    assert.equal(interpretReply(" no, sorry"), "cancel");
    assert.equal(interpretReply("CANCEL"), "cancel");
    assert.equal(interpretReply("stop"), "stop");
    assert.equal(interpretReply("Stop all"), "stop");
    assert.equal(interpretReply("opt-out"), "stop");
    assert.equal(interpretReply("Can I come at 3 instead?"), "unknown");
    assert.equal(interpretReply(""), "unknown");
    assert.equal(replyNeedsAction("confirm", true), false);
    assert.equal(replyNeedsAction("confirm", false), true, "a YES we cannot match to an appointment");
    assert.equal(replyNeedsAction("cancel", true), true);
    assert.equal(replyNeedsAction("stop", false), false);
  });
});

describe("inputs", () => {
  it("settings: sender names, quiet hours", () => {
    assert.equal(CommsSettingsInputSchema.safeParse({ smsSender: "RIVERSIDE" }).success, true);
    assert.equal(CommsSettingsInputSchema.safeParse({ smsSender: "12345" }).success, false, "at least one letter");
    assert.equal(CommsSettingsInputSchema.safeParse({ smsSender: "TOOLONGSENDER" }).success, false);
    assert.equal(CommsSettingsInputSchema.safeParse({ quietStart: "25:00" }).success, false);
    assert.equal(CommsSettingsInputSchema.safeParse({ unknown: true }).success, false, "strict");
  });
  it("templates: an email needs a subject; fields are checked for the kind; texts have a length limit", () => {
    assert.equal(MessageTemplateInputSchema.safeParse({ kind: "reminder", channel: "email", name: "R", body: "Hi" }).success, false);
    const bad = MessageTemplateInputSchema.safeParse({ kind: "reminder", channel: "sms", name: "R", body: "Your {{case.title}} appointment" });
    assert.equal(bad.success, false);
    assert.equal(MessageTemplateInputSchema.safeParse({ kind: "general", channel: "sms", name: "G", body: "x".repeat(919) }).success, false);
  });
  it("reminder rules need their timing", () => {
    assert.equal(ReminderRuleInputSchema.safeParse({ name: "R", channel: "sms", timing: "days_before", daysBefore: 1 }).success, false, "time missing");
    assert.equal(ReminderRuleInputSchema.safeParse({ name: "R", channel: "sms", timing: "days_before", daysBefore: 1, sendAt: "10:00" }).success, true);
    assert.equal(ReminderRuleInputSchema.safeParse({ name: "R", channel: "sms", timing: "hours_before", hoursBefore: 200 }).success, false);
  });
  it("appointments carry an instant with its zone", () => {
    assert.equal(isIsoInstant("2026-10-27T14:30:00.000Z"), true);
    assert.equal(isIsoInstant("2026-10-27T14:30:00+01:00"), true);
    assert.equal(isIsoInstant("2026-10-27 14:30"), false);
    assert.equal(AppointmentForMessagesSchema.safeParse({ id: "appt_1", patientId: "pat_1", startsAt: "2026-10-27T14:30:00Z", active: true }).success, true);
  });
  it("manual messages: no appointment fields; marketing opt-ins need a source", () => {
    assert.equal(ManualMessageInputSchema.safeParse({ patientId: "pat_1", channel: "sms", body: "Hi {{patient.first_name}}" }).success, true);
    assert.equal(ManualMessageInputSchema.safeParse({ patientId: "pat_1", channel: "sms", body: "See you {{appointment.date}}" }).success, false);
    assert.equal(ConsentChangeSchema.safeParse({ patientId: "pat_1", channel: "email", purpose: "marketing", value: true, source: "staff" }).success, false);
    assert.equal(ConsentChangeSchema.safeParse({ patientId: "pat_1", channel: "email", purpose: "marketing", value: true, source: "staff", marketingConsentSource: "written" }).success, true);
  });
});
