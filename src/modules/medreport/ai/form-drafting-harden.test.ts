/**
 * bh2 WD harden round (check2-WD): drafted meta-wording and self-corrections in their usual paraphrases are held back
 * (N2), a choice is never ticked from a plan, a question, a wish or an earlier episode – and a negated or planned one is
 * never a one-click (N3, minors 2 and 3) – a dose in the note's next sentence or line counts (N4), and held-back text is
 * quoted in full (minor 1). Fictional data only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFacts } from "../core/computed-facts";
import { formToTemplate } from "../core/forms";
import type { FormDefinition, FormDraftGroupOutput, FormField, Note, Paragraph } from "../core/types";
import { citedDoseFor, undosedMedicine } from "../core/validation/draft-fit/measure";
import { TEST_FACTS_DATE, testBundle } from "../core/validation/test-fixtures";
import { assembleDraft } from "./assemble";
import { decideStructuredAnswer, optionEvidence, optionStatedIn } from "./form-drafting-answers";
import { holdBackMeta } from "./form-drafting-wording";
import { FORM_DRAFT_PROMPT_VERSION } from "./form-prompts";

/* ------------------------------------------------------------------------------------------------
 * N2 – meta-wording paraphrases
 * ----------------------------------------------------------------------------------------------*/

const held = (text: string) => {
  const out = holdBackMeta(text);
  return { printed: out.text, held: [...out.heldBack, ...out.retracted].join(" ") };
};

const metaCases: Array<[string, string, string]> = [
  ["a correction after a dash", "Lumbar movement was limited and painful at discharge – actually, that was at the first assessment.", "limited and painful at discharge"],
  ["a correction after a semicolon", "Lumbar movement was limited at discharge; actually, that was at the first assessment.", "limited at discharge"],
  ["', though actually …'", "Lumbar movement was limited at discharge, though actually that was at the first assessment.", "limited at discharge"],
  ["'My mistake – …'", "Lumbar movement was limited at discharge. My mistake – that was at the first assessment.", "limited at discharge"],
  ["'Apologies, …'", "Lumbar movement was limited at discharge. Apologies, that was at the first assessment.", "limited at discharge"],
  ["'On closer reading, …'", "Lumbar movement was limited at discharge. On closer reading, that was at the first assessment.", "limited at discharge"],
  ["'Re-reading the note, …'", "Lumbar movement was limited at discharge. Re-reading the note, that is from the first assessment.", "limited at discharge"],
  ["'That should read: …'", "Lumbar movement was limited at discharge. That should read: full and pain-free.", "limited at discharge"],
  ["'To clarify, …'", "Lumbar movement was limited at discharge. To clarify, that was at the first assessment.", "limited at discharge"],
  ["'(or rather, …)' – the corrected words are held back too", "Lumbar movement was limited (or rather, full and pain-free) at discharge.", "limited"],
  ["a basis label in brackets", "Lumbar movement was full and pain-free at discharge (clinician_observed).", "clinician_observed"],
  ["'Basis: …'", "Basis: patient_reported. Mr Testcase reported pain of 2/10 at worst.", "patient_reported"],
  ["a tag with a space", "Lumbar movement was full and pain-free at discharge. (clinician opinion)", "clinician opinion"],
  ["a tag in square brackets", "Lumbar movement was full and pain-free at discharge [record question].", "record question"],
  ["question-kind talk", "Lumbar movement was full and pain-free. As this is a record question, the answer is taken from the discharge note.", "record question"],
  ["'This is an opinion question …'", "This is an opinion question, so only the recorded finding is given.", "opinion question"],
  ["talk about the question", "This question asks for the recorded finding, so the discharge note is used.", "question asks"],
];
for (const [name, text, notPrinted] of metaCases) {
  test(`harden N2: held back – ${name}`, () => {
    const out = held(text);
    assert.ok(out.held.length > 0, `nothing held back: ${JSON.stringify(out.printed)}`);
    assert.ok(!out.printed.includes(notPrinted), `printed: ${JSON.stringify(out.printed)}`);
  });
}

