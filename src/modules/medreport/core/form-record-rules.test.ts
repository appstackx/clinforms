/**
 * Unit tests for the record values insurer (PMI) forms need: the new registration paths, the "fixed"
 * fill source, the insurer-identifier rule and the same-kind referral-reference guard
 * (core/form-record-rules.ts, core/forms.ts, core/report-factory.ts createFormReport). Inline fictional
 * data only (module tests may not import the sandbox; the full case is in scripts/medreport).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_CLINIC } from "../config.public";
import { computeFacts } from "./computed-facts";
import { checkFormDefinition, insurerNameOnRecord, resolveRegistrationValue, sectionKindForFillSource } from "./forms";
import {
  fixedValueGap,
  isInsurerIdentifierWithheld,
  isReferralIdentifierPath,
  mayCopyReferralPartyReference,
  otherInsurerOnForm,
  referralValueForPath,
  resolveFixedValue,
  showsReferrerReferenceNotice,
  withheldInsurerIdentifier,
  withoutOtherInsurerName,
} from "./form-record-rules";
import { createFormReport } from "./report-factory";
import { FillSourceSchema, FormDefinitionSchema, RegistrationPathSchema } from "./schemas";
import type { EpisodeBundle, FillSource, FormDefinition, FormField, InstructingParty } from "./types";
import { testBundle } from "./validation/test-fixtures";

/** The validator fixture, re-referred as a private medical insurance episode (fictional insurer). */
function pmiBundle(overrides: Partial<EpisodeBundle["referral"]> = {}): EpisodeBundle {
  const b = testBundle();
  return {
    ...b,
    referral: {
      type: "insurer",
      name: "Meadowbank Health (fictional)",
      reference: "DEMO-AUTH-0042",
      contactName: "",
      address: "",
      referralDate: "2026-03-16",
      insurerName: "Meadowbank Health (fictional)",
      membershipNumber: "DEMO-POL-0042",
      authorisationNumber: "DEMO-AUTH-0042",
      ...overrides,
    },
  };
}

function partyOf(b: EpisodeBundle): InstructingParty {
  const { type, name, reference, contactName, address } = b.referral;
  return { type, name, reference, contactName, address };
}

let n = 0;
function field(label: string, fillSource: FillSource, rest: Partial<FormField> = {}): FormField {
  n += 1;
  return {
    id: `F-${String(n).padStart(2, "0")}`,
    label,
    guidance: "",
    answerType: "short_text",
    anchor: { kind: "pdf_field", fieldName: `f${n}`, fieldType: "text" },
    fillSource,
    required: true,
    confidence: "high",
    ...rest,
  };
}

function form(referrer: FormDefinition["referrer"], fields: FormField[]): FormDefinition {
  return {
    id: "frm_pmi_test",
    tenantId: "demo",
    referrer,
    title: "Further treatment request (test)",
    file: { fileName: "t.pdf", mimeType: "application/pdf", sha256: "0".repeat(64), sizeBytes: 1 },
    kind: "pdf_acroform",
    fields,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "test", at: "2026-10-01T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-01T09:00:00.000Z",
  };
}

const reg = (path: Extract<FillSource, { kind: "registration" }>["path"]): FillSource => ({ kind: "registration", path });
const NOW = new Date("2026-10-06T09:00:00.000Z");

function report(f: FormDefinition, b: EpisodeBundle) {
  return createFormReport({ form: f, bundle: b, instructingParty: partyOf(b), computedFacts: computeFacts(b, { asOf: "2026-10-06" }), now: NOW });
}

test("schemas: the new registration paths and the fixed fill source parse; older shapes still do", () => {
  for (const p of ["patient.title", "patient.phone", "patient.email", "clinic.phone", "clinic.email", "referral.insurerName", "referral.membershipNumber", "referral.authorisationNumber"]) {
    assert.equal(RegistrationPathSchema.safeParse(p).success, true, p);
  }
  assert.equal(FillSourceSchema.safeParse({ kind: "fixed", value: "Physiotherapist" }).success, true);
  assert.equal(FillSourceSchema.safeParse({ kind: "fixed" }).success, false, "a fixed source carries its value");
  assert.equal(sectionKindForFillSource({ kind: "fixed", value: "x" }), "from_records");
  assert.equal(FormDefinitionSchema.safeParse(form({ name: "X (fictional)", type: "insurer" }, [field("Q", { kind: "fixed", value: "" })])).success, true);
});

