/**
 * bh2 WD design 6: the one-click engine – every offered fix passes the engine's rules on a copy (I8, AC-DRF-1), and
 * applying one keeps the paragraph's origin, records the fix and can be undone. Exact cases: B3-2 ('8.0'),
 * R-regression-3 ('52.3 to 29.5 … 2.7 to 5.3'), B3-5 (fictional equivalents of a lost "He recorded", two repeat warnings
 * on one paragraph, and the box's only answering sentence). Fictional data only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SOLICITOR_RTA_TEMPLATE } from "../../../templates/registry";
import { namedActor } from "../../../core/actor";
import { computeFacts } from "../../../core/computed-facts";
import { formToTemplate } from "../../../core/forms";
import { createFormReport } from "../../../core/report-factory";
import { checkSafeEdit, figuresOf } from "../../../core/text/sentences";
import type { FormDefinition, FormField, Paragraph, Report, ReportTemplate } from "../../../core/types";
import { validateReport } from "../../../core/validation";
import { TEST_FACTS_DATE, testBundle, testReport, withSection } from "../../../core/validation/test-fixtures";
import { applyFixProposal, offeredFixes, undoProposal } from "./fixes";

const SOL = SOLICITOR_RTA_TEMPLATE;
const AT = "2026-10-06T09:00:00.000Z";
const sarah = namedActor("Sarah Reid", "clinician", { memberId: "mem_sarah", canSign: true, hcpc: "PH-DEMO-01" });
let n = 0;
const ai = (text: string, sourceIds = ["N-001"]): Paragraph => ({ id: `fx-p${++n}`, text, sourceIds, origin: "ai", basis: "clinician_observed", originalText: text });

/** A built-in report with these drafted boxes, its flags validated (the approver is Sarah Reid). */
function builtIn(boxes: Record<string, string[]>): Report {
  let r: Report = { ...testReport(SOL), approver: { memberId: "mem_sarah", name: "Sarah Reid", hcpc: "PH-DEMO-01" } };
  for (const [key, texts] of Object.entries(boxes)) r = withSection(r, key, texts.map((t) => ai(t)));
  return { ...r, flags: validateReport(r, SOL).flags };
}

function fixesOf(report: Report, template: ReportTemplate = SOL, form: FormDefinition | null = null) {
  return offeredFixes(report, { actor: sarah, template, form });
}

test("B3-2: the repeat inside '8.0, a mild ache' is flagged and no fix splits the number", () => {
  const r = builtIn({
    examination_findings: ["She recorded a Numeric Pain Rating Scale score of 1/10 and a Patient-Specific Functional Scale score of 8.0 at discharge."],
    progress_current_status: ["She recorded a Numeric Pain Rating Scale score of 1/10 and a Patient-Specific Functional Scale score of 8.0, a mild ache on the inner side of the knee after drills."],
  });
  assert.ok(r.flags.some((f) => f.sectionKey === "progress_current_status" && (f.evidence ?? "").startsWith("repeat")));
  assert.deepEqual(fixesOf(r).filter((f) => f.generator === "repeat-removal"), [], "the box's only sentence is never removed");
});

test("R-regression-3: no fix changes a figure ('52.3 to 29.5 … 2.7 to 5.3')", () => {
  const r = builtIn({
    examination_findings: ["Her Patient-Specific Functional Scale score was 2.7."],
    progress_current_status: ["Her QuickDASH improved from 52.3 to 29.5 and her Patient-Specific Functional Scale from 2.7 to 5.3 since 01/09/2026. She was back at work."],
  });
  for (const fix of fixesOf(r)) assert.deepEqual(figuresOf(fix.after), figuresOf(fix.before).filter((x) => fix.after.includes(x)), fix.label);
  for (const fix of fixesOf(r)) assert.ok(fix.after.includes("52.3 to 29.5"), "the scores are never cut");
});

test("B3-5 (a): removing a repeated lead never leaves 'He recorded …' without who and when", () => {
  const r = builtIn({
    examination_findings: ["On 06/05/2026 Tom Ellis, physiotherapist, recorded an assessment of lower back pain after lifting."],
    progress_current_status: ["On 06/05/2026 Tom Ellis, physiotherapist, recorded an assessment of lower back pain after lifting. He recorded an Oswestry Disability Index of 18% and pain of 2/10."],
  });
  assert.ok(r.flags.some((f) => f.sectionKey === "progress_current_status" && (f.evidence ?? "").startsWith("repeat")));
  assert.deepEqual(fixesOf(r).filter((f) => f.generator === "repeat-removal"), []);
});

