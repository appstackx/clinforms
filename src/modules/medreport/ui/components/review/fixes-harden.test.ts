/**
 * bh2 WD harden round (check2-WD): the one-click engine never removes a different finding as a "repeat" (N1), never
 * leaves a sentence leaning on what it removed (N6), never trusts the report's author as the voice owner (N5), and a
 * value shortened for one approver is flagged once another approves (C-REV-1). Fictional data only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SOLICITOR_RTA_TEMPLATE } from "../../../templates/registry";
import { namedActor } from "../../../core/actor";
import { computeFacts } from "../../../core/computed-facts";
import { formToTemplate } from "../../../core/forms";
import { createFormReport } from "../../../core/report-factory";
import type { FormDefinition, FormField, Paragraph, Report, ReportTemplate } from "../../../core/types";
import { validateReport } from "../../../core/validation";
import { removableRepeat, sameFinding, sentencesRepeat } from "../../../core/validation/draft-fit/repeats";
import { TEST_FACTS_DATE, testBundle, testReport, withSection } from "../../../core/validation/test-fixtures";
import { answersQuestion, applyFixProposal, offeredFixes, questionTopicKnown, undoProposal } from "./fixes";

const SOL = SOLICITOR_RTA_TEMPLATE;
const AT = "2026-10-06T09:00:00.000Z";
const sarah = namedActor("Sarah Reid", "clinician", { memberId: "mem_sarah", canSign: true, hcpc: "PH-DEMO-01" });
const tom = namedActor("Tom Ellis", "clinician", { memberId: "mem_tom", canSign: true, hcpc: "PH-DEMO-02" });
let n = 0;
const ai = (text: string, sourceIds = ["N-001"]): Paragraph => ({ id: `fh-p${++n}`, text, sourceIds, origin: "ai", basis: "clinician_observed", originalText: text });

function builtIn(boxes: Record<string, string[]>): Report {
  let r: Report = { ...testReport(SOL), approver: { memberId: "mem_sarah", name: "Sarah Reid", hcpc: "PH-DEMO-01" } };
  for (const [key, texts] of Object.entries(boxes)) r = withSection(r, key, texts.map((t) => ai(t)));
  return { ...r, flags: validateReport(r, SOL).flags };
}
const removals = (r: Report, template: ReportTemplate = SOL, form: FormDefinition | null = null) =>
  offeredFixes(r, { actor: sarah, template, form }).filter((f) => f.generator === "repeat-removal");
const repeatFlag = (r: Report, key: string) => r.flags.some((f) => f.sectionKey === key && (f.evidence ?? "").startsWith("repeat"));

/* ------------------------------------------------------------------------------------------------
 * N1 – a different finding is never a repeat, and never removed
 * ----------------------------------------------------------------------------------------------*/

const names = new Set(["testcase", "sarah", "reid", "tom", "ellis"]);
const contrary: Array<[string, string, string]> = [
  ["negation", "On examination lumbar flexion was not painful at the end of range on either side.", "On examination lumbar flexion was painful at the end of range on either side."],
  ["side", "Mr Testcase reported pain in the left knee when climbing stairs and kneeling.", "Mr Testcase reported pain in the right knee when climbing stairs and kneeling."],
  ["side written short", "Mr Testcase reported pain in the L knee when climbing stairs and kneeling.", "Mr Testcase reported pain in the R knee when climbing stairs and kneeling."],
  ["pattern", "Mr Testcase reported constant central lower back pain that was worse after his shifts.", "Mr Testcase reported occasional central lower back pain that was worse after his shifts."],
  ["direction", "Mr Testcase reported that his sleep was better since the last session and the pain eased.", "Mr Testcase reported that his sleep was worse since the last session and the pain eased."],
  ["time words", "At the first assessment, lumbar flexion was limited by 50% with pain at the end of range.", "At discharge, lumbar flexion was still limited by 50% with pain at the end of range."],
  ["date against a time word", "On 18/03/2026 Sarah Reid, physiotherapist, recorded lumbar flexion limited by 50% with pain at the end of range.", "At discharge lumbar flexion was still limited by 50% with pain at the end of range."],
  ["count", "Mr Testcase reported that he completed two sessions of the home programme every day.", "Mr Testcase reported that he completed three sessions of the home programme every day."],
];
for (const [kind, a, b] of contrary) {
  test(`harden N1: a contrary pair is no repeat (${kind}) – no warning, no removal`, () => {
    assert.equal(sentencesRepeat(a, b, names), false);
    assert.equal(removableRepeat(b, a, names), false);
  });
}

