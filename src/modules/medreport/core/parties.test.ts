/**
 * Who completes which part of a referrer's form (core/parties.ts): the phrases of UK insurer and
 * medico-legal forms, and the confirmation check that keeps the clinician's approval out of another
 * party's signature box (core/forms.ts checkFormDefinition).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFormDefinition } from "./forms";
import { completerParty, headingParty, isNonClinicParty, partyLabel, partyOfWho, signerParty } from "./parties";
import type { FormDefinition, FormField } from "./types";

test("completer phrases: who a part of the form is for", () => {
  assert.equal(completerParty("1. Policyholder’s details – to be completed by the policyholder"), "policyholder");
  assert.equal(completerParty("2. Medical details – to be completed by the patient (or parent or guardian if patient is under 16 years old)."), "patient");
  assert.equal(completerParty("4. Medical details (to be completed by the GP, dentist, optician or other medical practitioner)"), "doctor");
  assert.equal(completerParty("Section 4 – to be completed by your practitioner"), "clinic");
  assert.equal(completerParty("To be completed by the treating physiotherapist. Please print clearly."), "clinic");
  assert.equal(completerParty("This section is to be completed by your GP or therapist"), "clinic", "the clinic may complete it");
  assert.equal(completerParty("For completion by the insurer"), "insurer");
  assert.equal(completerParty("Patient to complete"), "patient");
  assert.equal(completerParty("All sections must be completed by the treating therapist."), "clinic");
  // Not completer phrases.
  assert.equal(completerParty("The appropriate medical professionals must complete Section 4 of the claim form."), null);
  assert.equal(completerParty("IF GP HAS COMPLETED A REFERRAL LETTER PLEASE ENCLOSE A COPY"), null);
  assert.equal(completerParty("Please complete all relevant sections in BLOCK CAPITALS"), null);
  assert.equal(completerParty("This section is to be completed by you"), null, "plain “you” is not mapped");
});

test("signer phrases: whose signature or declaration it is", () => {
  assert.equal(signerParty("Policyholder’s signature:"), "policyholder");
  assert.equal(signerParty("Policyholders signature"), "policyholder");
  assert.equal(signerParty("Patient's signature (if different and the patient is 18 or over):"), "patient");
  assert.equal(signerParty("Signature of medical practitioner"), "doctor");
  assert.equal(signerParty("Doctor’s signature:"), "doctor");
  assert.equal(signerParty("Therapist's declaration"), "clinic");
  assert.equal(signerParty("I am this patient’s therapist and confirm the information I have provided is correct."), "clinic");
  assert.equal(signerParty("The policyholder named in section one must sign and date below for all claims."), "policyholder");
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
  assert.equal(headingParty("2 Therapist details"), "clinic");
  assert.equal(headingParty("1 Patient’s details"), null, "a section about the patient is not the patient's to complete");
  assert.equal(headingParty("Access to your health and medical information – consent form"), "patient");
  assert.equal(headingParty("FOR OFFICE USE ONLY"), "insurer");
  assert.equal(headingParty("For Northfield Assurance use only"), "insurer");
  assert.equal(headingParty("4. Medical details (to be completed by the GP)"), "doctor");
  assert.equal(partyOfWho("the GP, dentist, optician or other medical practitioner"), "doctor");
  assert.equal(partyOfWho("the policyholder if the patient is 18 or under"), "policyholder");
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
