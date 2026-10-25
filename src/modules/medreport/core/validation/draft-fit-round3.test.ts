/**
 * Blue Heart fix round 3 – drafted wording that would print badly:
 * - B2-6: the first-person rewrite keeps a verb and a subject, and the "Check the wording" net is wider (supporting text too);
 * - B2-7: the same sentence drafted into two or three boxes;
 * - B2-8: "To return to returning to work…";
 * - B2-14: "Shorten for the box" only for a date lead or an attribution, and long "one or two lines" answers;
 * - B2-16: "6/10 at worst (2/10 at rest), as recorded by Priya Shah…" in a "…/10" box;
 * - B2-17: "No frequency was recorded in that note." is commentary;
 * - B2-18: the patient named twice in one sentence.
 * Texts as drafted on Blue Heart's forms in the round-2 test run; fictional record (test fixtures).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFacts } from "../computed-facts";
import { formToTemplate } from "../forms";
import type { FormDefinition, FormField, Report, ReportFlag, ReportSection } from "../types";
import { inOwnClinicalWording, plainClinicalWording, pronounForRepeatedName } from "../voice";
import { printedLeadOf, repeatedDraftSentences, valueOnly, withoutPrintedVerb, yesNoInWords } from "./draft-fit";
import { runValidators } from "./index";
import { TEST_FACTS_DATE, testBundle, testReport } from "./test-fixtures";

const f = (id: string, label: string, anchor: Record<string, unknown>, rest: Partial<FormField> = {}): FormField =>
  ({ id, label, guidance: "", answerType: "short_text", anchor: { kind: "docx", ...anchor }, fillSource: { kind: "notes_narrative" }, required: false, confidence: "high", ...rest }) as FormField;

function formOf(title: string, fields: FormField[]): FormDefinition {
  return {
    id: "frm_fit3",
    tenantId: "demo",
    title,
    referrer: { name: "10Bridge", type: "mlc" },
    kind: "docx",
    file: { fileName: "f.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: "c".repeat(64), sizeBytes: 1 },
    fields,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "t", at: "2026-10-25T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-25T09:00:00.000Z",
    updatedAt: "2026-10-25T09:00:00.000Z",
  } as FormDefinition;
}

/** DRAFT_FIT flags for drafted answers `texts` (key → text, or [text, …more paragraphs]) on `form`, citing N-001. */
function fit(form: FormDefinition, texts: Record<string, string | string[]>, answers: Record<string, ReportSection["answer"]> = {}): ReportFlag[] {
  const bundle = testBundle();
  const sections: ReportSection[] = form.fields.map((x) => ({
    key: x.id,
    title: x.label,
    kind: "ai_narrative",
    status: "drafted",
    fieldId: x.id,
    paragraphs: ([] as string[]).concat(texts[x.id] ?? []).map((t, i) => ({ id: `${x.id}-p${i + 1}`, text: t, sourceIds: ["N-001"], origin: "ai" as const })),
    ...(answers[x.id] ? { answer: answers[x.id] } : {}),
  }));
  const template = formToTemplate(form);
  const report = { ...testReport(template, bundle), form: { formId: form.id, title: form.title, referrer: form.referrer, fileSha256: form.file.sha256, kind: "docx" }, sections } as unknown as Report;
  return runValidators({ report, bundle, template, computedFacts: computeFacts(bundle, { asOf: TEST_FACTS_DATE }), form }).filter((x) => x.code === "DRAFT_FIT");
}

const ofKey = (flags: ReportFlag[], key: string, evidence?: string) => flags.filter((x) => x.sectionKey === key && (evidence === undefined || (x.evidence ?? "").startsWith(evidence)));

/* B2-6 ------------------------------------------------------------------------------------------------------------------ */