test("harden N2: ordinary clinical wording is not held back", () => {
  for (const text of [
    "To clarify the diagnosis, an MRI scan was requested by his GP.",
    "Mr Testcase sent his apologies for the missed appointment on 01/04/2026.",
    "On closer inspection there was bruising over the inner side of the knee.",
    "The clinician observed a normal gait.",
    "He was actually able to complete a full shift.",
    "Tom Ellis's recorded opinion on 06/05/2026 was a phased return to normal duties over 2 weeks.",
    "He was advised to continue his exercises as instructed.",
    "The prompt referral to physiotherapy was noted by the case manager.",
    "The plan was to update the case manager after the next session.",
    "To clarify the mechanism, Tom Ellis asked how the box was lifted.",
  ]) {
    const out = holdBackMeta(text);
    assert.equal(out.text, text, text);
    assert.deepEqual([...out.heldBack, ...out.retracted], [], text);
  }
});

test("harden N2: a basis label aside goes on its own; the rest prints", () => {
  assert.equal(holdBackMeta("Lumbar movement was full and pain-free at discharge (clinician_observed).").text, "Lumbar movement was full and pain-free at discharge.");
  assert.equal(holdBackMeta("Basis: patient_reported. Mr Testcase reported pain of 2/10 at worst.").text, "Mr Testcase reported pain of 2/10 at worst.");
});

/* ------------------------------------------------------------------------------------------------
 * N3, minors 2 and 3 – choices
 * ----------------------------------------------------------------------------------------------*/

test("harden N3: a choice is never stated by a plan, a question, a wish, a booking or an earlier episode", () => {
  const notStated: Array<[string, string]> = [
    ["Acupuncture", "Plan: Review in 2 weeks. Acupuncture at the next appointment."],
    ["Acupuncture", "Plan: HEP. ?Acupuncture."],
    ["Acupuncture", "Subjective: Keen to try acupuncture."],
    ["Acupuncture", "Subjective: Wants acupuncture."],
    ["Acupuncture", "Plan: Acupuncture booked for next week."],
    ["Acupuncture", "Subjective: Acupuncture TBC."],
    ["Taping", "Plan: Taping next time if still sore."],
    ["Manual therapy", "Subjective: Had manual therapy for neck pain in 2019 with good effect."],
    ["Manual therapy", "Subjective: Previous episode settled with manual therapy."],
    ["Manual therapy", "N-001 · 18/03/2026 · Initial assessment · Sarah Reid\nSubjective: Pain since lifting.\nPMH: Manual therapy for a neck problem, settled."],
    ["Manual therapy", "N-001 · 18/03/2026 · Initial assessment · Sarah Reid\nPlan: Manual therapy given to L4/5."],
  ];
  for (const [option, text] of notStated) assert.equal(optionStatedIn(option, [text]), null, text);
  // Facts of this episode still count.
  assert.ok(optionStatedIn("Manual therapy", ["Objective: Manual therapy given to L4/5."]));
  assert.ok(optionStatedIn("Manual therapy", ["N-001 · 18/03/2026 · Initial assessment · Sarah Reid\nObjective: Manual therapy given to L4/5 on 18/03/2026."]));
  assert.ok(optionStatedIn("Manual therapy", ["N-001 · 18/03/2026 · Initial assessment · Sarah Reid\nObjective: Manual therapy since the start of 2026, given weekly."]), "a year of this episode is no earlier episode");
});

test("harden N3: the evidence says why – negated, or only planned", () => {
  assert.equal(optionEvidence("Manual therapy", ["Plan: Manual therapy was not used. HEP: pelvic tilts."])?.kind, "negated");
  assert.equal(optionEvidence("Acupuncture", ["Plan: Acupuncture to be considered if no progress."])?.kind, "not_asserted");
  assert.equal(optionEvidence("Acupuncture", ["Objective: Acupuncture given to the lumbar spine."])?.kind, "stated");
  assert.equal(optionEvidence("Taping", ["Objective: Lumbar flexion 50% limited."]), null);
});

