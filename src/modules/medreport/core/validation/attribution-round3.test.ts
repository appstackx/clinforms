/**
 * Blue Heart fix round 3 – attribution safety: whose opinion a printed answer gives.
 * - B2-1: the signer's own opinion typed over a draft is never moved onto another clinician ("Name Tom Ellis instead"),
 *   it counts as the clinician's own words, and "in Tom Ellis's opinion" / "I expect these to ease" are opinion wording.
 * - B2-2: another clinician's recorded diagnosis in a narrow cell is not printed without their name.
 * - B2-3: "Tom Ellis … saw Mr Ellery … while covering my annual leave" may be acknowledged, or put in the signer's name.
 * - B2-11: "before going back to normal duties" is a narrated return, as "before returning" is.
 * - B2-17: "No restrictions on duties or hours were recorded in her notes." is commentary, not an opinion.
 * Fictional record (test fixtures: N-001 Sarah Reid 18/03/2026, N-002 Tom Ellis 06/05/2026); texts as drafted and typed
 * on Blue Heart's forms in the round-2 test run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SOLICITOR_RTA_TEMPLATE } from "../../templates/registry";
import { computeFacts } from "../computed-facts";
import type { Report, ReportFlag } from "../types";
import { nameClinicianInstead } from "../voice";
import { canAcknowledge, runValidators } from "./index";
import { findUnsupportedOpinionPhrases } from "./opinion-language";
import { normaliseForMatch } from "./text";
import { TEST_FACTS_DATE, para, testBundle, testReport, withSection } from "./test-fixtures";

const SOL = SOLICITOR_RTA_TEMPLATE;
const SARAH = { name: "Sarah Reid", hcpc: "PH-DEMO-01" };

function run(report: Report): ReportFlag[] {
  return runValidators({ report, bundle: report.bundleSnapshot, template: SOL, computedFacts: computeFacts(report.bundleSnapshot, { asOf: TEST_FACTS_DATE }) });
}

/** Sarah Reid signs; Tom Ellis wrote N-002. */
const signedBySarah = (key: string, paragraphs: ReturnType<typeof para>[]): Report => ({ ...withSection(testReport(SOL), key, paragraphs), author: SARAH });

/* B2-1 ----------------------------------------------------------------------------------------------------------------- */

const OWN_OPINION =
  "In my opinion Mrs Whitlock has moderate restrictions with daily activities at present: she cannot sit for longer than 30 minutes, needs her hands to stand from a chair, avoids bending and lifting, and has shortened her dog walks. I expect these to ease steadily as her pain settles.";
const DRAFT_F14 =
  "On 08/09/2026 Mrs Whitlock told Tom Ellis, physiotherapist, that her pain was worse with bending, lifting, getting up from a chair and sitting for more than 30 minutes, and that she had morning stiffness for about 30 minutes. She reported sleeping poorly, waking when turning over, and walking the dog in shorter walks than usual at present.";