test("B3-5 (b): two repeated sentences go in one action; the rest stays and the paragraph keeps origin 'ai'", () => {
  const r = builtIn({
    incident_history: ["Mr Testcase lifted a heavy parcel with a twist at work."],
    examination_findings: ["Mr Testcase described pain across the lower back after lifting a box at work."],
    progress_current_status: ["Mr Testcase lifted a heavy parcel with a twist at work. Mr Testcase described pain across the lower back after lifting a box at work. He was sleeping poorly."],
  });
  const fix = fixesOf(r).find((f) => f.generator === "repeat-removal");
  assert.ok(fix);
  assert.equal(fix.after, "He was sleeping poorly.");
  // The engine's orphan rule is about who RECORDED it ("He recorded …"); "He was sleeping poorly" is about the patient.
  assert.deepEqual(checkSafeEdit({ before: fix.before, after: fix.after, removedSpans: fix.removedSpans.map((s) => ({ ...s, text: fix.before.slice(s.start, s.end) })) }).filter((p) => p.kind !== "orphaned_pronoun"), []);
  const applied = applyFixProposal(r, fix, sarah, new Date(AT));
  const p = applied.sections.find((s) => s.key === "progress_current_status")!.paragraphs[0];
  assert.equal(p.text, "He was sleeping poorly.");
  assert.equal(p.origin, "ai", "the drafted-text checks keep running");
  assert.equal(p.fixes?.length, 1);
  assert.equal(p.fixes?.[0].kind, "repeat-removal");
  assert.equal(p.fixes?.[0].by.memberId, "mem_sarah");
  assert.ok(applied.activity.some((a) => /one-click fix/.test(a.detail)));
  // Undo puts it back while the paragraph still reads what the fix wrote.
  const undone = applyFixProposal(applied, undoProposal(fix), sarah, new Date(AT));
  assert.equal(undone.sections.find((s) => s.key === "progress_current_status")!.paragraphs[0].text, fix.before);
  // A stale proposal changes nothing; a signed report never changes.
  assert.equal(applyFixProposal(applied, fix, sarah), applied);
  const signed = { ...r, status: "signed" as const };
  assert.equal(applyFixProposal(signed, fix, sarah), signed);
  assert.deepEqual(fixesOf(signed), []);
});

test("B3-5 (c): the only sentence that answers the box's own question is never removed", () => {
  const r = builtIn({
    examination_findings: ["He was given a home programme of pelvic tilts as treatment."],
    treatment_provided: ["He was given a home programme of pelvic tilts as treatment. He was discharged to self-management."],
  });
  assert.ok(r.flags.some((f) => f.sectionKey === "treatment_provided" && (f.evidence ?? "").startsWith("repeat")));
  assert.deepEqual(fixesOf(r).filter((f) => f.generator === "repeat-removal"), []);
});

test("a wording fix never clears a blocking flag it does not answer (an unrecorded opinion beside a repeat stays blocked)", () => {
  const r = builtIn({
    examination_findings: ["Mr Testcase described pain across the lower back after lifting a box at work."],
    progress_current_status: ["He will recover fully within 6 weeks. Mr Testcase described pain across the lower back after lifting a box at work."],
  });
  for (const fix of fixesOf(r)) {
    const after = applyFixProposal(r, fix, sarah);
    assert.ok(validateReport(after, SOL).blocking.some((f) => f.sectionKey === "progress_current_status" && f.code === "OPINION_LANGUAGE"), fix.label);
  }
});

test("'(dose not stated)' is a deterministic one-click (B3-12)", () => {
  const r = builtIn({ presenting_complaints: ["He was taking ibuprofen."] });
  const fix = fixesOf(r).find((f) => f.generator === "dose-not-stated");
  assert.ok(fix);
  assert.equal(fix.after, "He was taking ibuprofen (dose not stated).");
});

function cellForm(fields: FormField[]): FormDefinition {
  return {
    id: "frm_fx",
    tenantId: "demo",
    referrer: { name: "Example Case Services (fictional)", type: "mlc" },
    title: "Treatment Summary Report",
    file: { fileName: "fx.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: "b".repeat(64), sizeBytes: 1 },
    kind: "docx",
    fields,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "t", at: AT, warnings: [] },
    confirmed: { by: "Test", at: AT },
    createdAt: AT,
    updatedAt: AT,
  };
}
const cell = (id: string, label: string, rest: Partial<FormField> = {}): FormField => ({ id, label, guidance: "", answerType: "short_text", anchor: { kind: "docx", target: "table_cell", blockId: `t0.r${id.slice(2)}.c1` }, fillSource: { kind: "notes_narrative" }, required: false, confidence: "high", ...rest });