test("resolveRegistrationValue: patient title / phone / email, clinic phone / email, insurer name and numbers", () => {
  const b = pmiBundle();
  const ctx = { bundle: b, instructingParty: partyOf(b), computedFacts: [], reportDate: "2026-10-06" };
  const v = (path: Parameters<typeof resolveRegistrationValue>[0]) => resolveRegistrationValue(path, ctx)?.text ?? null;
  assert.equal(v("patient.title"), "Mr");
  assert.equal(v("patient.phone"), "07700 900999");
  assert.equal(v("patient.email"), "owen@example.com");
  assert.equal(v("clinic.phone"), DEMO_CLINIC.phone);
  assert.equal(v("clinic.email"), DEMO_CLINIC.email);
  assert.equal(v("referral.insurerName"), "Meadowbank Health (fictional)");
  assert.equal(v("referral.membershipNumber"), "DEMO-POL-0042");
  assert.equal(v("referral.authorisationNumber"), "DEMO-AUTH-0042");
  assert.deepEqual(resolveRegistrationValue("referral.membershipNumber", ctx)?.sourceIds, ["REG"]);
  // Absent values resolve to null (left blank with a gap – never guessed).
  const bare = testBundle();
  delete bare.registration.title;
  delete bare.registration.contact;
  const bareCtx = { bundle: bare, instructingParty: partyOf(bare), computedFacts: [], reportDate: "2026-10-06" };
  for (const p of ["patient.title", "patient.phone", "patient.email", "referral.insurerName", "referral.membershipNumber", "referral.authorisationNumber"] as const) {
    assert.equal(resolveRegistrationValue(p, bareCtx), null, p);
  }
});

test("insurerNameOnRecord: the referral's insurer, else the referring insurer itself, else none", () => {
  assert.equal(insurerNameOnRecord(pmiBundle({ insurerName: "Other Health (fictional)" })), "Other Health (fictional)");
  assert.equal(insurerNameOnRecord(pmiBundle({ insurerName: undefined })), "Meadowbank Health (fictional)");
  assert.equal(insurerNameOnRecord(testBundle()), null, "an employer referral names no insurer");
  const mlc = pmiBundle({ type: "mlc", name: "Example Medico-Legal (fictional)", insurerName: "  " });
  assert.equal(insurerNameOnRecord(mlc), null);
});

test("resolveFixedValue: text as set; Yes/No, choice, date and number parsed; misfits blank with a gap", () => {
  assert.deepEqual(resolveFixedValue({ answerType: "short_text" }, "  United Kingdom "), { text: "United Kingdom", value: "United Kingdom", sourceIds: [] });
  assert.equal(resolveFixedValue({ answerType: "short_text" }, "   "), null);
  assert.deepEqual(resolveFixedValue({ answerType: "checkbox" }, "ticked"), { text: "Yes", value: true, sourceIds: [] });
  assert.deepEqual(resolveFixedValue({ answerType: "yes_no", options: ["Yes", "No"] }, "No"), { text: "No", value: false, sourceIds: [] });
  assert.equal(resolveFixedValue({ answerType: "single_choice", options: ["Physiotherapist", "Osteopath"] }, "physiotherapist")?.value, "Physiotherapist");
  assert.equal(resolveFixedValue({ answerType: "date" }, "13/10/2026")?.value, "2026-10-13");
  assert.equal(resolveFixedValue({ answerType: "number" }, "30")?.value, "30");
  // Does not fit: value "" so the answer stays blank.
  assert.equal(resolveFixedValue({ answerType: "single_choice", options: ["Physiotherapist"] }, "Chiropractor")?.value, "");
  assert.equal(resolveFixedValue({ answerType: "yes_no" }, "maybe")?.value, "");
  assert.equal(resolveFixedValue({ answerType: "number" }, "about 30")?.value, "");
  const gap = fixedValueGap({ id: "F-09", label: "Therapist type", answerType: "single_choice", options: ["Physiotherapist"] }, "Chiropractor");
  assert.equal(gap.id, "gap-F-09-fixed");
  assert.match(gap.issue, /“Chiropractor”\) does not fit .* Physiotherapist/);
});