test("B2-1: “Name Tom Ellis instead” never moves the signer's own opinion onto Tom Ellis (Bodycare IA F-14)", async () => {
  // It produced "In Tom Ellis's opinion … Tom Ellis expect these to ease…" – an opinion Tom never recorded.
  assert.equal(nameClinicianInstead(OWN_OPINION, "Tom Ellis"), null);
  for (const own of ["In my view the stiffness is easing.", "I think she can manage light duties.", "I recommend 4 further sessions.", "It is my assessment that she is improving."]) {
    assert.equal(nameClinicianInstead(own, "Tom Ellis"), null, own);
  }
  // A past action reported from Tom's note is still named, and stays grammatical.
  assert.equal(nameClinicianInstead("I advised heat and I saw her again on 15/09/2026.", "Tom Ellis"), "Tom Ellis advised heat and Tom Ellis saw her again on 15/09/2026.");
  assert.equal(nameClinicianInstead("I have advised heat.", "Tom Ellis"), null, "no “Tom Ellis have advised”");

  // Typed over the draft, it is the clinician's own words: no citation, no voice check, no one-click rename.
  const { draftWordsKept, editParagraph, nameClinicianFix, OWN_WORDS_BELOW } = await import("../../ui/components/review/review-model");
  assert.ok(draftWordsKept(DRAFT_F14, OWN_OPINION) < OWN_WORDS_BELOW, `kept ${draftWordsKept(DRAFT_F14, OWN_OPINION)}`);
  const drafted = signedBySarah("prognosis", [para(DRAFT_F14, ["N-002"], { id: "f14", basis: "patient_reported" })]);
  const typed = editParagraph(drafted, "prognosis", "f14", OWN_OPINION);
  const p = typed.sections.find((s) => s.key === "prognosis")!.paragraphs[0];
  assert.equal(p.origin, "clinician");
  assert.deepEqual(p.sourceIds, []);
  assert.deepEqual(run(typed).filter((f) => f.paragraphId === "f14"), []);

  // Even kept as an edit (a light change to the drafted words), the rename is offered on drafted wording only.
  const asEdit: Report = { ...drafted, sections: drafted.sections.map((s) => (s.key === "prognosis" ? { ...s, paragraphs: [{ ...s.paragraphs[0], text: "In my opinion she told me her pain was worse with bending.", origin: "edited" as const, originalText: DRAFT_F14 }] } : s)) };
  const flag = run(asEdit).find((f) => f.code === "OTHER_CLINICIAN_VOICE" && f.paragraphId === "f14");
  assert.ok(flag);
  assert.equal(nameClinicianFix(asEdit, flag), null, "never on text the clinician typed");
});

test("B2-1: “in Tom Ellis's opinion” and “I expect these to ease” are opinion wording, checked against the cited note", () => {
  const tom = normaliseForMatch(testBundle().notes[1].assessment ?? ""); // "in my opinion he is fit for a phased return…"
  const sarah = normaliseForMatch(testBundle().notes[0].assessment ?? ""); // no opinion recorded
  assert.deepEqual(findUnsupportedOpinionPhrases("In Tom Ellis's opinion she has moderate restrictions.", sarah).map((m) => m.label), ["opinion"]);
  assert.deepEqual(findUnsupportedOpinionPhrases("In Tom Ellis's opinion he was fit for a phased return to normal duties over 2 weeks.", tom), [], "his note records an opinion");
  assert.deepEqual(findUnsupportedOpinionPhrases("I expect these to ease steadily as her pain settles.", sarah).map((m) => m.label), ["prediction"]);
  assert.deepEqual(findUnsupportedOpinionPhrases("He expects it to settle.", normaliseForMatch("I expect it to settle within weeks.")), [], "the note records the same expectation");
  // On drafted text it blocks and cannot be acknowledged.
  const report = signedBySarah("prognosis", [para("On 18/03/2026 Sarah Reid recorded that in Tom Ellis's opinion she will be fine. I expect these to ease.", ["N-001"], { id: "o1" })]);
  const flags = run(report).filter((f) => f.code === "OPINION_LANGUAGE" && f.paragraphId === "o1");
  assert.ok(flags.length >= 2);
  assert.ok(flags.every((f) => !canAcknowledge(f, report)));
});

test("B2-1: an edited paragraph acknowledged as the clinician's own account counts as the clinician's in the summary", async () => {
  const { questionStatus } = await import("../../ui/components/review/review-model");
  const report = signedBySarah("prognosis", [para("I saw him on 06/05/2026 and he told me the pain was 2/10.", ["N-002"], { id: "a1", origin: "edited", originalText: "x" })]);
  const flag = run(report).find((f) => f.code === "OTHER_CLINICIAN_VOICE" && f.paragraphId === "a1");
  assert.ok(flag && canAcknowledge(flag, report));
  const section = report.sections.find((s) => s.key === "prognosis")!;
  const q = { section, field: null };
  assert.equal(questionStatus(q, [flag], [], true), "blocked", "not yet acknowledged");
  assert.equal(questionStatus(q, [{ ...flag, acknowledged: { reason: "I treated him that day too.", at: "2026-10-25T10:00:00.000Z" } }], [], true), "clinician");
});