const choiceField = (rest: Partial<FormField> = {}): FormField => ({
  id: "F-20",
  label: "Main treatment given",
  guidance: "",
  answerType: "single_choice",
  options: ["Exercise", "Manual therapy", "Acupuncture", "Taping"],
  anchor: { kind: "docx", target: "checkbox_glyph", blockId: "t0.r20.c1" },
  fillSource: { kind: "notes_narrative" },
  required: false,
  confidence: "high",
  ...rest,
});
const note = (id: string, fields: Partial<Note>): Note => ({ id, date: "2026-03-18", time: "09:00", type: "initial_assessment", author: { name: "Sarah Reid", hcpc: "PH-DEMO-01" }, subjective: "", objective: "", assessment: "", plan: "", ...fields });
const para = (text: string, basis: Paragraph["basis"] = "record"): Paragraph => ({ id: "p1", text, sourceIds: ["N-001"], origin: "ai", basis });

test("harden minor 2: a choice the note negates or only plans is held back with the note's words and never offered as one click", () => {
  for (const [value, plan, words] of [
    ["Manual therapy", "Plan: Manual therapy was not used. HEP: pelvic tilts 10 x 3/day.", /the cited notes say otherwise – “Manual therapy was not used\.”/],
    ["Acupuncture", "Plan: HEP: pelvic tilts 10 x 3/day. Acupuncture to be considered if no progress.", /only as a plan, a question, a wish or from before this episode – “Acupuncture to be considered if no progress\.”/],
    ["Acupuncture", "Plan: Acupuncture booked for next week.", /only as a plan/],
  ] as const) {
    const d = decideStructuredAnswer({ field: choiceField(), label: "Main treatment given", value, paragraphs: [para("Drafted.")], citedNotes: [note("N-001", { plan })], citedTexts: [plan] });
    assert.equal(d.enter, false, plan);
    assert.equal(d.gap?.suggestedAnswer, undefined, `${plan}: no one-click`);
    assert.match(d.gap?.issue ?? "", words);
    assert.doesNotMatch(d.gap?.suggestedQuestion ?? "", /one click/);
  }
  // Control: a choice no note mentions is still offered as one click on a record box (SCALE-tick-pass-01).
  const none = decideStructuredAnswer({ field: choiceField(), label: "Main treatment given", value: "Exercise", paragraphs: [para("A home programme of pelvic tilts was given.")], citedNotes: [note("N-001", { plan: "HEP: pelvic tilts." })], citedTexts: ["Plan: HEP: pelvic tilts."] });
  assert.equal(none.gap?.suggestedAnswer, "Exercise");
});

test("harden minor 3: an opinion choice is held back with the note's own words, even when a clause holds a negation", () => {
  const f = choiceField({ id: "F-04", label: "Can the patient do their usual job?", options: ["Yes", "With changes", "No"], fillSource: { kind: "clinician_opinion" } });
  const text = "Can do usual job with changes: no lifting over 10 kg.";
  const d = decideStructuredAnswer({ field: f, label: f.label, value: "With changes", paragraphs: [{ ...para("On 18/03/2026 Sarah Reid recorded that he could do his usual job with changes.", "clinician_opinion_recorded") }], citedNotes: [note("N-001", { assessment: text })], citedTexts: [`Assessment: ${text}`] });
  assert.equal(d.enter, false);
  assert.match(d.gap?.issue ?? "", /Sarah Reid recorded: “Can do usual job with changes: no lifting over 10 kg\.” \(18\/03\/2026\)/);
  assert.doesNotMatch(d.gap?.issue ?? "", /without a negation/);
  assert.equal(d.gap?.suggestedAnswer, undefined);
});

/* ------------------------------------------------------------------------------------------------
 * N4 – the dose in the next sentence or line
 * ----------------------------------------------------------------------------------------------*/

test("harden N4: a dose in the note's next sentence or line, or a bare strength, counts as a dose", () => {
  for (const text of [
    "Started on ibuprofen by his GP. 400 mg three times a day.",
    "Meds: ibuprofen\n400 mg three times a day",
    "Meds: ibuprofen\nAs needed\n400 mg",
    "Ibuprofen 400 tds, helps a little.",
    "Ibuprofen 400, helps a little.",
    "400 mg of ibuprofen three times a day.",
  ]) {
    assert.equal(citedDoseFor("ibuprofen", text), true, text);
    assert.equal(undosedMedicine("Mr Testcase reported taking ibuprofen for the pain.", text), null, text);
  }
  // Another medicine's dose is not this one's; a frequency alone is no dose.
  assert.equal(citedDoseFor("ibuprofen", "Taking ibuprofen. Paracetamol 500 mg as needed."), false);
  assert.equal(citedDoseFor("ibuprofen", "Taking ibuprofen as needed."), false);
  assert.equal(undosedMedicine("Mr Testcase reported taking ibuprofen for the pain.", "Taking ibuprofen. Paracetamol 500 mg as needed."), "ibuprofen");
});

