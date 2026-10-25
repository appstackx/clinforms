/**
 * DRAFT_FIT, fix round 2: a bare value from an earlier note on a discharge form (B1-6); compact places inside table cells,
 * guidance that asks for more than the value and the lower case of a value inside a printed sentence (B1-12);
 * commentary about the notes and an ungrammatical attendance sentence (B1-13). Fictional record (test fixtures:
 * N-001 18/03/2026, N-002 06/05/2026).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFacts } from "../computed-facts";
import { buildFormAnswers, formToTemplate } from "../forms";
import type { FormDefinition, FormField, Report, ReportFlag, ReportSection } from "../types";
import { runValidators } from "./index";
import { TEST_FACTS_DATE, testBundle, testReport } from "./test-fixtures";

const f = (id: string, label: string, anchor: Record<string, unknown>, rest: Partial<FormField> = {}): FormField =>
  ({ id, label, guidance: "", answerType: "short_text", anchor: { kind: "docx", ...anchor }, fillSource: { kind: "notes_narrative" }, required: false, confidence: "high", ...rest }) as FormField;

function formOf(title: string, fields: FormField[]): FormDefinition {
  return {
    id: "frm_fit",
    tenantId: "demo",
    title,
    referrer: { name: "Ascenti", type: "mlc" },
    kind: "docx",
    file: { fileName: "f.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: "c".repeat(64), sizeBytes: 1 },
    fields,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "t", at: "2026-10-25T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-25T09:00:00.000Z",
    updatedAt: "2026-10-25T09:00:00.000Z",
  } as FormDefinition;
}

/** DRAFT_FIT flags for drafted answers `texts` (key → [text, cited note]) on `form`. */
function fit(form: FormDefinition, texts: Record<string, [string, string]>): ReportFlag[] {
  const bundle = testBundle();
  const sections: ReportSection[] = form.fields.map((x) => ({
    key: x.id,
    title: x.label,
    kind: "ai_narrative",
    status: "drafted",
    fieldId: x.id,
    paragraphs: texts[x.id] ? [{ id: `${x.id}-p1`, text: texts[x.id][0], sourceIds: [texts[x.id][1]], origin: "ai" }] : [],
  }));
  const template = formToTemplate(form);
  const base = testReport(template, bundle);
  const report = { ...base, form: { formId: form.id, title: form.title, referrer: form.referrer, fileSha256: form.file.sha256, kind: "docx" }, sections } as unknown as Report;
  return runValidators({ report, bundle, template, computedFacts: computeFacts(bundle, { asOf: TEST_FACTS_DATE }), form }).filter((x) => x.code === "DRAFT_FIT");
}

test("B1-6: on a discharge form, a bare value from an earlier note is checked against the latest note", () => {
  const fields = [f("F-48", "Pain VAS (out of 10) now", { target: "replace_placeholder", blockId: "t5.r1.c0", placeholderText: "/10" }), f("F-49", "Overall improvement (%)", { target: "replace_placeholder", blockId: "t5.r1.c0", placeholderText: "%" })];
  const discharge = formOf("ML End of Treatment Report", fields);
  const earlier = fit(discharge, { "F-48": ["1/10", "N-002"], "F-49": ["60%", "N-001"] });
  assert.deepEqual(earlier.map((x) => [x.sectionKey, x.severity, x.message]), [
    ["F-49", "warning", "From an earlier note (18/03/2026) – check it is still right at discharge: the latest note is of 06/05/2026."],
  ]);
  // The latest note, or an initial assessment form: nothing to check.
  assert.deepEqual(fit(discharge, { "F-49": ["60%", "N-002"] }).filter((x) => (x.evidence ?? "").startsWith("earlier")), []);
  assert.deepEqual(fit(formOf("Initial Assessment Report", fields), { "F-49": ["60%", "N-001"] }).filter((x) => (x.evidence ?? "").startsWith("earlier")), []);
});