test("B2-6: the first-person rewrite never leaves a verbless or subjectless sentence – the six inputs from the test run", () => {
  const cases: Array<[string, string]> = [
    // 10Bridge EOTS F-35.
    ["I recorded the whiplash-associated disorder grade II as now largely resolved after 7 sessions.", "The whiplash-associated disorder grade II was now largely resolved after 7 sessions."],
    ["On 16/09/2026 I recorded the whiplash-associated disorder grade II as now largely resolved.", "On 16/09/2026, the whiplash-associated disorder grade II was now largely resolved."],
    // Ascenti EOTS F-47 paragraph 2.
    ["I recorded full, pain-free cervical active range of movement, no tenderness and a normal neurological screen.", "I recorded full, pain-free cervical active range of movement, no tenderness and a normal neurological screen."],
    // Ascenti EOTS F-32 / F-33 supporting text.
    ["On 15/07/2026 I recorded gentle cervical mobilisations as part of the treatment plan.", "On 15/07/2026, I recorded gentle cervical mobilisations as part of the treatment plan."],
    // 10Bridge IA F-23: two dates – the clause keeps "I recorded that".
    ["On 15/07/2026 I recorded that Mr Ellery saw his GP on 07/07/2026, who advised paracetamol.", "On 15/07/2026, I recorded that Mr Ellery saw his GP on 07/07/2026, who advised paracetamol."],
  ];
  for (const [drafted, plain] of cases) {
    assert.equal(plainClinicalWording(drafted), plain, drafted);
    assert.equal(plainClinicalWording(plain), plain, `idempotent: ${plain}`);
  }
  // Physio-Link IA F-12 (Sarah Reid's own note, "She recorded that…, and noted…").
  assert.equal(
    inOwnClinicalWording("She recorded that the symptoms and examination findings were consistent with the mechanism Mr Ellery described, and noted mild travel anxiety when driving.", "Sarah Reid", { pronouns: true }),
    "The symptoms and examination findings were consistent with the mechanism Mr Ellery described, and I noted mild travel anxiety when driving.",
  );
});

test("B2-6: “Check the wording” catches the fragments that remain – a lower-case fragment after a date lead, “, and noted …”, “X as now …”", () => {
  const form = formOf("End of Treatment Report", [f("F-35", "Additional comments/findings", { target: "after_paragraph", blockId: "p40" }, { answerType: "long_text" }), f("F-33", "Treatment provided – Soft tissue", { target: "checkbox_glyph", blockId: "p41" }, { answerType: "checkbox" })]);
  const wording = (text: string, key = "F-35", answer?: ReportSection["answer"]) => ofKey(fit(form, { [key]: text }, answer ? { [key]: answer } : {}), key, "wording");
  assert.equal(wording("On 15/07/2026: gentle cervical mobilisations and soft tissue release.").length, 1);
  assert.equal(wording("The symptoms were consistent with the mechanism he described, and noted mild travel anxiety.").length, 1);
  assert.equal(wording("The whiplash-associated disorder grade II as now largely resolved.").length, 1);
  assert.equal(wording("On 15/07/2026: gentle mobilisations.", "F-33", { kind: "checkbox", value: true }).length, 1, "supporting text too");
  for (const ok of ["On 15/07/2026, I recorded gentle cervical mobilisations.", "On 15/07/2026: QuickDASH 29.5.", "She described the pain, and I noted mild travel anxiety.", "Sarah Reid recorded the disorder as now largely resolved."]) {
    assert.deepEqual(wording(ok), [], ok);
  }
});

/* B2-7 ------------------------------------------------------------------------------------------------------------------ */

