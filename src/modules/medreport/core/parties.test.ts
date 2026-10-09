/**
 * Who completes which part of a referrer's form (core/parties.ts): the phrases of UK insurer and
 * medico-legal forms, and the confirmation check that keeps the clinician's approval out of another
 * party's signature box (core/forms.ts checkFormDefinition).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FORM_ATTESTATIONS, PREFILL_ATTESTATIONS, checkFormDefinition, formToTemplate } from "./forms";
import { blankFor, blankForCounts, blankForSummary, blankForWording, completerParty, headingParty, isNonClinicParty, partyLabel, partyOfWho, prefillSigners, prefillSignersText, signerParty } from "./parties";
import type { FormDefinition, FormField } from "./types";

test("completer phrases: who a part of the form is for", () => {
  assert.equal(completerParty("A. Member’s information – to be completed by the policyholder"), "policyholder");
  assert.equal(completerParty("B. Your symptoms – to be completed by the patient (or a parent or guardian for a child)."), "patient");
  assert.equal(completerParty("D. Clinical history (to be completed by the GP, consultant or another medical practitioner)"), "doctor");
  assert.equal(completerParty("Section 4 – to be completed by your practitioner"), "clinic");
  assert.equal(completerParty("To be completed by the treating physiotherapist. Please print clearly."), "clinic");
  assert.equal(completerParty("This section is to be completed by your GP or therapist"), "clinic", "the clinic may complete it");
  assert.equal(completerParty("For completion by the insurer"), "insurer");
  assert.equal(completerParty("Patient to complete"), "patient");
  assert.equal(completerParty("All sections must be completed by the treating therapist."), "clinic");
  // Not completer phrases.
  assert.equal(completerParty("Your treating doctors must complete Part D of this claim."), null);
  assert.equal(completerParty("WHERE THE GP HAS COMPLETED A REFERRAL, ATTACH IT"), null);
  assert.equal(completerParty("Please fill in every part that applies, in capital letters"), null);
  assert.equal(completerParty("This section is to be completed by you"), null, "plain “you” is not mapped");
});

test("signer phrases: whose signature or declaration it is", () => {
  assert.equal(signerParty("Policyholder’s signature:"), "policyholder");
  assert.equal(signerParty("Policyholders signature"), "policyholder");
  assert.equal(signerParty("Patient's signature (if not the member):"), "patient");
  assert.equal(signerParty("Signature of the examining medical practitioner"), "doctor");
  assert.equal(signerParty("Doctor’s signature:"), "doctor");
  assert.equal(signerParty("Therapist's declaration"), "clinic");
  assert.equal(signerParty("I am the therapist treating this patient and the details above are correct."), "clinic");
  assert.equal(signerParty("The member named in part A must sign and date this claim."), "policyholder");
  // Lists of parties before "declaration" / "signature".
  assert.equal(signerParty("Patient or parent/guardian declaration"), "patient");
  assert.equal(signerParty("Policyholder/patient declaration"), "policyholder");
  assert.equal(signerParty("Patient / Policyholder Declaration"), "patient");
  assert.equal(signerParty("Claimant's / patient's declaration"), "patient");
  assert.equal(signerParty("Policyholder & patient signature"), "policyholder");
  assert.equal(headingParty("Patient or parent/guardian declaration"), "patient");
  assert.equal(completerParty("Policyholder/patient to complete"), "policyholder");
  assert.equal(signerParty("Signature"), null);
  assert.equal(signerParty("Your signature"), null);
  assert.equal(signerParty("Date of signature"), null);
});

test("heading parties and labels", () => {
  assert.equal(headingParty("B Therapist details"), "clinic");
  assert.equal(headingParty("A Patient’s details"), null, "a section about the patient is not the patient's to complete");
  assert.equal(headingParty("Sharing your medical records – consent form"), "patient");
  assert.equal(headingParty("FOR OFFICE USE ONLY"), "insurer");
  assert.equal(headingParty("For Northfield Assurance use only"), "insurer");
  assert.equal(headingParty("D. Clinical history (to be completed by the GP)"), "doctor");
  assert.equal(partyOfWho("the GP, consultant or another medical practitioner"), "doctor");
  assert.equal(partyOfWho("the member when the patient is a child"), "policyholder");
  assert.equal(partyOfWho("the patient's GP"), "doctor");
  assert.equal(partyOfWho("your patient's treating physiotherapist"), "clinic");
  assert.equal(isNonClinicParty("doctor"), true);
  assert.equal(isNonClinicParty("clinic"), false);
  assert.equal(isNonClinicParty("unknown"), false);
  assert.equal(isNonClinicParty(undefined), false);
  assert.equal(partyLabel("doctor"), "the patient's doctor");
});

function field(id: string, label: string, rest: Partial<FormField>): FormField {
  return {
    id,
    label,
    guidance: "",
    answerType: "short_text",
    anchor: { kind: "pdf_field", fieldName: id, fieldType: "text" },
    fillSource: { kind: "notes_narrative" },
    required: true,
    confidence: "high",
    ...rest,
  };
}

function form(fields: FormField[]): FormDefinition {
  return {
    id: "frm_parties",
    tenantId: "demo",
    referrer: { name: "Example Health (fictional)", type: "insurer" },
    title: "Claim form",
    file: { fileName: "claim.pdf", mimeType: "application/pdf", sha256: "a".repeat(64), sizeBytes: 1 },
    kind: "pdf_acroform",
    fields,
    status: "proposed",
    analysis: { mode: "rules", promptVersion: "rules-1", at: "2026-10-09T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-09T09:00:00.000Z",
    updatedAt: "2026-10-09T09:00:00.000Z",
  };
}

test("confirmation refuses the clinician's sign-off in another party's answer space", () => {
  const ok = form([
    field("F-01", "Therapist's name", { fillSource: { kind: "signoff", part: "name" }, answerType: "clinician_name", completedBy: "clinic" }),
    field("F-02", "Date", { fillSource: { kind: "signoff", part: "date" }, answerType: "date_signed" }),
    field("F-03", "Policyholder's signature", { fillSource: { kind: "leave_blank" }, completedBy: "policyholder" }),
    field("F-04", "Diagnosis", { completedBy: "unknown" }),
  ]);
  assert.deepEqual(checkFormDefinition(ok), []);

  const bad = form([
    ...ok.fields,
    field("F-05", "Policyholder's signature", { fillSource: { kind: "signoff", part: "signature" }, answerType: "signature", completedBy: "policyholder" }),
    field("F-06", "Signature of medical practitioner", { fillSource: { kind: "signoff", part: "signature" }, answerType: "signature", completedBy: "doctor" }),
    field("F-07", "Date", { fillSource: { kind: "signoff", part: "date" }, answerType: "date_signed", completedBy: "patient" }),
  ]);
  const problems = checkFormDefinition(bad);
  assert.equal(problems.length, 3, problems.join("\n"));
  assert.match(problems[0], /^F-05 .*for the policyholder to complete, so the clinician's approval cannot be written here/);
  assert.match(problems[1], /^F-06 .*the patient's doctor/);
  assert.match(problems[2], /^F-07 .*the patient/);
  assert.ok(problems.every((p) => /Leave blank/.test(p)));
});

test("boxes left blank say whose they are, and the card counts them by party", () => {
  assert.equal(blankFor({ completedBy: "patient", label: "Symptoms in your own words" }), "patient");
  assert.equal(blankFor({ completedBy: "policyholder", label: "Bank sort code" }), "policyholder");
  assert.equal(blankFor({ completedBy: "doctor", label: "Doctor's signature" }), "doctor");
  assert.equal(blankFor({ completedBy: "insurer", label: "Claim received" }), "insurer");
  assert.equal(blankFor({ label: "Date received", section: "For office use only" }), "insurer", "office-use wording without a party");
  assert.equal(blankFor({ completedBy: "clinic", label: "Other – please give details" }), "not_needed");
  assert.equal(blankFor({ label: "Fax number" }), "not_needed");
  assert.equal(blankForWording("patient").chip, "For the patient to complete");
  assert.equal(blankForWording("doctor").chip, "For the patient's GP or doctor");
  assert.equal(blankForWording("insurer", "Example Health (fictional)").sentence, "Left blank on the form – for office use by Example Health (fictional).");
  assert.doesNotMatch(blankForWording("policyholder", "Example Health (fictional)").sentence, /own use|referrer/);

  const fields = [
    { completedBy: "patient" as const, fillSource: { kind: "leave_blank" } },
    { completedBy: "patient" as const, fillSource: { kind: "leave_blank" } },
    { completedBy: "doctor" as const, fillSource: { kind: "leave_blank" } },
    { label: "Office ref", section: "Office use only", fillSource: { kind: "leave_blank" } },
    { completedBy: "clinic" as const, fillSource: { kind: "leave_blank" } },
    { completedBy: "patient" as const, fillSource: { kind: "registration" } },
  ];
  assert.deepEqual(blankForSummary(blankForCounts(fields), "Example Health (fictional)"), ["3 for the patient or their GP", "1 for office use", "1 not needed"]);
});

test("a form the clinic only prefills for others to sign is never the clinic's signed form", () => {
  const claim = form([
    field("F-01", "Member's full name", { fillSource: { kind: "registration", path: "patient.fullName" } }),
    field("F-02", "Member's signature", { fillSource: { kind: "leave_blank" }, answerType: "signature", completedBy: "policyholder" }),
    field("F-03", "Patient signature (if not the member)", { fillSource: { kind: "leave_blank" }, answerType: "signature", completedBy: "patient" }),
  ]);
  assert.deepEqual(prefillSigners(claim), ["patient", "policyholder"]);
  assert.equal(prefillSignersText(["patient", "policyholder"]), "the patient and the policyholder");
  assert.equal(prefillSignersText(["patient", "doctor"]), "the patient and their GP or doctor");
  const t = formToTemplate(claim);
  assert.deepEqual(t.attestations, [...PREFILL_ATTESTATIONS]);
  assert.match(t.declarationNote ?? "", /Nobody at the clinic signs this form/);

  // The clinic signs its own declaration: an ordinary form.
  const own = form([...claim.fields, field("F-04", "Therapist's signature", { fillSource: { kind: "signoff", part: "signature" }, answerType: "signature", completedBy: "clinic" })]);
  assert.equal(prefillSigners(own), null);
  assert.deepEqual(formToTemplate(own).attestations, [...FORM_ATTESTATIONS]);
  // No signature box at all (or only the insurer's): not a prefill either.
  assert.equal(prefillSigners(form([claim.fields[0]])), null);
  assert.equal(prefillSigners({ ...claim, kind: "questions" }), null);
});