/* B2-2 ----------------------------------------------------------------------------------------------------------------- */

test("B2-2: another clinician's recorded diagnosis printed without their name blocks, with a one-click “Name …” (JJ IA F-10)", async () => {
  const text = "Grade I–II sprain of the right medial collateral ligament, with possible irritation of the medial meniscus";
  const report = signedBySarah("presenting_complaints", [para(text, ["N-002"], { id: "d1", basis: "clinician_opinion_recorded" })]);
  const flag = run(report).find((f) => f.code === "OTHER_CLINICIAN_VOICE" && f.paragraphId === "d1");
  assert.ok(flag, "it read as the signer's own diagnosis");
  assert.equal(flag.severity, "blocking");
  assert.equal(flag.evidence, "unattributed Tom Ellis");
  assert.equal(canAcknowledge(flag, report), false, "drafted wording: name the clinician or rewrite it");
  assert.match(flag.message, /^This answer gives the opinion Tom Ellis recorded, without naming Tom Ellis\./);
  const { nameClinicianFix, nameCliniciansInstead } = await import("../../ui/components/review/review-model");
  const fix = nameClinicianFix(report, flag);
  assert.equal(fix?.label, "Name Tom Ellis");
  assert.equal(fix?.text, "Tom Ellis's assessment (06/05/2026): grade I–II sprain of the right medial collateral ligament, with possible irritation of the medial meniscus");
  // On a prognosis question it is the clinician's opinion.
  const prognosis = signedBySarah("prognosis", [para("Should settle with exercise", ["N-002"], { id: "d5", basis: "clinician_opinion_recorded" })]);
  const pf = run(prognosis).find((f) => f.code === "OTHER_CLINICIAN_VOICE" && f.paragraphId === "d5");
  assert.equal(pf && nameClinicianFix(prognosis, pf)?.text, "Tom Ellis's opinion (06/05/2026): should settle with exercise");
  const named = nameCliniciansInstead({ ...report, flags: [flag] }, [flag], "Sarah Reid");
  assert.deepEqual(run(named).filter((f) => f.code === "OTHER_CLINICIAN_VOICE" || f.code === "FIGURE_NOT_IN_SOURCE"), [], "named, with the note's own date: nothing to check");
  // Not flagged: the signer's own note, the clinician named, a finding (not an opinion), or a structured answer's supporting text.
  for (const [p, extra] of [
    [para(text, ["N-001"], { id: "d2", basis: "clinician_opinion_recorded" }), {}],
    [para(`Tom Ellis's assessment: ${text}`, ["N-002"], { id: "d3", basis: "clinician_opinion_recorded" }), {}],
    [para("Lumbar AROM full and pain-free.", ["N-002"], { id: "d4", basis: "clinician_observed" }), {}],
  ] as const) {
    assert.deepEqual(run({ ...signedBySarah("presenting_complaints", [p]), ...extra }).filter((f) => f.code === "OTHER_CLINICIAN_VOICE"), [], p.text);
  }
});