test("createFormReport: fixed answers are filled by code (no source IDs); a misfit is blank with a gap", () => {
  const f = form({ name: "Meadowbank Health (fictional)", type: "insurer" }, [
    field("Country", { kind: "fixed", value: "United Kingdom" }),
    field("Physiotherapist", { kind: "fixed", value: "Yes" }, { answerType: "checkbox" }),
    field("Therapist type", { kind: "fixed", value: "Physiotherapist" }, { answerType: "single_choice", options: ["Physiotherapist", "Osteopath"] }),
    field("Session length (minutes)", { kind: "fixed", value: "thirty" }, { answerType: "number" }),
    field("Optional note", { kind: "fixed", value: "" }, { required: false }),
  ]);
  const r = report(f, pmiBundle());
  const by = new Map(r.sections.map((s) => [s.title, s]));
  assert.deepEqual(by.get("Country")?.paragraphs.map((p) => [p.text, p.origin, p.sourceIds]), [["United Kingdom", "from_records", []]]);
  assert.equal(by.get("Country")?.kind, "from_records");
  assert.deepEqual(by.get("Physiotherapist")?.answer, { kind: "checkbox", value: true });
  assert.deepEqual(by.get("Therapist type")?.answer, { kind: "choice", value: "Physiotherapist" });
  assert.equal(by.get("Session length (minutes)")?.status, "needs_input");
  assert.deepEqual(by.get("Session length (minutes)")?.answer, { kind: "number", value: null });
  assert.equal(r.gaps.length, 2);
  assert.ok(r.gaps.every((g) => g.id.endsWith("-fixed") && g.raisedBy === "system"));
  assert.ok(r.gaps.some((g) => g.sectionKey === by.get("Session length (minutes)")?.key && /“thirty”/.test(g.issue)));
  assert.ok(r.gaps.some((g) => g.sectionKey === by.get("Optional note")?.key && /No fixed answer is set/.test(g.issue)));
  // checkFormDefinition stops a map with a missing or misfitting fixed answer being confirmed.
  const problems = checkFormDefinition(f);
  assert.ok(problems.some((p) => /Session length .*“thirty” does not fit a number question/.test(p)), problems.join("\n"));
  assert.ok(problems.some((p) => /Optional note.*enter the fixed answer/.test(p)), problems.join("\n"));
  assert.equal(problems.filter((p) => /Country|Physiotherapist|Therapist type/.test(p)).length, 0);
});