/* ------------------------------------------------------------------------------------------------
 * Minor 1 – held-back text in full
 * ----------------------------------------------------------------------------------------------*/

const AT = "2026-10-06T09:00:00.000Z";
function objectiveForm(): FormDefinition {
  return {
    id: "frm_hd",
    tenantId: "demo",
    referrer: { name: "Example Case Services (fictional)", type: "mlc" },
    title: "Treatment Summary Report",
    file: { fileName: "hd.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: "e".repeat(64), sizeBytes: 1 },
    kind: "docx",
    fields: [{ id: "F-15", label: "Objective findings", guidance: "", answerType: "long_text", anchor: { kind: "docx", target: "after_paragraph", blockId: "p15" }, fillSource: { kind: "notes_narrative" }, required: false, confidence: "high" }],
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "t", at: AT, warnings: [] },
    confirmed: { by: "Test", at: AT },
    createdAt: AT,
    updatedAt: AT,
  };
}

test("harden minor 1: a long retracted paragraph is quoted whole in its held-back gap", () => {
  const fm = objectiveForm();
  const bundle = testBundle();
  const text =
    "On 06/05/2026 Tom Ellis, physiotherapist, recorded lumbar flexion as full and pain-free with no pain on overpressure in any direction. He recorded the Oswestry Disability Index as 18% and noted that Mr Testcase was working amended duties with no lifting over 10 kg. Mr Testcase reported that his pain was 2/10 at worst after his shifts and that he was sleeping through the night. Actually, that was at the first assessment.";
  const output: FormDraftGroupOutput = { sections: [{ sectionKey: "F-15", answer: "", paragraphs: [{ text, sourceIds: ["N-002"], basis: "clinician_observed" }] }], gaps: [] };
  const res = assembleDraft({
    template: formToTemplate(fm),
    bundle,
    instructingParty: bundle.referral,
    sectionKeys: ["F-15"],
    computedFacts: computeFacts(bundle, { asOf: TEST_FACTS_DATE }),
    output,
    meta: { mode: "demo_prewritten", sectionKeys: ["F-15"], at: AT, promptVersion: FORM_DRAFT_PROMPT_VERSION },
    form: fm,
    idSeed: "hd",
    approver: { name: "Sarah Reid", hcpc: "PH-DEMO-01" },
  });
  assert.deepEqual(res.sections[0].paragraphs, []);
  const gap = res.gaps.find((g) => g.kind === "meta_held_back");
  assert.ok(gap);
  assert.ok(gap.issue.includes("sleeping through the night. Actually, that was at the first assessment."), gap.issue);
  assert.ok(!gap.issue.includes("…”"), "never cut short");
});

test("harden N3: 'since the previous session' is this episode – a fact of it still ticks", () => {
  assert.ok(optionStatedIn("Improving", ["Assessment: Improving since the previous session."]));
  assert.equal(optionStatedIn("Improving", ["Assessment: Previously improving, then worse."]), null);
});

test("harden N2: a self-correction that points back at the sentence before retracts it too", () => {
  for (const text of [
    "Lumbar movement was limited at discharge. Looking again, that was at the first assessment.",
    "Lumbar movement was limited at discharge. On second look, that was the first visit.",
    "Lumbar movement was limited at discharge. I have double-checked and that was the first visit.",
  ]) {
    const out = holdBackMeta(text);
    assert.equal(out.text, "", text);
    assert.equal(out.retracted.length, 1, text);
  }
});

test("harden N3: 'maybe' or 'perhaps' is no fact", () => {
  assert.equal(optionStatedIn("Acupuncture", ["Subjective: Acupuncture – maybe."]), null);
  assert.equal(optionStatedIn("Acupuncture", ["Plan: Perhaps acupuncture."]), null);
});