test("harden N1: a spinal level is not a side ('L4/5' / 'L4/5')", () => {
  const a = "Mr Testcase was tender over the paraspinal muscles at L4/5 on palpation.";
  assert.equal(sameFinding(a, a, "removal"), true);
  assert.equal(removableRepeat(a, a, names), true);
  const today = "Mr Testcase was tender over the paraspinal muscles at L4/5 on palpation today.";
  assert.equal(sentencesRepeat(a, today, names), true, "advice: a sentence silent on the time is not contrary…");
  assert.equal(removableRepeat(a, today, names), false, "…but a removal needs the same time points");
  assert.equal(sameFinding(a, "Mr Testcase was tender over the left paraspinal muscles at L4/5 on palpation.", "advice"), true, "advice: silent on the side");
  assert.equal(sameFinding(a, "Mr Testcase was tender over the left paraspinal muscles at L4/5 on palpation.", "removal"), false, "removal: “left” in one only");
});

test("harden N1: the advisory warning stays for a sentence silent on the time point; the removal needs the same markers", () => {
  const a = "She recorded a Numeric Pain Rating Scale score of 1/10 and a Patient-Specific Functional Scale score of 8.0 at discharge.";
  const b = "She recorded a Numeric Pain Rating Scale score of 1/10 and a Patient-Specific Functional Scale score of 8.0.";
  assert.equal(sentencesRepeat(a, b, names), true, "advice: a repeat");
  assert.equal(removableRepeat(b, a, names), false, "removal: “at discharge” in one only");
  assert.equal(removableRepeat(b, b, names), true, "control: the same sentence");
});

test("harden N1: the one-click never removes the discharge state, the other knee, a qualifier or the opposite finding", () => {
  const cases: Array<[string, string]> = [
    ["On examination lumbar flexion was not painful at the end of range on either side.", "On examination lumbar flexion was painful at the end of range on either side."],
    ["Mr Testcase reported pain in the left knee when climbing stairs and kneeling.", "Mr Testcase reported pain in the right knee when climbing stairs and kneeling."],
    ["Mr Testcase reported constant central lower back pain that was worse after his shifts.", "Mr Testcase reported occasional central lower back pain that was worse after his shifts."],
    ["At the first assessment, lumbar flexion was limited by 50% with pain at the end of range.", "At discharge, lumbar flexion was still limited by 50% with pain at the end of range."],
    ["Lumbar flexion was limited by 50% with pain at the end of range.", "Lumbar flexion was still limited by 50% with pain at the end of range."],
    ["Mr Testcase described pain across the lower back after lifting a box at work.", "Mr Testcase described sharp pain across the lower back after lifting a box at work."],
  ];
  for (const [earlier, later] of cases) {
    const r = builtIn({ examination_findings: [earlier], progress_current_status: [`${later} He was discharged to self-management.`] });
    assert.deepEqual(removals(r), [], later);
  }
  // Control: the same sentence word for word is still removed (REP-remove-pass-01).
  const same = builtIn({
    examination_findings: ["Mr Testcase described pain across the lower back after lifting a box at work."],
    progress_current_status: ["Mr Testcase described pain across the lower back after lifting a box at work. He was sleeping poorly."],
  });
  assert.equal(removals(same)[0]?.after, "He was sleeping poorly.");
});

test("harden minor 4: the repeat warning is not raised for a contrary pair", () => {
  const r = builtIn({
    presenting_complaints: ["Mr Testcase reported pain in the left knee when climbing stairs and kneeling."],
    progress_current_status: ["Mr Testcase reported pain in the right knee when climbing stairs and kneeling. He was discharged to self-management."],
  });
  assert.equal(repeatFlag(r, "progress_current_status"), false);
});

/* ------------------------------------------------------------------------------------------------
 * N6 – no sentence left leaning on what was removed; the answering sentence known on the trial forms' labels
 * ----------------------------------------------------------------------------------------------*/