test("B2-2: the drafting prompt keeps a short attribution for another clinician's recorded opinion in a compact place", async () => {
  const { FORM_DRAFT_SYSTEM_PROMPT, FORM_DRAFT_PROMPT_VERSION } = await import("../../ai/form-prompts");
  assert.equal(FORM_DRAFT_PROMPT_VERSION, "forms-10");
  assert.match(FORM_DRAFT_SYSTEM_PROMPT, /except an opinion, assessment or diagnosis that another clinician recorded \(not the author who signs\), which keeps a short attribution even there: "Priya Shah's assessment \(01\/09\/2026\): /);
});

/* B2-3 ----------------------------------------------------------------------------------------------------------------- */

test("B2-3: “Tom Ellis … saw Mr Ellery on 05/08/2026 while covering my annual leave” – acknowledgeable on drafted text, or “Use my name”", async () => {
  const text = "Mr Testcase attended 2 appointments, with none missed and 1 cancelled with notice. Tom Ellis, physiotherapist, saw Mr Testcase on 06/05/2026 while covering my annual leave.";
  const report = signedBySarah("prognosis", [para(text, ["N-002"], { id: "c1" })]);
  const flag = run(report).find((f) => f.code === "OTHER_CLINICIAN_VOICE" && f.paragraphId === "c1");
  assert.ok(flag);
  assert.equal(flag.evidence, "named Tom Ellis");
  assert.equal(canAcknowledge(flag, report), true, "the signer's own account beside a colleague's – it was “Go to F-35” only");
  assert.match(flag.message, /Use your name instead of “I” or “my”/);
  const { nameClinicianFix, nameCliniciansInstead } = await import("../../ui/components/review/review-model");
  const fix = nameClinicianFix(report, flag);
  assert.equal(fix?.label, "Use my name (Sarah Reid)");
  assert.equal(fix?.text, text.replace("my annual leave", "Sarah Reid's annual leave"));
  assert.deepEqual(run(nameCliniciansInstead({ ...report, flags: [flag] }, [flag], "Sarah Reid")).filter((f) => f.code === "OTHER_CLINICIAN_VOICE"), []);
  // An opinion in that "I" stays blocking on drafted text: whose opinion it is needs a rewrite.
  const opinion = signedBySarah("prognosis", [para("Tom Ellis saw Mr Testcase on 06/05/2026. In my opinion he will recover.", ["N-002"], { id: "c2" })]);
  const f2 = run(opinion).find((f) => f.code === "OTHER_CLINICIAN_VOICE" && f.paragraphId === "c2");
  assert.ok(f2);
  assert.equal(canAcknowledge(f2, opinion), false);
  // The prompt asks for the signer's name in a paragraph that names another clinician.
  const { FORM_DRAFT_SYSTEM_PROMPT } = await import("../../ai/form-prompts");
  assert.match(FORM_DRAFT_SYSTEM_PROMPT, /In a paragraph that names another clinician, refer to the author by name too, never "I" or "my"/);
});

/* B2-11 ---------------------------------------------------------------------------------------------------------------- */

test("B2-11: “before going back to normal duties” is the narrated return the note records – plans and modals still flag", () => {
  const note = normaliseForMatch("Took 3 days off work, then back on normal duties at the warehouse.");
  for (const ok of ["He took 3 days off work before going back to normal duties.", "He took 3 days off work before getting back to normal duties.", "He took 3 days off work before returning to normal duties."]) {
    assert.deepEqual(findUnsupportedOpinionPhrases(ok, note), [], ok);
  }
  for (const flagged of ["He is going back to normal duties next week.", "He took 3 days off work before going back to normal duties from Monday.", "He should rest before going back to normal duties."]) {
    assert.ok(findUnsupportedOpinionPhrases(flagged, note).length > 0, flagged);
  }
  assert.ok(findUnsupportedOpinionPhrases("He took 3 days off work before going back to normal duties.", normaliseForMatch("Took 3 days off work.")).length > 0, "the note must record the return");
});

/* B2-17 ---------------------------------------------------------------------------------------------------------------- */

test("B2-17: “No restrictions on duties or hours were recorded in her notes.” is not an opinion (it is commentary, flagged for removal)", () => {
  const report = signedBySarah("prognosis", [para("She works 12-hour shifts. No restrictions on duties or hours were recorded in her notes.", ["N-001"], { id: "n1" })]);
  assert.deepEqual(run(report).filter((f) => f.code === "OPINION_LANGUAGE" && f.paragraphId === "n1"), [], "it was “fitness for work”, not acknowledgeable");
});