test("createFormReport: insurer identifiers go only onto the insurer on record's own form", () => {
  const fields = () => [
    field("Membership number", reg("referral.membershipNumber")),
    field("Pre-authorisation number", reg("referral.authorisationNumber"), { required: false }),
    field("Insurer", reg("referral.insurerName")),
    field("Title", reg("patient.title"), { answerType: "single_choice", options: ["Miss", "Mrs", "Ms", "Mr", "Dr", "Other"] }),
    field("Phone number", reg("patient.phone")),
    field("Therapist phone number", reg("clinic.phone")),
  ];
  const b = pmiBundle();
  // Same insurer (name differs only by "(fictional)"): copied in, cited to REG.
  const own = report(form({ name: "Meadowbank Health", type: "insurer" }, fields()), b);
  const ownBy = new Map(own.sections.map((s) => [s.title, s]));
  assert.equal(ownBy.get("Membership number")?.paragraphs[0]?.text, "DEMO-POL-0042");
  assert.deepEqual(ownBy.get("Membership number")?.paragraphs[0]?.sourceIds, ["REG"]);
  assert.equal(ownBy.get("Pre-authorisation number")?.paragraphs[0]?.text, "DEMO-AUTH-0042");
  assert.equal(ownBy.get("Insurer")?.paragraphs[0]?.text, "Meadowbank Health (fictional)");
  assert.deepEqual(ownBy.get("Title")?.answer, { kind: "choice", value: "Mr" });
  assert.equal(ownBy.get("Phone number")?.paragraphs[0]?.text, "07700 900999");
  assert.equal(ownBy.get("Therapist phone number")?.paragraphs[0]?.text, DEMO_CLINIC.phone);
  assert.equal(own.gaps.length, 0);

  // Another insurer's form: both numbers blank; a "-referrer" gap only for the required one.
  const other = report(form({ name: "Northgate Assurance (fictional)", type: "insurer" }, fields()), b);
  const otherBy = new Map(other.sections.map((s) => [s.title, s]));
  assert.deepEqual(otherBy.get("Membership number")?.paragraphs, []);
  assert.equal(otherBy.get("Membership number")?.status, "needs_input");
  assert.deepEqual(otherBy.get("Pre-authorisation number")?.paragraphs, []);
  assert.equal(otherBy.get("Pre-authorisation number")?.status, "complete", "optional: left blank, no gap");
  const gap = other.gaps.find((g) => g.sectionKey === otherBy.get("Membership number")?.key);
  assert.ok(gap && gap.id.endsWith("-referrer"));
  assert.match(gap?.issue ?? "", /This form is from Northgate Assurance \(fictional\), but the membership number on the clinic record \(“DEMO-POL-0042”\) is Meadowbank Health \(fictional\)'s/);
  assert.match(gap?.suggestedQuestion ?? "", /If this form is in fact for Meadowbank Health \(fictional\), use “DEMO-POL-0042”/);
  assert.equal(other.gaps.length, 1);
  // Registration details that are not the insurer's are still filled on any form.
  assert.equal(otherBy.get("Phone number")?.paragraphs[0]?.text, "07700 900999");

  // An intermediary's form (MLC): the strict rule still withholds the insurer's numbers.
  const mlc = report(form({ name: "Example Medico-Legal (fictional)", type: "mlc" }, fields()), b);
  assert.deepEqual(mlc.sections.find((s) => s.title === "Membership number")?.paragraphs, []);

  // A record that does not say which insurer issued the number: withheld, with its own wording.
  const unknownInsurer = pmiBundle({ type: "mlc", name: "Example Medico-Legal (fictional)", insurerName: undefined });
  const u = report(form({ name: "Meadowbank Health (fictional)", type: "insurer" }, fields()), unknownInsurer);
  assert.match(u.gaps.find((g) => g.id.endsWith("-referrer"))?.issue ?? "", /does not say which insurer issued it/);

  // No number on the record: the ordinary "not in the record" gap, on any form.
  const none = report(form({ name: "Meadowbank Health (fictional)", type: "insurer" }, fields()), pmiBundle({ membershipNumber: undefined }));
  const missing = none.gaps.find((g) => g.sectionKey === none.sections.find((s) => s.title === "Membership number")?.key);
  assert.ok(missing && missing.id.endsWith("-record"));
});

test("withheldInsurerIdentifier / isInsurerIdentifierWithheld / review helpers", () => {
  const b = pmiBundle();
  const f = { id: "F-03", label: "Membership number" };
  assert.equal(withheldInsurerIdentifier({ form: { referrer: { name: "Meadowbank Health (fictional)" } }, field: f, path: "referral.membershipNumber", bundle: b }), null);
  assert.equal(withheldInsurerIdentifier({ form: { referrer: { name: "Other (fictional)" } }, field: f, path: "patient.phone", bundle: b }), null, "not an insurer identifier");
  assert.equal(withheldInsurerIdentifier({ form: { referrer: { name: "Other (fictional)" } }, field: f, path: "referral.membershipNumber", bundle: b })?.gap.id, "gap-F-03-referrer");
  assert.equal(isInsurerIdentifierWithheld("Other (fictional)", b, "referral.authorisationNumber"), true);
  assert.equal(isInsurerIdentifierWithheld("Other (fictional)", pmiBundle({ authorisationNumber: undefined }), "referral.authorisationNumber"), false);

  assert.equal(isReferralIdentifierPath("referral.membershipNumber"), true);
  assert.equal(isReferralIdentifierPath("referral.reference"), true);
  assert.equal(isReferralIdentifierPath("referral.insurerName"), false);
  // The notice: always for the referral's reference/name (as before); for insurer numbers only when withheld.
  assert.equal(showsReferrerReferenceNotice("referral.reference", null, null), true);
  assert.equal(showsReferrerReferenceNotice("referral.membershipNumber", "Other (fictional)", b), true);
  assert.equal(showsReferrerReferenceNotice("referral.membershipNumber", "Meadowbank Health (fictional)", b), false);
  assert.equal(showsReferrerReferenceNotice("referral.membershipNumber", "Other (fictional)", pmiBundle({ membershipNumber: undefined })), false);
  assert.equal(showsReferrerReferenceNotice("patient.phone", "Other (fictional)", b), false);

  const r = { instructingParty: partyOf(b), bundleSnapshot: b };
  assert.equal(referralValueForPath("referral.reference", r), "DEMO-AUTH-0042");
  assert.equal(referralValueForPath("referral.referrerName", r), "Meadowbank Health (fictional)");
  assert.equal(referralValueForPath("referral.membershipNumber", r), "DEMO-POL-0042");
  assert.equal(referralValueForPath("referral.authorisationNumber", r), "DEMO-AUTH-0042");
  assert.equal(referralValueForPath("patient.phone", r), null);
});

test("referral reference on another organisation's form: same kind of organisation needs an explicit pointer", () => {
  const insurer = { name: "Meadowbank Health (fictional)", type: "insurer" as const };
  const otherInsurer = { name: "Northgate Assurance (fictional)", type: "insurer" as const };
  const mlc = { name: "Example Medico-Legal (fictional)", type: "mlc" as const };
  const q = (label: string, guidance = "") => ({ label, guidance });
  // Generic insurer words fit the other insurer's own number: not copied.
  assert.equal(mayCopyReferralPartyReference(q("Policy number"), insurer, otherInsurer), false);
  assert.equal(mayCopyReferralPartyReference(q("Claim reference", "The insurer's claim reference."), insurer, otherInsurer), false);
  // Explicit pointers at the referral party still copy it.
  assert.equal(mayCopyReferralPartyReference(q("Instructing insurer's reference"), insurer, otherInsurer), true);
  assert.equal(mayCopyReferralPartyReference(q("Meadowbank Health reference"), insurer, otherInsurer), true);
  // Different kinds of organisation: unchanged (asksForReferralPartyReference).
  assert.equal(mayCopyReferralPartyReference(q("Insurer's policy number"), insurer, mlc), true);
  assert.equal(mayCopyReferralPartyReference(q("Example Medico-Legal case no."), insurer, mlc), false);

  // In createFormReport: an insurer referral's reference is not copied into another insurer's "Policy number".
  const b = pmiBundle();
  const r = report(form(otherInsurer, [field("Policy number", reg("referral.reference")), field("Instructing insurer's reference", reg("referral.reference"))]), b);
  assert.deepEqual(r.sections.map((s) => s.paragraphs[0]?.text ?? null), [null, "DEMO-AUTH-0042"]);
  assert.match(r.gaps[0]?.issue ?? "", /Northgate Assurance \(fictional\) uses its own reference/);
});

test("otherInsurerOnForm / withoutOtherInsurerName: the insurer on record is \"the insurer\" on another insurer's form", () => {
  const bupa = { referral: { ...testBundle().referral, type: "insurer" as const, name: "Bupa", insurerName: "Bupa" } };
  assert.equal(otherInsurerOnForm({ referrer: { name: "AXA Global Healthcare", type: "insurer" } }, bupa), "Bupa");
  assert.equal(otherInsurerOnForm({ referrer: { name: "Bupa", type: "insurer" } }, bupa), null, "its own form");
  assert.equal(otherInsurerOnForm({ referrer: { name: "Harrow & Pike Solicitors (fictional)", type: "solicitor" } }, bupa), null, "not between insurers");
  assert.equal(otherInsurerOnForm({ referrer: { name: "AXA Global Healthcare", type: "insurer" } }, { referral: { ...testBundle().referral, insurerName: undefined } }), null, "no insurer on record");
  assert.equal(
    withoutOtherInsurerName(
      "On 01/10/2026 I recorded a further treatment request to Bupa for 4 further sessions. Bupa pre-authorised 6 sessions; consent to share with the insurer (Bupa) was recorded. The Bupa authorisation covers it; BUPA's reply is awaited.",
      "Bupa",
    ),
    "On 01/10/2026 I recorded a further treatment request to the insurer for 4 further sessions. The insurer pre-authorised 6 sessions; consent to share with the insurer was recorded. The insurer's authorisation covers it; the insurer's reply is awaited.",
  );
  assert.equal(withoutOtherInsurerName("Bupalike wording.", "Bupa"), "Bupalike wording.", "whole words only");
  assert.equal(withoutOtherInsurerName("Northgate Assurance (fictional) approved it.", "Northgate Assurance (fictional)"), "The insurer approved it.");
  assert.equal(withoutOtherInsurerName("No insurer named here.", "Bupa"), "No insurer named here.");
});