test("B2-7: a sentence drafted into a second box is flagged – blocking beside it in its row, a warning elsewhere, with one click to remove it", async () => {
  const form = formOf("Initial Assessment Report", [
    f("F-11", "History of Injury:", { target: "after_paragraph", blockId: "p10" }, { answerType: "long_text" }),
    f("F-19", "Any other observations:", { target: "after_paragraph", blockId: "p20" }, { answerType: "long_text" }),
    f("F-21", "Pre-existing conditions", { target: "table_cell", blockId: "t2.r2.c0" }, { answerType: "long_text" }),
    f("F-22", "Pre-existing conditions – comments", { target: "table_cell", blockId: "t2.r2.c1" }, { answerType: "long_text" }),
  ]);
  const assessment = "On 08/09/2026 Tom Ellis recorded an assessment of acute non-specific (mechanical) low back pain following a moving and handling incident at work on 01/09/2026, with no nerve root signs and no red flags.";
  const flags = fit(form, {
    "F-11": ["Mrs Whitlock reported low back pain since 01/09/2026.", assessment],
    "F-19": ["She reported no saddle numbness.", assessment.replace("On 08/09/2026 Tom Ellis recorded an", "Tom Ellis's")],
    "F-21": "One episode of low back pain in 2019 that settled with 4 sessions of physiotherapy.",
    "F-22": "One episode of low back pain in 2019 that settled with 4 sessions of physiotherapy, with no problems since.",
  });
  const across = ofKey(flags, "F-19", "repeats");
  assert.equal(across.length, 1);
  assert.equal(across[0].severity, "warning");
  assert.equal(across[0].evidence, "repeats F-11");
  assert.match(across[0].message, /^This repeats what F-11 \(“History of Injury:”\) says: “Tom Ellis's assessment of acute/);
  const row = ofKey(flags, "F-22", "repeats");
  assert.equal(row[0]?.severity, "blocking", "the comments cell beside it");
  assert.match(row[0].message, /^This repeats F-21 \(“Pre-existing conditions”\) beside it/);
  // One click: the repeated sentence goes, the rest stays (edited, revertable).
  const { draftFitFix } = await import("../../ui/components/review/review-model");
  const sections = form.fields.map((x) => ({ key: x.id, title: x.label, paragraphs: [] as ReportSection["paragraphs"] }));
  const report = {
    sections: [
      { ...sections[0], paragraphs: [{ id: "F-11-p1", text: assessment, sourceIds: ["N-001"], origin: "ai" as const }] },
      { ...sections[1], paragraphs: [{ id: "F-19-p1", text: `She reported no saddle numbness. ${assessment}`, sourceIds: ["N-001"], origin: "ai" as const }] },
    ],
  } as unknown as Report;
  assert.deepEqual(draftFitFix(report, { code: "DRAFT_FIT", sectionKey: "F-19", paragraphId: "F-19-p1", evidence: "repeats F-11" }), { text: "She reported no saddle numbness.", label: "Remove the repeated sentence", detail: "removed a sentence F-11 already prints." });
  // Short values, and one column of two numbered rows (fix round 2, B1-4), are not compared.
  assert.deepEqual(repeatedDraftSentences([
    { key: "F-29", title: "Activity 1 – frequency before the injury", paragraphs: [{ id: "a", text: "Twice a week, 10 km", sourceIds: [], origin: "ai" }] },
    { key: "F-33", title: "Activity 2 – frequency before the injury", paragraphs: [{ id: "b", text: "Twice a week (10 km)", sourceIds: [], origin: "ai" }] },
    { key: "F-40", title: "Medication", paragraphs: [{ id: "c", text: "None reported", sourceIds: [], origin: "ai" }] },
    { key: "F-41", title: "Allergies", paragraphs: [{ id: "d", text: "None reported", sourceIds: [], origin: "ai" }] },
  ] as never), []);
  // The prompt says it too.
  const { FORM_DRAFT_SYSTEM_PROMPT } = await import("../../ai/form-prompts");
  assert.match(FORM_DRAFT_SYSTEM_PROMPT, /12\. Say each thing once on the form\. A comments cell beside a condition or an activity adds to it/);
});

/* B2-8 ------------------------------------------------------------------------------------------------------------------ */

test("B2-8: a value after the printed “To return to” never restates it (Medcare IA F-09)", () => {
  const guidance = "The activities the claimant wants to return to (their goals as recorded at the assessment), in a few words; it replaces “…” in “To return to … with 75% reduced difficulty…”.";
  const field = f("F-09", "Benefits of treatment – activities to return to", { target: "replace_placeholder", blockId: "t3.r1.c0.p0", placeholderText: "…" }, { guidance });
  assert.equal(printedLeadOf(field), "To return to");
  assert.equal(withoutPrintedVerb("returning to work as a senior care assistant on 12-hour shifts", "To return to"), "work as a senior care assistant on 12-hour shifts");
  assert.equal(withoutPrintedVerb("walking the dog every day, returning to work as a senior care assistant", "To return to"), "walking the dog every day and work as a senior care assistant");
  assert.equal(withoutPrintedVerb("walking the dog every day", "To return to"), "walking the dog every day", "nothing restated");
  const flags = ofKey(fit(formOf("Initial Assessment Report", [field]), { "F-09": "Returning to work as a senior care assistant" }), "F-09", "wording");
  assert.equal(flags.length, 1);
  assert.match(flags[0].message, /^Check the wording: the form already prints “To return to” before this answer, so it would read “To return to returning to work as a senior care…”\. Start with the activity itself \(“work as a senior care assistant…”\)\.$/);
});

/* B2-14 ----------------------------------------------------------------------------------------------------------------- */

test("B2-14: “Shorten for the box” only for a date lead or an attribution – and for an 8-line “one or two lines” answer", () => {
  const form = formOf("Initial Assessment Report", [
    f("F-10", "Clinical Impression: Please give clinical details in this box", { target: "after_paragraph", blockId: "t1.r1.c0.p0" }, { answerType: "long_text" }),
    f("F-10b", "Body part affected", { target: "table_cell", blockId: "t1.r1.c1" }),
    f("F-15", "Symptoms at the initial assessment – area 1: pain VAS and symptoms", { target: "table_cell", blockId: "t0.r2.c1" }, { guidance: "The pain score out of 10 and the symptoms for this area at the initial assessment, in one or two lines (written under the printed “Pain VAS:”)." }),
    f("F-17", "Taken prescribed medicine - If yes, please provide details", { target: "table_cell", blockId: "t3.r1.c1" }, { answerType: "long_text" }),
    f("F-17b", "Taken prescribed medicine", { target: "table_cell", blockId: "t3.r1.c0" }, { answerType: "yes_no" }),
    f("F-21", "Pre-existing conditions", { target: "table_cell", blockId: "t2.r2.c0" }, { answerType: "long_text", guidance: "Any pre-existing condition recorded in the history (or “None reported”)." }),
    f("F-22", "Pre-existing conditions – comments", { target: "table_cell", blockId: "t2.r2.c1" }, { answerType: "long_text" }),
  ]);
  const shorten = (key: string, text: string) => ofKey(fit(form, { [key]: text }), key, "shorten");
  assert.deepEqual(shorten("F-10", "Grade I–II sprain of the right medial collateral ligament after twisting his right knee at football on 30/08/2026"), [], "a date inside the fact (JJ IA F-10)");
  assert.deepEqual(shorten("F-17", "Naproxen, prescribed by the GP on 03/09/2026; Mrs Whitlock reported that it helps"), [], "the patient's own report (Ascenti IA F-17)");
  assert.deepEqual(shorten("F-21", "None reported"), [], "what the guidance asks for (10Bridge IA F-21)");
  assert.equal(shorten("F-21", "On 15/07/2026 Sarah Reid recorded no pre-existing conditions.").length, 1, "a date lead still flags");
  const gemma = "Low back pain 7/10 at worst and 3/10 at rest, across the lower back and worse on the left, with no pain below the knee, morning stiffness for about 30 minutes, pain on bending, lifting, getting up from a chair and sitting for more than 30 minutes, and sleep disturbed when turning over.";
  const long = shorten("F-15", gemma);
  assert.equal(long.length, 1, "Gemma's 50 words in a narrow cell (10Bridge IA F-15)");
  assert.match(long[0].message, /^Shorten for the box: the form asks for one or two lines here, and this answer runs to \d+ words in a narrow table cell\./);
  assert.deepEqual(shorten("F-15", "Neck pain 6/10 at worst, with stiffness turning to the left and headaches 3 to 4 times a week"), [], "two lines are fine");
});

/* B2-16 ----------------------------------------------------------------------------------------------------------------- */

test("B2-16: a “…/10” value keeps the value only – a trailing attribution goes (the citation keeps it), with one click", async () => {
  assert.equal(valueOnly("6/10 at worst (2/10 at rest), as recorded by Priya Shah using the Numeric Pain Rating Scale"), "6/10 at worst (2/10 at rest)");
  assert.equal(valueOnly("6/10 at worst"), "6/10 at worst");
  const { draftFitFix } = await import("../../ui/components/review/review-model");
  const report = { sections: [{ key: "F-16", title: "Pain score (VAS)", paragraphs: [{ id: "F-16-p1", text: "6/10 at worst (2/10 at rest), as recorded by Priya Shah using the Numeric Pain Rating Scale", sourceIds: ["N-001"], origin: "ai" }] }] } as unknown as Report;
  assert.deepEqual(draftFitFix(report, { code: "DRAFT_FIT", sectionKey: "F-16", paragraphId: "F-16-p1", evidence: "shorten" }), { text: "6/10 at worst (2/10 at rest)", label: "Use the value only (6/10 at worst (2/10 at rest))", detail: "kept the value only – who recorded it stays in its citation." });
});

/* B2-17 ----------------------------------------------------------------------------------------------------------------- */

test("B2-17: a whole sentence about what the notes do not hold is commentary – flagged, with one click to remove it", async () => {
  const form = formOf("Discharge Report", [f("F-38", "Is the patient taking medication? If yes, what type of medication has been taken and how often?", { target: "after_paragraph", blockId: "p38" }, { answerType: "long_text" })]);
  const text = "Mrs Whitlock was taking naproxen, prescribed by her GP. No frequency was recorded in that note.";
  const comment = ofKey(fit(form, { "F-38": text }), "F-38", "comment");
  assert.equal(comment.length, 1, "it was not flagged and would print (CLM Discharge F-38)");
  assert.equal(comment[0].message, "Remove the comment about the notes (“No frequency was recorded in that note.”): it would be printed on the form.");
  const { draftFitFix } = await import("../../ui/components/review/review-model");
  const report = { sections: [{ key: "F-38", title: "x", paragraphs: [{ id: "F-38-p1", text, sourceIds: ["N-001"], origin: "ai" }] }] } as unknown as Report;
  assert.equal(draftFitFix(report, comment[0])?.text, "Mrs Whitlock was taking naproxen, prescribed by her GP.");
});

/* B2-18 ----------------------------------------------------------------------------------------------------------------- */

test("B2-18: the patient's name repeated in one sentence becomes he / she – otherwise it is flagged (Ascenti Discharge F-47)", () => {
  assert.equal(
    pronounForRepeatedName("Mr Ellery told me on 16/09/2026 that Mr Ellery was working full time. I advised Mr Ellery to contact the clinic.", "Mr Ellery", "Mr"),
    "Mr Ellery told me on 16/09/2026 that he was working full time. I advised Mr Ellery to contact the clinic.",
  );
  assert.equal(pronounForRepeatedName("Mrs Whitlock said that her GP advised Mrs Whitlock to rest.", "Mrs Whitlock", "Mrs"), "Mrs Whitlock said that her GP advised her to rest.");
  assert.equal(pronounForRepeatedName("Mx Lee told me that Mx Lee was working.", "Mx Lee", "Mx"), "Mx Lee told me that Mx Lee was working.", "no gendered title: unchanged");
  assert.equal(pronounForRepeatedName("He said “Mr Ellery, sit down” to Mr Ellery.", "Mr Ellery", "Mr"), "He said “Mr Ellery, sit down” to Mr Ellery.", "quotations untouched");
  // Left in an older draft: "Check the wording".
  const form = formOf("End of Treatment Report", [f("F-47", "Any additional comments.", { target: "after_paragraph", blockId: "p47" }, { answerType: "long_text" })]);
  const flags = ofKey(fit(form, { "F-47": "Mr Testcase said Mr Testcase felt better." }), "F-47", "wording");
  assert.equal(flags.length, 1);
  assert.match(flags[0].message, /^Check the wording: “Mr Testcase” is named twice in one sentence/);
});

/* B2-5 (item 3) --------------------------------------------------------------------------------------------------------- */

test("B2-5: a yes-or-no question answered in words is recognised (CLM Discharge F-47)", () => {
  assert.equal(yesNoInWords({ label: "Is there any evidence if psychosocial factors in this case?", guidance: "Psychosocial factors recorded (attitudes, beliefs, mood, social, work) – or “No”: it replaces the printed default “No”.", answerType: "long_text" }), true);
  assert.equal(yesNoInWords({ label: "Findings/Conclusions/Additional Comments:", guidance: "Give overall findings.", answerType: "long_text" }), false);
});