test("harden N6: a removal never leaves a bare job title, a name without its date, 'This …' or a connective", () => {
  const lead = "On 06/05/2026 Tom Ellis, physiotherapist, recorded that the lower back pain was improving.";
  const after = [
    "At that review the physiotherapist also recorded that he had returned to work on amended duties.",
    "At that review Mr Ellis also recorded that he had returned to work on amended duties.",
    "The physiotherapist also recorded that he had returned to work on amended duties.",
    "Mr Ellis also recorded that he had returned to work on amended duties.",
    "Tom Ellis recorded that he had returned to work on amended duties.",
    "On the same day he had returned to work on amended duties.",
    "This had improved further by the time he returned to work on amended duties.",
    "However, he had returned to work on amended duties.",
    "He said this had settled once he returned to work on amended duties.",
  ];
  for (const second of after) {
    const r = builtIn({ examination_findings: [lead], progress_current_status: [`${lead} ${second}`] });
    assert.deepEqual(removals(r), [], second);
  }
  // Control: a sentence that names its own clinician and date may follow.
  const ok = builtIn({ examination_findings: [lead], progress_current_status: [`${lead} On 06/05/2026 Tom Ellis recorded that he had returned to work on amended duties.`] });
  assert.equal(removals(ok).length, 1);
});

test("harden N6: the answering sentence is recognised on common labels", () => {
  const pairs: Array<[string, string]> = [
    ["He was given a home programme of pelvic tilts.", "What has been done so far?"],
    ["Lumbar flexion was limited by 50% with pain at the end of range.", "What did you find?"],
    ["Mr Testcase reported pain in the left knee when climbing stairs.", "How does the claimant feel?"],
    ["He was given a home programme of pelvic tilts.", "Intervention to date"],
    ["The presentation was consistent with a mechanical low back strain.", "Diagnosis"],
    ["No saddle numbness and bladder and bowel were normal.", "Red flag screening"],
    ["He attended 4 sessions between 18/03/2026 and 06/05/2026.", "Appointment dates"],
    ["He was expected to recover fully within 6 weeks.", "Prognosis"],
    ["He was on amended duties with no heavy lifting.", "Recommended adjustments"],
  ];
  for (const [s, q] of pairs) assert.ok(answersQuestion(s, q), `${q}: ${s}`);
  assert.equal(questionTopicKnown("Any other comments"), false);
  assert.equal(questionTopicKnown("If so, the details"), false);
  assert.equal(questionTopicKnown("Objective findings"), true);
});

function commentsForm(): FormDefinition {
  const field = (id: string, label: string): FormField => ({ id, label, guidance: "", answerType: "long_text", anchor: { kind: "docx", target: "after_paragraph", blockId: `p${id.slice(2)}` }, fillSource: { kind: "notes_narrative" }, required: false, confidence: "high" });
  return {
    id: "frm_fh",
    tenantId: "demo",
    referrer: { name: "Example Case Services (fictional)", type: "mlc" },
    title: "Treatment Summary Report",
    file: { fileName: "fh.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: "d".repeat(64), sizeBytes: 1 },
    kind: "docx",
    fields: [field("F-01", "Objective findings"), field("F-02", "Any other comments")],
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "t", at: AT, warnings: [] },
    confirmed: { by: "Test", at: AT },
    createdAt: AT,
    updatedAt: AT,
  };
}
function formReport(f: FormDefinition, answers: Record<string, Paragraph[]>, approver: Report["approver"] = { memberId: "mem_sarah", name: "Sarah Reid", hcpc: "PH-DEMO-01" }, author = { name: "Sarah Reid", hcpc: "PH-DEMO-01" }): Report {
  const bundle = testBundle();
  const base = createFormReport({ form: f, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle, { asOf: TEST_FACTS_DATE }), id: "rpt_fh", now: new Date(AT), author, ...(approver ? { approver } : {}) });
  const r = { ...base, sections: base.sections.map((s) => (answers[s.key] ? { ...s, paragraphs: answers[s.key] } : s)) };
  return { ...r, flags: validateReport(r, formToTemplate(f), { form: f }).flags };
}

test("harden N6: in a box whose topic the engine cannot tell ('Any other comments'), no sentence is removed", () => {
  const f = commentsForm();
  const r = formReport(f, {
    "F-01": [ai("Lumbar flexion was limited by 50% with pain at the end of range.")],
    "F-02": [ai("Lumbar flexion was limited by 50% with pain at the end of range. He was discharged to self-management.")],
  });
  assert.ok(repeatFlag(r, "F-02"), "the advice stays");
  assert.deepEqual(removals(r, formToTemplate(f), f), []);
});

/* ------------------------------------------------------------------------------------------------
 * N5 – the approver only; a shortened colleague's value is flagged when the approver changes
 * ----------------------------------------------------------------------------------------------*/

