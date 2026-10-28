/** Pure rules of the portal module: UK time, slots, booking policy, forms and signatures, inputs, messages. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalJson, checkAnswers, consentComplete, definitionProblems, recordUpdates, signatureMatchesPatient, signatureNameProblem, visibleAnswers, answerText, type FormDefinition } from "./forms";
import { BOOKING_REFERENCE_PATTERN, bookingReference, changeRefusalMessage, isLateCancellation, manageLinkExpiry, patientChangeRights, sessionUsable } from "./policy";
import { BookingSettingsInputSchema, BookingSiteInputSchema, FormDefinitionSchema, IntakeTemplateInputSchema, PortalSignInSchema, publicBookingSchema } from "./schemas";
import { outcomeAnswersFrom, outcomeFormProblem, outcomeQuestionnaire } from "./outcome-forms";
import { MEASURES, scoreOutcome } from "../records/outcomes";
import { formatMiles, milesBetween } from "./distance";
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

describe("booking policy", () => {
  const policy = { cancelNoticeHours: 24, patientCancel: true };
  const now = Date.parse("2026-10-26T09:00:00.000Z");
  it("cancel any time before the start (late inside the notice period); move only outside it", () => {
    const at = (startsAt: string, status = "booked") => patientChangeRights(policy, { status, startsAt }, now);
    assert.deepEqual(at("2026-10-28T09:00:00.000Z"), { cancel: { ok: true, late: false }, move: { ok: true }, freeUntil: "2026-10-27T09:00:00.000Z" });
    assert.deepEqual(at("2026-10-27T08:00:00.000Z"), { cancel: { ok: true, late: true }, move: { ok: false, reason: "too_late" }, freeUntil: "2026-10-26T08:00:00.000Z" });
    assert.equal(at("2026-10-26T08:00:00.000Z").cancel.ok, false, "started");
    assert.deepEqual(at("2026-10-28T09:00:00.000Z", "cancelled").cancel, { ok: false, reason: "not_booked" });
    assert.deepEqual(at("2026-10-28T09:00:00.000Z", "arrived").move, { ok: false, reason: "not_booked" });
    assert.deepEqual(patientChangeRights({ ...policy, patientCancel: false }, { status: "booked", startsAt: "2026-10-28T09:00:00.000Z" }, now).cancel, { ok: false, reason: "not_allowed" });
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
      paying: "insured",
    });
    assert.ok(ok.success);
    if (ok.success) {
      assert.equal(ok.data.email, "ellie.sample@example.com");
      assert.equal(ok.data.firstName, "Ellie");
    }
    const bad = schema.safeParse({ siteId: "site_1", serviceId: "svc_1", practitionerId: "any", startsAt: "2026-11-02 09:00", firstName: "", lastName: "S", dateOfBirth: "2030-01-01", email: "nope", phoneMobile: "", paying: "barter" });
    assert.equal(bad.success, false);
    if (!bad.success) {
      const paths = new Set(bad.error.issues.map((i) => i.path.join(".")));
      for (const p of ["startsAt", "firstName", "dateOfBirth", "email", "phoneMobile", "paying"]) assert.ok(paths.has(p), p);
    }
    assert.equal(PortalSignInSchema.safeParse({ email: "megan.hart@example.com" }).success, true, "the email address only (design)");
    assert.equal(PortalSignInSchema.safeParse({ email: "megan" }).success, false);
  });

  it("settings and sites", () => {
    assert.equal(BookingSettingsInputSchema.safeParse({ slotStepMinutes: 7 }).success, false);
    assert.equal(BookingSettingsInputSchema.safeParse({ minNoticeHours: 2, maxDaysAhead: 60, slotStepMinutes: 15 }).success, true);
    assert.equal(BookingSiteInputSchema.safeParse({ siteId: "site_01J", online: true, latitude: 52.04, longitude: -0.76 }).success, true);
    assert.equal(BookingSiteInputSchema.safeParse({ siteId: "site_01J", online: true, latitude: 52.04 }).success, false, "both or neither");
    assert.equal(BookingSiteInputSchema.safeParse({ siteId: "site_01J", online: true, latitude: 12, longitude: 0 }).success, false, "in the UK");
    assert.equal(IntakeTemplateInputSchema.safeParse({ name: "Consent", kind: "consent", setsTreatmentConsent: true, requiresSignature: false, definition: FORM }).success, false, "consent must be signed");
  });
});

describe("outcome questionnaires in the portal", () => {
  it("forms from the records measures; answers map back to the records scores", () => {
    for (const m of ["ndi", "odi", "nprs", "quickdash"] as const) {
      const form = outcomeQuestionnaire(m);
      assert.equal(form.fields.length, MEASURES[m].items.length);
      assert.ok(form.fields.every((f) => f.type === "choice" && f.sensitive), "clinical");
      assert.deepEqual(FormDefinitionSchema.safeParse(form).success, true, m);
    }
    const odi = outcomeQuestionnaire("odi");
    assert.equal(odi.fields.find((f) => f.id === "s8")?.required, false, "the sex-life section is optional");
    const answers = Object.fromEntries(odi.fields.filter((f) => f.required).map((f) => [f.id, f.options![2]]));
    const mapped = outcomeAnswersFrom("odi", odi, answers);
    assert.equal(mapped.items.s8, null);
    const scored = scoreOutcome("odi", mapped);
    assert.ok(scored.ok && scored.score === 40, JSON.stringify(scored));
    const qd = outcomeQuestionnaire("quickdash");
    const qdAnswers = Object.fromEntries(qd.fields.map((f) => [f.id, f.options![0]]));
    const qdScore = scoreOutcome("quickdash", outcomeAnswersFrom("quickdash", qd, qdAnswers));
    assert.ok(qdScore.ok && qdScore.score === 0, "1 = no difficulty → 0");
    const nprs = outcomeQuestionnaire("nprs");
    assert.equal(nprs.fields[0].options!.length, 11);
    const n = scoreOutcome("nprs", outcomeAnswersFrom("nprs", nprs, { pain: nprs.fields[0].options![7] }));
    assert.ok(n.ok && n.score === 7);
    assert.match(outcomeFormProblem("psfs") ?? "", /record a PSFS in clinic first/);
    const psfs = outcomeQuestionnaire("psfs", { psfsActivities: [{ key: "a1", name: "Walking the dog" }, { key: "a2", name: "Gardening" }, { key: "a3", name: "Swimming" }] });
    assert.deepEqual(psfs.fields.map((f) => f.label), ["Walking the dog", "Gardening", "Swimming"]);
    const p = scoreOutcome("psfs", outcomeAnswersFrom("psfs", psfs, { a1: psfs.fields[0].options![4], a2: psfs.fields[1].options![5], a3: psfs.fields[2].options![6] }));
    assert.ok(p.ok && p.score === 5);
  });
});

describe("distance from the patient (worked out in the browser only)", () => {
  it("miles between two points, one decimal", () => {
    // About 0.8 miles across Milton Keynes centre (fictional sites at real coordinates).
    const d = milesBetween({ latitude: 52.0406, longitude: -0.7594 }, { latitude: 52.0406, longitude: -0.7406 });
    assert.ok(Math.abs(d - 0.8) < 0.05, String(d));
    assert.equal(formatMiles(0.04), "0.1 miles");
    assert.equal(formatMiles(1), "1.0 miles");
    assert.equal(formatMiles(12.345), "12 miles");
  });
});
