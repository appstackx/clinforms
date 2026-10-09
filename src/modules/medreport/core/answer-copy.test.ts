/**
 * "Copy answers": the plain text of each answer (dates DD/MM/YYYY, ticks as the option chosen), the
 * numbered "Question: answer" blocks of "Copy all answers" with "[to complete]" for gaps, the draft
 * marker before approval, the approved text after, and the .txt download.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  answersFileName,
  answersTxt,
  buildAnswersCopy,
  copyAnswerValue,
  copyEntries,
  copyFormOf,
  copyTextForAnswer,
  formatCopyBlock,
  questionLead,
} from "./answer-copy";
import { questionAnchor } from "./question-set";
import type { FormDefinition, FormField, Report, ReportSection, SignReceipt } from "./types";

const field = (n: number, label: string, rest: Partial<FormField>): FormField => ({
  id: `F-${String(n).padStart(2, "0")}`,
  label,
  guidance: "",
  answerType: "long_text",
  anchor: questionAnchor(n - 1),
  fillSource: { kind: "notes_narrative" },
  required: true,
  confidence: "high",
  ...rest,
});

const FIELDS: FormField[] = [
  field(1, "Patient's full name", { answerType: "short_text", fillSource: { kind: "registration", path: "patient.fullName" } }),
  field(2, "Date of birth", { answerType: "date", fillSource: { kind: "registration", path: "patient.dob" } }),
  field(3, "Current symptoms and progress", { section: "Clinical update" }),
  field(4, "Is further treatment requested?", { answerType: "yes_no", options: ["Yes – see plan", "No"], fillSource: { kind: "clinician_opinion" } }),
  field(5, "Physiotherapist", { answerType: "checkbox", options: ["Physiotherapist"] }),
  field(6, "Treatment type", { answerType: "single_choice", options: ["Face to face", "Video"] }),
  field(7, "Number of sessions attended", { answerType: "number", fillSource: { kind: "computed_fact", factId: "FACT-attendance", format: "sessions_attended" } }),
  field(8, "Prognosis", { fillSource: { kind: "clinician_opinion" } }),
  field(9, "For office use", { fillSource: { kind: "leave_blank" }, required: false }),
  field(10, "Signature", { answerType: "signature", fillSource: { kind: "signoff", part: "signature" } }),
  field(11, "Ticked if discharged", { answerType: "checkbox" }),
];

const para = (id: string, text: string, origin: "ai" | "from_records" | "clinician" = "ai") => ({ id, text, sourceIds: origin === "clinician" ? [] : ["N-001"], origin });

const SECTIONS: ReportSection[] = [
  { key: "F-01", fieldId: "F-01", title: "Patient's full name", kind: "from_records", status: "complete", paragraphs: [para("p1", "Megan Hart", "from_records")] },
  { key: "F-02", fieldId: "F-02", title: "Date of birth", kind: "from_records", status: "complete", paragraphs: [para("p2", "22/11/1991", "from_records")], answer: { kind: "date", value: "1991-11-22" } },
  {
    key: "F-03",
    fieldId: "F-03",
    title: "Current symptoms and progress",
    kind: "ai_narrative",
    status: "drafted",
    paragraphs: [para("p3", "Neck pain has reduced from 7 to 2 out of 10."), para("p4", "  "), para("p5", "Full range of movement was recorded on 07/07/2026.")],
  },
  { key: "F-04", fieldId: "F-04", title: "Is further treatment requested?", kind: "clinician_opinion", status: "complete", paragraphs: [], answer: { kind: "yes_no", value: true } },
  { key: "F-05", fieldId: "F-05", title: "Physiotherapist", kind: "ai_narrative", status: "complete", paragraphs: [], answer: { kind: "checkbox", value: true } },
  { key: "F-06", fieldId: "F-06", title: "Treatment type", kind: "ai_narrative", status: "complete", paragraphs: [], answer: { kind: "choice", value: "Video" } },
  { key: "F-07", fieldId: "F-07", title: "Number of sessions attended", kind: "from_records", status: "complete", paragraphs: [para("p7", "10", "from_records")], answer: { kind: "number", value: "10" } },
  { key: "F-08", fieldId: "F-08", title: "Prognosis", kind: "clinician_opinion", status: "needs_input", paragraphs: [] },
  { key: "F-10", fieldId: "F-10", title: "Signature", kind: "declaration", status: "pending", paragraphs: [] },
  { key: "F-11", fieldId: "F-11", title: "Ticked if discharged", kind: "ai_narrative", status: "complete", paragraphs: [], answer: { kind: "checkbox", value: false } },
];

const FORM: Pick<FormDefinition, "fields" | "title" | "referrer"> = {
  fields: FIELDS,
  title: "Treatment update",
  referrer: { name: "Northbridge Health Insurance (fictional)", type: "insurer" },
};

const RECEIPT = {
  reportId: "rpt-1",
  tenantId: "demo",
  contentSha256: "a".repeat(64),
  signer: { name: "Sarah Reid", hcpc: "PH-DEMO-01" },
  signedAt: "2026-10-09T13:05:00.000Z",
  statementAccepted: true,
  attestations: [],
  mac: "mac",
} satisfies SignReceipt;

function report(status: "draft" | "signed"): Pick<Report, "sections" | "receipt" | "status" | "patientLabel" | "form" | "instructingParty" | "bundleSnapshot"> {
  return {
    sections: SECTIONS,
    status,
    ...(status === "signed" ? { receipt: RECEIPT } : {}),
    patientLabel: "Megan Hart",
    form: { formId: "form-qs-1", title: "Treatment update", referrer: FORM.referrer, fileSha256: "b".repeat(64), kind: "questions" },
    instructingParty: { type: "insurer", name: "Northbridge Health Insurance (fictional)", reference: "NB-0001", contactName: "", address: "" },
    bundleSnapshot: { registration: { firstName: "Megan", lastName: "Hart" } } as Report["bundleSnapshot"],
  };
}

test("one answer as plain text: dates DD/MM/YYYY, yes/no as the printed option, ticks as the option chosen", () => {
  const value = (key: string, receipt: SignReceipt | null = null) =>
    copyAnswerValue(FIELDS.find((f) => f.id === key) ?? null, SECTIONS.find((s) => s.key === key) ?? null, receipt);
  assert.equal(value("F-01"), "Megan Hart");
  assert.equal(value("F-02"), "22/11/1991");
  assert.equal(value("F-03"), "Neck pain has reduced from 7 to 2 out of 10.\n\nFull range of movement was recorded on 07/07/2026.");
  assert.equal(value("F-04"), "Yes – see plan");
  assert.equal(value("F-05"), "Physiotherapist");
  assert.equal(value("F-06"), "Video");
  assert.equal(value("F-07"), "10");
  assert.equal(value("F-08"), null, "no answer yet");
  assert.equal(value("F-10"), null, "sign-off is blank before approval");
  assert.equal(value("F-10", RECEIPT), "Sarah Reid – approved electronically on 09/10/2026");
  assert.equal(value("F-11"), "No");
  // Without printed options a yes/no is Yes / No.
  assert.equal(copyAnswerValue({ answerType: "yes_no", fillSource: { kind: "notes_narrative" } }, { paragraphs: [], answer: { kind: "yes_no", value: false } }), "No");
});

test("copy entries: form order, sign-off kept, the referrer's-use box skipped, numbered from 1", () => {
  const entries = copyEntries(report("draft"), FORM);
  assert.deepEqual(
    entries.map((e) => [e.number, e.key, e.status]),
    [
      [1, "F-01", "answered"],
      [2, "F-02", "answered"],
      [3, "F-03", "answered"],
      [4, "F-04", "answered"],
      [5, "F-05", "answered"],
      [6, "F-06", "answered"],
      [7, "F-07", "answered"],
      [8, "F-08", "to_complete"],
      [9, "F-10", "on_approval"],
      [10, "F-11", "answered"],
    ],
  );
  assert.equal(entries[2].section, "Clinical update");
});

test("question leads and blocks: “Question: answer”, multi-paragraph answers on their own lines, gaps as [to complete]", () => {
  assert.equal(questionLead("Date of birth"), "Date of birth:");
  assert.equal(questionLead("Is further treatment requested?"), "Is further treatment requested?");
  assert.equal(questionLead("Reference:"), "Reference:");
  assert.equal(formatCopyBlock({ number: 2, question: "Date of birth", answer: "22/11/1991", status: "answered" }), "2. Date of birth: 22/11/1991");
  assert.equal(formatCopyBlock({ number: 3, question: "Symptoms", answer: "One.\n\nTwo.", status: "answered" }), "3. Symptoms:\nOne.\n\nTwo.");
  assert.equal(formatCopyBlock({ number: 8, question: "Prognosis", answer: null, status: "to_complete" }), "8. Prognosis: [to complete]");
  assert.equal(formatCopyBlock({ number: 9, question: "Signature", answer: null, status: "on_approval" }), "9. Signature: [completed on approval]");
  // Once approved, an unanswered (optional) question was left blank on purpose.
  assert.equal(formatCopyBlock({ number: 8, question: "Prognosis", answer: null, status: "to_complete" }, true), "8. Prognosis: [left blank]");
});

test("Copy all answers before approval: marked “Draft – not yet approved” at the top and the bottom", () => {
  const copy = buildAnswersCopy({ report: report("draft"), form: copyFormOf(FORM as FormDefinition) });
  assert.equal(copy.approved, false);
  assert.equal(copy.toComplete, 1);
  assert.equal(
    copy.text,
    [
      "Treatment update – Northbridge Health Insurance (fictional)",
      "Patient: Megan Hart",
      "Draft – not yet approved",
      "",
      "1. Patient's full name: Megan Hart",
      "",
      "2. Date of birth: 22/11/1991",
      "",
      "3. Current symptoms and progress:",
      "Neck pain has reduced from 7 to 2 out of 10.",
      "",
      "Full range of movement was recorded on 07/07/2026.",
      "",
      "4. Is further treatment requested? Yes – see plan",
      "",
      "5. Physiotherapist: Physiotherapist",
      "",
      "6. Treatment type: Video",
      "",
      "7. Number of sessions attended: 10",
      "",
      "8. Prognosis: [to complete]",
      "",
      "9. Signature: [completed on approval]",
      "",
      "10. Ticked if discharged: No",
      "",
      "Draft – not yet approved",
    ].join("\n"),
  );
  // One answer copied from a draft is marked too.
  assert.equal(copyTextForAnswer("22/11/1991", false), "[Draft – not yet approved] 22/11/1991");
});

test("after approval: the approved text, who approved it and when, no draft marker", () => {
  const copy = buildAnswersCopy({ report: report("signed"), form: copyFormOf(FORM as FormDefinition) });
  assert.equal(copy.approved, true);
  assert.equal(copy.header[2], "Approved by Sarah Reid (HCPC PH-DEMO-01) on 09/10/2026");
  assert.ok(!copy.text.includes("Draft"), copy.text);
  assert.ok(copy.text.includes("9. Signature: Sarah Reid – approved electronically on 09/10/2026"));
  assert.ok(copy.text.includes("8. Prognosis: [left blank]"));
  assert.ok(!copy.text.includes("[to complete]"));
  assert.equal(copyTextForAnswer("22/11/1991", true), "22/11/1991");
  // A title that already names the referrer is not repeated.
  const named = buildAnswersCopy({ report: { ...report("signed"), form: { ...report("signed").form!, title: "Northbridge Health Insurance (fictional) – portal questions" } }, form: null });
  assert.equal(named.header[0], "Northbridge Health Insurance (fictional) – portal questions");
});

test("without the form map in this browser the report's own sections are copied", () => {
  const entries = copyEntries(report("draft"), null);
  assert.equal(entries.length, SECTIONS.length);
  assert.deepEqual(entries.find((e) => e.key === "F-10"), { key: "F-10", number: 9, question: "Signature", answer: null, status: "on_approval" });
  assert.equal(entries.find((e) => e.key === "F-02")?.answer, "22/11/1991");
  assert.equal(entries.find((e) => e.key === "F-08")?.status, "to_complete");
});

test("the .txt download: CRLF line endings and its file name", () => {
  const copy = buildAnswersCopy({ report: report("draft"), form: copyFormOf(FORM as FormDefinition) });
  const txt = answersTxt(copy);
  assert.ok(txt.endsWith("Draft – not yet approved\r\n"));
  assert.ok(!/[^\r]\n/.test(txt), "every line ends with CRLF");
  assert.equal(answersFileName(report("draft"), { now: new Date("2026-10-10T09:00:00.000Z") }), "Hart_M_Treatment-update_answers_2026-10-10_DRAFT.txt");
  assert.equal(answersFileName(report("signed")), "Hart_M_Treatment-update_answers_2026-10-09_APPROVED.txt");
});