function formWith(f: FormDefinition, answers: Record<string, Paragraph[]>): Report {
  const bundle = testBundle();
  const base = createFormReport({ form: f, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle, { asOf: TEST_FACTS_DATE }), id: "rpt_fx", now: new Date(AT), author: { name: "Sarah Reid", hcpc: "PH-DEMO-01" }, approver: { memberId: "mem_sarah", name: "Sarah Reid", hcpc: "PH-DEMO-01" } });
  const r = { ...base, sections: base.sections.map((s) => (answers[s.key] ? { ...s, paragraphs: answers[s.key] } : s)) };
  return { ...r, flags: validateReport(r, formToTemplate(f), { form: f }).flags };
}

test("value-only: offered for the approver's own note, hidden for a colleague's finding (C-REV-1), and the value keeps its figure", () => {
  const f = cellForm([cell("F-12", "Pain now (0-10)"), cell("F-14", "Lumbar flexion – now")]);
  const own = formWith(f, { "F-12": [ai("7/10 at worst, as recorded by Sarah Reid using the Numeric Pain Rating Scale.", ["N-001"])] });
  const fix = fixesOf(own, formToTemplate(f), f).find((x) => x.generator === "value-only");
  assert.ok(fix);
  assert.equal(fix.after, "7/10 at worst");
  const colleague = formWith(f, { "F-14": [ai("Full and pain-free, as recorded by Tom Ellis at discharge.", ["N-002"])] });
  assert.deepEqual(fixesOf(colleague, formToTemplate(f), f).filter((x) => x.generator === "value-only"), []);
});

test("the printed-lead fix takes the repeated verb out and answers its own block", () => {
  const f = cellForm([cell("F-27", "Next step – to return to", { guidance: "Completes the printed words “To return to”.", anchor: { kind: "docx", target: "replace_placeholder", blockId: "t0.r27.c1", placeholderText: "…" } })]);
  const r = formWith(f, { "F-27": [ai("returning to work as a delivery driver", ["N-002"])] });
  assert.ok(r.flags.some((x) => x.evidence === "printed lead" && x.severity === "blocking"));
  const fix = fixesOf(r, formToTemplate(f), f).find((x) => x.generator === "printed-lead");
  assert.ok(fix);
  assert.equal(fix.after, "work as a delivery driver");
  const after = applyFixProposal(r, fix, sarah);
  assert.ok(!validateReport(after, formToTemplate(f), { form: f }).flags.some((x) => x.evidence === "printed lead"));
});

test("I8 property: every fix offered on these drafts keeps the text-level rules (whole sentences, figures, starts)", () => {
  const drafts: Array<Record<string, string[]>> = [
    { examination_findings: ["Mr. Testcase reported approx. 3 weeks of pain, e.g. on stairs and kneeling."], progress_current_status: ["Mr. Testcase reported approx. 3 weeks of pain, e.g. on stairs and kneeling. He walks 2.5 km daily."] },
    { incident_history: ["Mr Testcase lifted a 20 kg parcel with a twist at work on 12/03/2026."], presenting_complaints: ["Mr Testcase lifted a 20 kg parcel with a twist at work on 12/03/2026. Pain was 7/10 at worst. He was taking paracetamol."] },
    { examination_findings: ["No red flags were reported at the assessment on 18/03/2026."], progress_current_status: ["No red flags were reported at the assessment on 18/03/2026. He was improving."] },
  ];
  for (const boxes of drafts) {
    const r = builtIn(boxes);
    for (const fix of fixesOf(r)) {
      const problems = checkSafeEdit({ before: fix.before, after: fix.after, removedSpans: fix.removedSpans.map((s) => ({ ...s, text: fix.before.slice(s.start, s.end) })) }).filter((p) => p.kind !== "orphaned_pronoun");
      assert.deepEqual(problems, [], `${fix.label}: ${fix.before} → ${fix.after}`);
      assert.doesNotMatch(fix.before.replace(fix.after, ""), /\bNo red flags\b/, "a clinical negative is never removed");
    }
  }
});