test("B1-6: the drafting call is told a bare value on a discharge form is the position at discharge", async () => {
  const { buildFormBlock } = await import("../../ai/form-prompts");
  const form = formOf("ML End of Treatment Report", [f("F-49", "Overall improvement (%)", { target: "replace_placeholder", blockId: "t5.r1.c0", placeholderText: "%" })]);
  assert.match(buildFormBlock(form, formToTemplate(form)), /It states the position at discharge: give the value from the latest note that records it; if only an earlier note records it, leave it empty and raise a gap/);
});

test("B1-12: an answer on a new line inside a shared table cell is a cell; guidance asking for more than the value or for dates is respected", () => {
  const long = "On 01/09/2026 Priya Shah, physiotherapist, recorded that Mr Testcase reported pain and stiffness on the inner side of his right knee after twisting it at five-a-side football.";
  // JJ Physio IA: "Presenting problem 1" written after the label, beside "Expected outcome 1 – to return to".
  const jj = formOf("Physiotherapy Assessment Report", [
    f("F-19", "Presenting problem 1", { target: "after_paragraph", blockId: "t1.r1.c0.p0" }),
    f("F-20", "Expected outcome 1 – to return to", { target: "replace_placeholder", blockId: "t1.r1.c1", placeholderText: "…" }, { fillSource: { kind: "clinician_opinion" } }),
  ]);
  const cell = fit(jj, { "F-19": [long, "N-001"] }).filter((x) => x.evidence === "shorten");
  assert.equal(cell.length, 1);
  assert.match(cell[0].message, /^Shorten for the box: this answer goes in a table cell, so it should be the value alone/);
  // 10Bridge IA F-15: "the pain score … and the symptoms …, in one or two lines" – two lines are what it asks for.
  const tenBridge = formOf("Initial Assessment Report", [
    f("F-15", "Symptoms at the initial assessment – area 1: pain VAS and symptoms", { target: "table_cell", blockId: "t0.r2.c1" }, { guidance: "The pain score out of 10 and the symptoms for this area at the initial assessment, in one or two lines (written under the printed “Pain VAS:”)." }),
    f("F-21", "Pre-existing conditions", { target: "table_cell", blockId: "t2.r2.c0" }, { answerType: "long_text" }),
    f("F-22", "Pre-existing conditions – comments", { target: "table_cell", blockId: "t2.r2.c1" }, { answerType: "long_text" }),
    f("F-37", "Any time off sick", { target: "after_paragraph", blockId: "t5.r2.c0" }, { guidance: "Time off work because of the injury, as recorded (dates or “None”)." }),
  ]);
  assert.deepEqual(fit(tenBridge, { "F-15": ["Neck pain 6/10 at worst, with stiffness turning to the left and headaches 3 to 4 times a week", "N-001"] }).filter((x) => x.evidence === "shorten"), []);
  const dated = fit(tenBridge, { "F-15": ["On 18/03/2026 he reported neck pain 6/10 at worst.", "N-001"], "F-21": ["On 18/03/2026 Tom Ellis, physiotherapist, recorded in the past medical history a right knee arthroscopy in 2015.", "N-001"] }).filter((x) => x.evidence === "shorten");
  assert.deepEqual(dated.map((x) => x.sectionKey), ["F-15", "F-21"]);
  assert.ok(dated.every((x) => /^Shorten for the box: this answer goes in a narrow table cell – keep what the form asks for, without a date lead/.test(x.message)));
  // A long answer in a narrow cell without a date lead or attribution, and a full-width row: fine.
  assert.deepEqual(fit(tenBridge, { "F-21": ["Right knee arthroscopy in 2015. Mild asthma, well controlled, with no effect on his neck or his work as a delivery driver.", "N-001"], "F-37": ["Off work from 13/03/2026", "N-001"] }).filter((x) => x.evidence === "shorten"), []);
});