function cellForm(): FormDefinition {
  return {
    ...commentsForm(),
    id: "frm_fh_cell",
    fields: [{ id: "F-12", label: "Pain now (0-10)", guidance: "", answerType: "short_text", anchor: { kind: "docx", target: "table_cell", blockId: "t0.r12.c1" }, fillSource: { kind: "notes_narrative" }, required: false, confidence: "high" }],
  };
}

test("harden N5: with no approver, 'Use the value only' is never offered – not on the author's say-so", () => {
  const f = cellForm();
  const noApprover = formReport(f, { "F-12": [ai("2/10 at worst, as recorded by Tom Ellis.", ["N-002"])] }, undefined, { name: "Tom Ellis", hcpc: "PH-DEMO-02" });
  for (const actor of [sarah, tom]) assert.deepEqual(offeredFixes(noApprover, { actor, template: formToTemplate(f), form: f }).filter((x) => x.generator === "value-only"), []);
  // Control: Tom as the approver, his own note – offered.
  const own = formReport(f, { "F-12": [ai("2/10 at worst, as recorded by Tom Ellis.", ["N-002"])] }, { memberId: "mem_tom", name: "Tom Ellis", hcpc: "PH-DEMO-02" }, { name: "Tom Ellis", hcpc: "PH-DEMO-02" });
  assert.equal(offeredFixes(own, { actor: tom, template: formToTemplate(f), form: f }).find((x) => x.generator === "value-only")?.after, "2/10 at worst");
});

test("harden N5: a value shortened for one approver blocks once another approves (the colleague's name is gone)", () => {
  const f = cellForm();
  const t = formToTemplate(f);
  const own = formReport(f, { "F-12": [ai("2/10 at worst, as recorded by Tom Ellis.", ["N-002"])] }, { memberId: "mem_tom", name: "Tom Ellis", hcpc: "PH-DEMO-02" }, { name: "Tom Ellis", hcpc: "PH-DEMO-02" });
  const fix = offeredFixes(own, { actor: tom, template: t, form: f }).find((x) => x.generator === "value-only");
  assert.ok(fix);
  const shortened = applyFixProposal(own, fix, tom, new Date(AT));
  const flagOf = (r: Report) => validateReport(r, t, { form: f }).flags.find((x) => x.evidence === "value-only attribution");
  assert.equal(flagOf(shortened), undefined, "Tom approves his own note's value: no flag");
  const sarahApproves: Report = { ...shortened, approver: { memberId: "mem_sarah", name: "Sarah Reid", hcpc: "PH-DEMO-01" } };
  // The review screen validates with no explicit voice owner: the approver decides (the author stays Tom).
  assert.ok(validateReport(sarahApproves, t, { form: f }).flags.find((x) => x.evidence === "value-only attribution"), "flagged on the review screen too");
  const flag = validateReport(sarahApproves, t, { form: f, voice: { owner: { name: "Sarah Reid", hcpc: "PH-DEMO-01" } } }).flags.find((x) => x.evidence === "value-only attribution");
  assert.ok(flag, "Sarah approves: Tom's finding no longer names him");
  assert.equal(flag.severity, "blocking");
  assert.equal(flag.ackPolicy, "approver");
  assert.match(flag.message, /Tom Ellis's note of 06\/05\/2026, not Sarah Reid's own/);
  // Undone: the attribution is back, no flag.
  const undone = applyFixProposal(sarahApproves, undoProposal(fix, own), sarah, new Date(AT));
  assert.equal(validateReport(undone, t, { form: f, voice: { owner: { name: "Sarah Reid", hcpc: "PH-DEMO-01" } } }).flags.find((x) => x.evidence === "value-only attribution"), undefined);
});

test("harden N6: a treatment sentence in other words still answers 'Treatment provided'", () => {
  for (const s of ["Core bracing was taught.", "He was shown a graded walking programme.", "Loading was progressed weekly."]) assert.ok(answersQuestion(s, "Treatment provided"), s);
});

test("harden N6: 'Back then …' leans on the sentence before it; a heat pack answers 'Treatment provided'", () => {
  const r = builtIn({
    examination_findings: ["Lumbar flexion was limited by 50% with pain at the end of range."],
    progress_current_status: ["Lumbar flexion was limited by 50% with pain at the end of range. Back then he was off work."],
  });
  assert.deepEqual(removals(r), []);
  assert.ok(answersQuestion("He used a heat pack each evening.", "Treatment provided"));
});
