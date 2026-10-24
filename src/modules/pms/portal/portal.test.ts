/** Pure rules of the portal module: UK time, slots, booking policy, forms and signatures, inputs, messages. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalJson, checkAnswers, consentComplete, definitionProblems, recordUpdates, signatureMatchesPatient, signatureNameProblem, visibleAnswers, answerText, type FormDefinition } from "./forms";
import { bookingConfirmedMessage, bookingCancelledMessage, signInLinkMessage } from "./messages";
import { BOOKING_REFERENCE_PATTERN, bookingReference, changeRefusalMessage, isLateCancellation, manageLinkExpiry, patientMayChange, sessionUsable } from "./policy";
import { BookingHoursInputSchema, BookingSettingsInputSchema, FormDefinitionSchema, IntakeTemplateInputSchema, publicBookingSchema, portalSignInSchema } from "./schemas";
import { clampStartDate, computeSlots, hoursClash, pickSlot, slotsByDay, type HoursRule } from "./slots";
import { STARTER_FORMS } from "./starters";
import { addDays, formatDateLong, formatUkDateTime, formatUkTime, hhmmToMinutes, londonParts, londonToUtcMs, minutesToHhmm, mondayOf, weekdayOf } from "./time";

describe("UK time", () => {
  it("converts local times to instants in winter and summer", () => {
    assert.equal(new Date(londonToUtcMs("2026-07-01", 9 * 60) as number).toISOString(), "2026-07-01T08:00:00.000Z", "BST = UTC+1");
    assert.equal(new Date(londonToUtcMs("2026-12-01", 9 * 60) as number).toISOString(), "2026-12-01T09:00:00.000Z", "GMT = UTC");
  });

  it("clocks forward (29 March 2026): 01:30 does not exist; clocks back (25 October 2026): 01:30 happens twice, first one wins", () => {
    assert.equal(londonToUtcMs("2026-03-29", 90), null);
    assert.equal(new Date(londonToUtcMs("2026-03-29", 120) as number).toISOString(), "2026-03-29T01:00:00.000Z");
    assert.equal(new Date(londonToUtcMs("2026-10-25", 90) as number).toISOString(), "2026-10-25T00:30:00.000Z");
    assert.equal(new Date(londonToUtcMs("2026-10-25", 9 * 60) as number).toISOString(), "2026-10-25T09:00:00.000Z");
  });

  it("parts, weekdays, formatting", () => {
    assert.deepEqual(londonParts(Date.parse("2026-10-26T09:30:00.000Z")), { date: "2026-10-26", minute: 570, weekday: 1 });
    assert.deepEqual(londonParts(Date.parse("2026-06-30T23:30:00.000Z")), { date: "2026-07-01", minute: 30, weekday: 3 }, "after midnight in BST");
    assert.equal(weekdayOf("2026-10-25"), 7);
    assert.equal(mondayOf("2026-10-25"), "2026-10-19");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(minutesToHhmm(570), "09:30");
    assert.equal(hhmmToMinutes("17:45"), 1065);
    assert.equal(hhmmToMinutes("24:00"), 1440);
    assert.equal(hhmmToMinutes("9.30"), null);
    assert.equal(formatDateLong("2026-10-26"), "Monday 26 October 2026");
    assert.equal(formatDateLong("2026-10-26", { short: true }), "Mon 26 Oct");
    assert.equal(formatUkTime("2026-07-01T08:00:00.000Z"), "09:00");
    assert.equal(formatUkDateTime("2026-10-26T09:30:00.000Z"), "Monday 26 October 2026 at 09:30");
  });
});

const MON = 1;
const rule = (over: Partial<HoursRule> = {}): HoursRule => ({ practitionerId: "prac_a", siteId: "site_1", weekday: MON, startMinute: 9 * 60, endMinute: 11 * 60, validFrom: null, validTo: null, ...over });
const base = {
  siteId: "site_1",
  practitionerIds: ["prac_a", "prac_b"],
  durationMinutes: 30,
  bufferMinutes: 0,
  stepMinutes: 30,
  fromDate: "2026-11-02",
  days: 7,
  nowMs: Date.parse("2026-10-26T08:00:00.000Z"),
  minNoticeMinutes: 24 * 60,
  maxDaysAhead: 42,
  busy: [],
};

describe("slot engine", () => {
  it("steps through each hours row and keeps the appointment inside it", () => {
    const slots = computeSlots({ ...base, rules: [rule()] });
    assert.deepEqual(slots.map((s) => s.startsAt), ["2026-11-02T09:00:00.000Z", "2026-11-02T09:30:00.000Z", "2026-11-02T10:00:00.000Z", "2026-11-02T10:30:00.000Z"]);
    assert.equal(slots[0].endsAt, "2026-11-02T09:30:00.000Z");
    const long = computeSlots({ ...base, rules: [rule()], durationMinutes: 45, stepMinutes: 15 });
    assert.equal(long[long.length - 1].startsAt, "2026-11-02T10:15:00.000Z", "10:15 + 45 min ends at 11:00");
  });

  it("busy time (with its buffer) removes slots; the buffer of a new slot must not hit the next appointment", () => {
    const busy = [{ practitionerId: "prac_a", startMs: Date.parse("2026-11-02T10:00:00.000Z"), endMs: Date.parse("2026-11-02T10:40:00.000Z") }];
    assert.deepEqual(computeSlots({ ...base, rules: [rule()], busy }).map((s) => s.minute), [540, 570]);
    assert.deepEqual(computeSlots({ ...base, rules: [rule()], busy, bufferMinutes: 10 }).map((s) => s.minute), [540], "09:30 + 30 + 10 runs into 10:00");
  });

  it("minimum notice, the horizon, date ranges, other sites and clock changes", () => {
    const soon = computeSlots({ ...base, rules: [rule()], fromDate: "2026-10-26", days: 1, minNoticeMinutes: 61 });
    assert.deepEqual(soon.map((s) => s.minute), [570, 600, 630], "09:00 is within 61 minutes' notice (now 08:00 GMT)");
    assert.equal(computeSlots({ ...base, rules: [rule()], maxDaysAhead: 3 }).length, 0, "2 Nov is 7 days away");
    assert.equal(computeSlots({ ...base, rules: [rule({ validFrom: "2026-11-03" })] }).length, 0);
    assert.equal(computeSlots({ ...base, rules: [rule({ siteId: "site_2" })] }).length, 0);
    assert.equal(computeSlots({ ...base, rules: [rule()], practitionerIds: ["prac_b"] }).length, 0, "not a candidate");
    const forward = computeSlots({ ...base, rules: [rule({ weekday: 7, startMinute: 0, endMinute: 180 })], fromDate: "2026-03-29", days: 1, nowMs: Date.parse("2026-03-01T00:00:00Z"), stepMinutes: 30 });
    assert.ok(!forward.some((s) => s.minute === 60 || s.minute === 90), "01:00–02:00 does not exist on 29 March");
  });

  it("any practitioner: earliest first, then the clinic's order; one time per day for display; picking a slot", () => {
    const slots = computeSlots({ ...base, rules: [rule(), rule({ practitionerId: "prac_b" })] });
    assert.equal(slots.length, 8);
    assert.deepEqual(slots.slice(0, 2).map((s) => s.practitionerId), ["prac_a", "prac_b"]);
    const days = slotsByDay(slots, { uniqueTimes: true });
    assert.equal(days.length, 1);
    assert.equal(days[0].slots.length, 4);
    assert.equal(pickSlot(slots, "2026-11-02T09:00:00.000Z", "any")?.practitionerId, "prac_a");
    assert.equal(pickSlot(slots, "2026-11-02T09:00:00.000Z", "prac_b")?.practitionerId, "prac_b");
    assert.equal(pickSlot(slots, "2026-11-02T09:05:00.000Z", "any"), null, "not a slot");
  });

  it("the diary's working windows restrict the online hours", () => {
    const working = [{ practitionerId: "prac_a", startMs: Date.parse("2026-11-02T09:30:00.000Z"), endMs: Date.parse("2026-11-02T10:30:00.000Z") }];
    assert.deepEqual(computeSlots({ ...base, rules: [rule()], working }).map((s) => s.minute), [570, 600]);
  });

  it("start dates and clashing hours", () => {
    assert.equal(clampStartDate("2026-01-01", "2026-10-26", 42), "2026-10-26");
    assert.equal(clampStartDate("2027-06-01", "2026-10-26", 42), "2026-12-07");
    assert.equal(clampStartDate("nonsense", "2026-10-26", 42), "2026-10-26");
    assert.equal(hoursClash(rule(), rule({ startMinute: 600, endMinute: 720 })), true);
    assert.equal(hoursClash(rule(), rule({ startMinute: 660, endMinute: 720 })), false, "back to back");
    assert.equal(hoursClash(rule({ validTo: "2026-11-30" }), rule({ validFrom: "2026-12-01" })), false);
    assert.equal(hoursClash(rule(), rule({ practitionerId: "prac_b" })), false);
  });
});

describe("booking policy", () => {
  const policy = { cancelNoticeHours: 24, patientCancel: true };
  const now = Date.parse("2026-10-26T09:00:00.000Z");
  it("patients may change a booking until the notice period", () => {
    assert.deepEqual(patientMayChange(policy, { status: "booked", startsAt: "2026-10-28T09:00:00.000Z" }, now), { ok: true });
    assert.deepEqual(patientMayChange(policy, { status: "booked", startsAt: "2026-10-27T08:00:00.000Z" }, now), { ok: false, reason: "too_late" });
    assert.deepEqual(patientMayChange(policy, { status: "booked", startsAt: "2026-10-26T08:00:00.000Z" }, now), { ok: false, reason: "started" });
    assert.deepEqual(patientMayChange(policy, { status: "cancelled", startsAt: "2026-10-28T09:00:00.000Z" }, now), { ok: false, reason: "not_booked" });
    assert.deepEqual(patientMayChange({ ...policy, patientCancel: false }, { status: "booked", startsAt: "2026-10-28T09:00:00.000Z" }, now), { ok: false, reason: "not_allowed" });
    assert.match(changeRefusalMessage("too_late", "01632 960101"), /call the clinic on 01632 960101/);
    assert.equal(isLateCancellation(policy, "2026-10-27T08:00:00.000Z", now), true);
    assert.equal(isLateCancellation(policy, "2026-10-28T09:00:00.000Z", now), false);
  });

  it("references, link expiry and portal sessions", () => {
    const ref = bookingReference(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 255]));
    assert.match(ref, BOOKING_REFERENCE_PATTERN);
    assert.equal(manageLinkExpiry("2026-10-28T09:00:00.000Z"), "2026-10-29T09:00:00.000Z");
    const s = { expiresAt: "2026-10-26T13:00:00.000Z", lastSeenAt: "2026-10-26T08:45:00.000Z", revokedAt: null };
    assert.equal(sessionUsable(s, now), true);
    assert.equal(sessionUsable({ ...s, lastSeenAt: "2026-10-26T08:00:00.000Z" }, now), false, "idle for an hour");
    assert.equal(sessionUsable({ ...s, revokedAt: "2026-10-26T08:50:00.000Z" }, now), false);
    assert.equal(sessionUsable({ ...s, expiresAt: "2026-10-26T09:00:00.000Z" }, now), false);
  });
});

const FORM: FormDefinition = {
  fields: [
    { id: "intro", type: "heading", label: "About you" },
    { id: "mobile", type: "text", label: "Mobile", required: true, recordField: "phoneMobile" },
    { id: "postcode", type: "text", label: "Postcode", recordField: "postcode" },
    { id: "address", type: "textarea", label: "Address", recordField: "address" },
    { id: "pain", type: "textarea", label: "What hurts?", required: true, sensitive: true },
    { id: "smoker", type: "yes_no", label: "Do you smoke?" },
    { id: "when", type: "choice", label: "When did it start?", options: ["Recently", "Long ago"], required: true },
    { id: "tick", type: "multi", label: "Any of these?", options: ["A", "B", "C"] },
    { id: "injured_on", type: "date", label: "Date of injury" },
    { id: "agree", type: "consent", label: "I agree", required: true, recordField: "consentTreatment" },
  ],
};

describe("intake forms", () => {
  it("starter forms are valid definitions", () => {
    for (const s of STARTER_FORMS) {
      assert.deepEqual(definitionProblems(s.definition), [], s.key);
      assert.ok(FormDefinitionSchema.safeParse(s.definition).success, s.key);
      assert.ok(IntakeTemplateInputSchema.safeParse({ name: s.name, kind: s.kind, sendWhen: s.sendWhen, requiresSignature: s.requiresSignature, setsTreatmentConsent: s.setsTreatmentConsent, definition: s.definition }).success, s.key);
    }
    assert.deepEqual(definitionProblems(FORM), []);
  });

  it("definition problems: keys, choices, record fields", () => {
    const bad: FormDefinition = {
      fields: [
        { id: "Bad Key", type: "text", label: "x" },
        { id: "a", type: "choice", label: "Pick", options: ["Only one"] },
        { id: "a", type: "text", label: "" },
        { id: "b", type: "date", label: "When", recordField: "postcode" },
        { id: "h", type: "heading", label: "Head", required: true },
      ],
    };
    const problems = definitionProblems(bad).join(" | ");
    for (const part of ["key must start", "2–20 choices", "used twice", "wording", "cannot update", "heading cannot be required"]) assert.ok(problems.includes(part), part);
    assert.deepEqual(definitionProblems({ fields: [{ id: "h", type: "heading", label: "Only text" }] }), ["Add at least one question."]);
  });

  it("checks answers: required, phone, postcode, choices, dates, consent", () => {
    const missing = checkAnswers(FORM, {}, "2026-10-26");
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.deepEqual(Object.keys(missing.errors).sort(), ["agree", "mobile", "pain", "when"]);
    const bad = checkAnswers(FORM, { mobile: "12", postcode: "nope", pain: "x", when: "Never", tick: ["Z"], injured_on: "2026-02-30", agree: "on" }, "2026-10-26");
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.deepEqual(Object.keys(bad.errors).sort(), ["injured_on", "mobile", "postcode", "tick", "when"]);
    const good = checkAnswers(
      FORM,
      { mobile: "07700  900123", postcode: "mk3 9zz", address: "14 Willow Bank\r\nBletchley", pain: " Neck ", smoker: "no", when: "Recently", tick: ["C", "A"], injured_on: "2026-03-12", agree: "on", unknown: "dropped" },
      "2026-10-26",
    );
    assert.ok(good.ok);
    if (good.ok) {
      assert.deepEqual(good.answers, { mobile: "07700 900123", postcode: "MK3 9ZZ", address: "14 Willow Bank\nBletchley", pain: "Neck", smoker: "no", when: "Recently", tick: ["A", "C"], injured_on: "2026-03-12", agree: true });
      assert.deepEqual(
        recordUpdates(FORM, good.answers).map((u) => [u.field, u.value]),
        [
          ["phoneMobile", "07700 900123"],
          ["postcode", "MK3 9ZZ"],
          ["address", ["14 Willow Bank", "Bletchley"]],
          ["consentTreatment", true],
        ],
      );
      assert.equal(consentComplete(FORM, good.answers), true);
      const hidden = visibleAnswers(FORM, good.answers, false).find((v) => v.field.id === "pain");
      assert.equal(hidden?.value, "hidden", "health answers need clinical access");
      assert.equal(visibleAnswers(FORM, good.answers, true).find((v) => v.field.id === "pain")?.value, "Neck");
      assert.equal(answerText(FORM.fields[8], "2026-03-12"), "12/03/2026");
      assert.equal(answerText(FORM.fields[9], true), "Agreed");
    }
  });

  it("typed signatures and the sealed content", () => {
    assert.equal(signatureNameProblem(" M "), "Type your full name to sign");
    assert.equal(signatureNameProblem("Megan Hart"), null);
    const patient = { firstName: "Megan", lastName: "Hart", preferredName: "Meg" };
    assert.equal(signatureMatchesPatient("Megan Hart", patient), true);
    assert.equal(signatureMatchesPatient("M. Hart", patient), true);
    assert.equal(signatureMatchesPatient("meg  HART", patient), true);
    assert.equal(signatureMatchesPatient("Megan Smith", patient), false);
    assert.equal(signatureMatchesPatient("Hart", patient), false);
    assert.equal(canonicalJson({ b: 1, a: [{ d: 2, c: 1 }], u: undefined }), '{"a":[{"c":1,"d":2}],"b":1}');
  });
});

describe("inputs", () => {
  it("the public booking request", () => {
    const schema = publicBookingSchema("2026-10-26");
    const ok = schema.safeParse({
      siteId: "site_01J",
      serviceId: "svc_01J",
      practitionerId: "any",
      startsAt: "2026-11-02T09:00:00.000Z",
      firstName: " Ellie ",
      lastName: "Sample",
      dateOfBirth: "1990-05-04",
      email: "Ellie.Sample@Example.com",
      phoneMobile: "07700 900205",
      agree: true,
    });
    assert.ok(ok.success);
    if (ok.success) {
      assert.equal(ok.data.email, "ellie.sample@example.com");
      assert.equal(ok.data.firstName, "Ellie");
    }
    const bad = schema.safeParse({ siteId: "site_1", serviceId: "svc_1", practitionerId: "any", startsAt: "2026-11-02 09:00", firstName: "", lastName: "S", dateOfBirth: "2030-01-01", email: "nope", phoneMobile: "", agree: false });
    assert.equal(bad.success, false);
    if (!bad.success) {
      const paths = new Set(bad.error.issues.map((i) => i.path.join(".")));
      for (const p of ["startsAt", "firstName", "dateOfBirth", "email", "phoneMobile", "agree"]) assert.ok(paths.has(p), p);
    }
    assert.equal(portalSignInSchema("2026-10-26").safeParse({ email: "megan.hart@example.com", dateOfBirth: "1991-11-22" }).success, true);
  });

  it("settings and hours", () => {
    assert.equal(BookingSettingsInputSchema.safeParse({ slotStepMinutes: 7 }).success, false);
    assert.equal(BookingSettingsInputSchema.safeParse({ minNoticeHours: 2, maxDaysAhead: 60, slotStepMinutes: 15 }).success, true);
    assert.equal(BookingHoursInputSchema.safeParse({ practitionerId: "prac_1", siteId: "site_1", weekday: 1, startMinute: 600, endMinute: 540 }).success, false);
    assert.equal(BookingHoursInputSchema.safeParse({ practitionerId: "prac_1", siteId: "site_1", weekday: 8, startMinute: 540, endMinute: 600 }).success, false);
    assert.equal(BookingHoursInputSchema.safeParse({ practitionerId: "prac_1", siteId: "site_1", weekday: 1, startMinute: 540, endMinute: 1020 }).success, true);
    assert.equal(IntakeTemplateInputSchema.safeParse({ name: "Consent", kind: "consent", setsTreatmentConsent: true, requiresSignature: false, definition: FORM }).success, false, "consent must be signed");
  });
});

describe("messages carry no clinical detail", () => {
  it("booking messages name the time, place and practitioner only", () => {
    const visit = { startsAt: "2026-11-02T09:00:00.000Z", siteName: "Bletchley (fictional)", practitionerName: "James Okafor", reference: "K7M3-Q9TX" };
    const msg = bookingConfirmedMessage({ clinicName: "Riverside Physiotherapy (fictional)", firstName: "Ellie", visit, manageUrl: "https://x.example/m", cancellationPolicy: "Please give 24 hours' notice.", formsToComplete: 2 });
    assert.match(msg.body, /Monday 2 November 2026 at 09:00 with James Okafor at Bletchley/);
    assert.match(msg.body, /K7M3-Q9TX/);
    assert.match(msg.body, /complete the 2 forms/);
    assert.ok(!/assessment|massage|pain|injury/i.test(msg.body + msg.subject));
    assert.match(bookingCancelledMessage({ clinicName: "C (fictional)", firstName: "E", visit, byClinic: true, contactPhone: null }).body, /The clinic has cancelled/);
    assert.match(signInLinkMessage({ clinicName: "C (fictional)", firstName: "E", url: "https://x.example/l" }).body, /20 minutes/);
  });
});