test("B1-12: a bare value filling a printed sentence's blank reads on in it – names, titles and acronyms keep their capitals", () => {
  const form = formOf("INITIAL ASSESSMENT REPORT", [
    f("F-17", "Treatment goals – activities to return to", { target: "replace_placeholder", blockId: "t7.r1.c0", placeholderText: "…" }),
    f("F-20", "Overall improvement (%)", { target: "replace_placeholder", blockId: "t5.r1.c0", placeholderText: "%" }),
  ]);
  const printed = (text: string, key = "F-17") =>
    buildFormAnswers({ sections: form.fields.map((x) => ({ key: x.id, title: x.label, kind: "ai_narrative" as const, status: "drafted" as const, fieldId: x.id, paragraphs: x.id === key ? [{ id: "p", text, sourceIds: ["N-001"], origin: "ai" as const }] : [] })) }, form)[key]?.text;
  assert.equal(printed("Walking the dog daily and gardening"), "walking the dog daily and gardening");
  assert.equal(printed("Football, the gym and pain-free driving"), "football, the gym and pain-free driving");
  for (const keep of ["MRI-guided rehabilitation", "Mr Testcase's usual gym routine", "Five Ways Gym classes", "Pilates twice a week"]) assert.equal(printed(keep), keep);
  assert.equal(printed("Sixty per cent", "F-20"), "Sixty per cent", "a blank that is not a printed sentence's dots");
});

test("B1-13: a trailing “no … recorded” is commentary about the notes; attendance reads as a whole sentence", async () => {
  const { expandNoteShorthand } = await import("../voice");
  const form = formOf("Initial Assessment Report", [f("F-18", "Symptoms at the initial assessment – area 2: pain VAS and symptoms", { target: "table_cell", blockId: "t0.r3.c1" }, { guidance: "The pain score out of 10 and the symptoms for this area, in one or two lines." })]);
  const comment = fit(form, { "F-18": ["Headaches 3–4 times a week; no pain score recorded for the headaches", "N-001"] }).filter((x) => x.evidence === "comment");
  assert.deepEqual(comment.map((x) => x.message), ["Remove the comment about the notes (“no pain score recorded for the headaches”): it would be printed on the form."]);
  assert.deepEqual(fit(form, { "F-18": ["Headaches 3–4 times a week; no pain score recorded", "N-001"] }).filter((x) => x.evidence === "shorten"), [], "its “recorded” is the comment's, not an attribution");
  // A finding is not commentary.
  assert.deepEqual(fit(form, { "F-18": ["No headaches recorded at the assessment, and neck pain 6/10", "N-001"] }).filter((x) => x.evidence === "comment"), []);
  // "attended 5 of 6 appointments, with 1 did not attend on 22/09/2026" (the portal answer, approved and copied).
  assert.equal(expandNoteShorthand("Mrs Whitlock attended 5 of 6 appointments, with 1 did not attend on 22/09/2026."), "Mrs Whitlock attended 5 of 6 appointments, with 1 missed appointment on 22/09/2026.");
  assert.equal(expandNoteShorthand("6 of 7 appointments were attended, with 0 did not attend and 1 late cancellation."), "6 of 7 appointments were attended, with 0 missed appointments and 1 late cancellation.");
  const words = fit(form, { "F-18": ["Mrs Whitlock attended 5 of 6 appointments, with 1 did not attend on 22/09/2026.", "N-001"] }).filter((x) => x.evidence === "wording");
  assert.equal(words.length, 1, "left in an older draft: Check the wording");
  // The attendance fact carries a sentence to quote.
  const facts = computeFacts(testBundle(), { asOf: TEST_FACTS_DATE });
  assert.match(facts.find((x) => x.id === "FACT-attendance")?.detail ?? "", /In words: 2 of 3 appointments were attended; 1 was missed \(did not attend\) on 01\/04\/2026\.$/);
});
