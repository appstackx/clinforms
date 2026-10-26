/**
 * bh2 WD design 4: when assembly may enter a drafted structured answer – never an opinion no note records (C-2), never a
 * grade scale or a printed time band on an opinion box (R-safety-7), a choice only when one cited sentence states its
 * whole option phrase without a negation (B3-15) – and the duration-band arithmetic, which is information only.
 * Fictional data only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bandContaining, isDurationBandList, parseBand, quotedDuration } from "../core/duration-bands";
import { isGradeScale } from "../core/forms/answer-shape";
import type { FormField, Note, Paragraph } from "../core/types";
import { withHookDisabled } from "../core/validation/hooks";
import { TICK_SUGGESTED_HOOK, decideStructuredAnswer, draftedGapKind, optionStatedIn } from "./form-drafting-answers";

const field = (rest: Partial<FormField> & Pick<FormField, "answerType" | "fillSource">): FormField => ({
  id: "F-09",
  label: "Question",
  guidance: "",
  anchor: { kind: "docx", target: "checkbox_glyph", blockId: "t0.r9.c1" },
  required: false,
  confidence: "high",
  ...rest,
});
const note = (id: string, text: string): Note => ({ id, date: "2026-09-15", time: "10:00", type: "follow_up", author: { name: "Sarah Reid", hcpc: "PH-DEMO-01" }, subjective: text, objective: "", assessment: "", plan: "" });
const para = (text: string, basis: Paragraph["basis"], sourceIds = ["N-102"]): Paragraph => ({ id: "p1", text, sourceIds, origin: "ai", basis });

test("B3-15: a choice needs every word of the option in one cited sentence, not negated", () => {
  assert.equal(optionStatedIn("Some difficulty", ["Some stiffness in the morning; no difficulty sleeping since the second week."]), null);
  assert.equal(optionStatedIn("Some problems", ["One episode of low back pain in 2019; no problems since."]), null);
  assert.equal(optionStatedIn("Worse because of work", ["The knee was not made worse by work."]), null);
  assert.ok(optionStatedIn("Fit with a phased return", ["In my opinion he is fit for a phased return to normal duties over 2 weeks."]));
  assert.ok(optionStatedIn("Goals achieved", ["All treatment goals were achieved."]));
  assert.ok(optionStatedIn("Not fit", ["He is not fit for his usual duties."]), "a negation the option holds is part of the phrase");
  assert.equal(optionStatedIn("Goals achieved", ["Goals reviewed.", "Most were achieved."]), null, "never words from two sentences");
});

test("grade and severity scales are recognised (never ticked by code)", () => {
  const choice = (label: string, options: string[]) => field({ label, options, answerType: "single_choice", fillSource: { kind: "notes_narrative" } });
  assert.ok(isGradeScale(choice("Severity grade", ["Grade 1", "Grade 2", "Grade 3"])));
  assert.ok(isGradeScale(choice("Sleep", ["Sleeps well", "Some difficulty", "Poor sleep"])));
  assert.ok(isGradeScale(choice("Sitting", ["No Impact", "Some Problems", "Moderate Problems", "Severe Problems"])));
  assert.ok(isGradeScale(choice("Progress", ["Improving", "Static", "Worsening"])));
  assert.equal(isGradeScale(choice("Main treatment given", ["Exercise", "Manual therapy", "Acupuncture", "Taping"])), false);
  assert.equal(isGradeScale(choice("How did the problem start?", ["Injury at work", "Worse because of work", "Not related to work"])), false);
});

test("C-2: an opinion box's answer is entered only when a cited note records it as an opinion – and is never a one-click", () => {
  const f = field({ label: "Restriction: no heavy lifting", options: ["Yes"], answerType: "checkbox", fillSource: { kind: "clinician_opinion" } });
  const notes = [note("N-102", "She lifts boxes at work.")];
  const held = decideStructuredAnswer({ field: f, label: f.label, value: "Yes", paragraphs: [para("She lifts boxes at work.", "patient_reported")], citedNotes: notes, citedTexts: notes.map((n) => n.subjective) });
  assert.equal(held.enter, false);
  assert.equal(held.gap?.kind, "no_opinion_recorded");
  assert.equal(held.gap?.suggestedAnswer, undefined);
  const recorded = decideStructuredAnswer({
    field: f,
    label: f.label,
    value: "Yes",
    paragraphs: [para("On 15/09/2026 Sarah Reid recorded that in her opinion she should avoid heavy lifting.", "clinician_opinion_recorded")],
    citedNotes: [note("N-102", "In my opinion she should avoid heavy lifting.")],
    citedTexts: ["In my opinion she should avoid heavy lifting."],
  });
  assert.equal(recorded.enter, true);
});

test("R-safety-7: a printed time band on an opinion box is never ticked and never offered; the arithmetic is information only", () => {
  const f = field({ label: "Expected recovery time", options: ["0-3 months", "4-6 months", "7-12 months", "Over 12 months"], answerType: "single_choice", fillSource: { kind: "clinician_opinion" } });
  const notes = [note("N-102", "In my opinion symptoms should settle within 4-6 weeks.")];
  const d = decideStructuredAnswer({ field: f, label: f.label, value: "0-3 months", paragraphs: [para("Sarah Reid recorded that symptoms should settle within 4-6 weeks.", "clinician_opinion_recorded")], citedNotes: notes, citedTexts: notes.map((n) => n.subjective) });
  assert.equal(d.enter, false);
  assert.equal(d.gap?.kind, "band");
  assert.equal(d.gap?.suggestedAnswer, undefined);
  // Without a note that anchors the expectation (WB's findAnchor), no band is even named as information.
  assert.doesNotMatch(d.gap?.issue ?? "", /which is within/);

  assert.ok(isDurationBandList(f.options));
  assert.deepEqual(parseBand("0-3 MONTHS"), { min: 0, max: 3 * 30.4375 });
  assert.equal(parseBand("Exercise"), null);
  assert.equal(bandContaining(quotedDuration("should settle within 4–6 weeks")!, f.options ?? []), "0-3 months", "B2-10: 4–6 weeks is within 0-3 months");
  assert.equal(bandContaining(quotedDuration("2 to 4 months")!, f.options ?? []), null, "across two bands: no band");
  assert.equal(quotedDuration("attended 7 sessions over 6 weeks, review in 4 weeks"), null, "two durations are not one expectation");
});

test("a held-back choice is a one-click only on a box a person may tick, and only while the hook is on", async () => {
  const f = field({ label: "Main treatment given", options: ["Exercise", "Manual therapy"], answerType: "single_choice", fillSource: { kind: "notes_narrative" } });
  const input = { field: f, label: f.label, value: "Exercise", paragraphs: [para("A home programme of pelvic tilts was given.", "record")], citedNotes: [note("N-102", "HEP: pelvic tilts.")], citedTexts: ["HEP: pelvic tilts."] };
  const d = decideStructuredAnswer(input);
  assert.equal(d.enter, false);
  assert.equal(d.gap?.suggestedAnswer, "Exercise");
  await withHookDisabled(TICK_SUGGESTED_HOOK, async () => assert.equal(decideStructuredAnswer(input).gap?.suggestedAnswer, undefined));
  const physio = field({ ...f, fillSource: { kind: "registration", path: "staff.entry" }, guidance: "Chosen by the clinician each time." });
  assert.equal(decideStructuredAnswer({ ...input, field: physio }).gap?.suggestedAnswer, undefined, "C-2: never on the physiotherapist's choice");
});

test("every drafted gap gets a kind (the review words 'Needs clinician input' from it, B3-10 a)", () => {
  const opinion = field({ answerType: "single_choice", options: ["Yes", "No"], fillSource: { kind: "clinician_opinion" } });
  assert.equal(draftedGapKind(opinion, "No clinician recorded an opinion on this.", ["N-102"]), "no_opinion_recorded");
  assert.equal(draftedGapKind(opinion, "Tom Ellis recorded a phased return over 2 weeks; it fits neither Yes nor No.", ["N-102"]), "opinion_not_fitting_options");
  assert.equal(draftedGapKind(field({ answerType: "short_text", fillSource: { kind: "notes_narrative" } }), "The notes do not give the date.", []), "record_value");
  assert.equal(draftedGapKind(field({ answerType: "short_text", fillSource: { kind: "registration", path: "staff.entry" } }), "Typed by staff.", []), "staff_entry");
});
