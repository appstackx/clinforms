/**
 * Validators per FORM FIELD (Revision 2): required vs optional answers, structured answers, drafted
 * date / number answers against their citations, opinion wording, employer scope, citations, gaps –
 * plus the answer parsing and draft grouping used by form reports. Inline fictional fixtures only.
 *
 * Owner: ai agent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFacts } from "../computed-facts";
import { formToTemplate, isSectionAnswered, parseFormAnswerValue } from "../forms";
import { createFormReport, planDraftGroups } from "../report-factory";
import { ReportSchema } from "../schemas";
import type { FormDefinition, FormField, Paragraph, Report, ReportSection } from "../types";
import { canSign, validateReport } from "./index";
import { TEST_FACTS_DATE, para, testBundle } from "./test-fixtures";

const AT = "2026-10-06T09:00:00.000Z";

function f(n: number, label: string, rest: Pick<FormField, "answerType" | "fillSource"> & Partial<FormField>): FormField {
  const id = `F-${String(n).padStart(2, "0")}`;
  return {
    id,
    label,
    guidance: `Answer “${label}”.`,
    anchor: { kind: "docx", target: "table_cell", blockId: `t0.r${n}.c1` },
    required: true,
    confidence: "high",
    ...rest,
  };
}

function employerForm(): FormDefinition {
  return {
    id: "frm_test_employer",
    tenantId: "demo",
    referrer: { name: "Example Freight Ltd (fictional)", type: "employer" },
    title: "Fitness for Work Report",
    file: {
      fileName: "ffw.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sha256: "c".repeat(64),
      sizeBytes: 1000,
    },
    kind: "docx",
    fields: [
      f(1, "Employee name", { answerType: "short_text", fillSource: { kind: "registration", path: "patient.fullName" } }),
      f(2, "Current symptoms", { answerType: "long_text", fillSource: { kind: "notes_narrative" } }),
      f(3, "Date symptoms began", { answerType: "date", fillSource: { kind: "notes_narrative" } }),
      f(4, "ODI score at discharge", { answerType: "number", fillSource: { kind: "notes_narrative" } }),
      f(5, "Is the employee fit for work?", {
        answerType: "single_choice",
        options: ["Fit for normal duties", "Fit with adjustments", "Not fit"],
        fillSource: { kind: "clinician_opinion" },
      }),
      f(6, "Recommended adjustments", { answerType: "long_text", fillSource: { kind: "clinician_opinion" } }),
      f(7, "Any other comments", { answerType: "long_text", required: false, fillSource: { kind: "notes_narrative" } }),
      f(8, "Signature", { answerType: "signature", fillSource: { kind: "signoff", part: "signature" } }),
    ],
    status: "confirmed",
    analysis: { mode: "demo_prewritten", promptVersion: "test", at: AT, warnings: [] },
    confirmed: { by: "Test", at: AT },
    createdAt: AT,
    updatedAt: AT,
  };
}

function build(form = employerForm()): { form: FormDefinition; report: Report } {
  const bundle = testBundle();
  const report = createFormReport({
    form,
    bundle,
    instructingParty: bundle.referral,
    computedFacts: computeFacts(bundle, { asOf: TEST_FACTS_DATE }),
    id: "rpt_form_test",
    now: new Date(AT),
  });
  return { form, report };
}

function setSection(report: Report, key: string, patch: Partial<ReportSection>): Report {
  return { ...report, sections: report.sections.map((s) => (s.key === key ? { ...s, ...patch } : s)) };
}

function flagsFor(report: Report, form: FormDefinition, key?: string) {
  const result = validateReport(report, formToTemplate(form));
  return { ...result, mine: key ? result.flags.filter((x) => x.sectionKey === key) : result.flags };
}

test("a new form report is schema-valid; registration answers are filled by code", () => {
  const { report } = build();
  ReportSchema.parse(report);
  const name = report.sections.find((s) => s.key === "F-01");
  assert.equal(name?.paragraphs[0].text, "Owen Testcase");
  assert.equal(name?.paragraphs[0].origin, "from_records");
  assert.deepEqual(report.sections.find((s) => s.key === "F-05")?.answer, { kind: "choice", value: null });
});

test("required field empty → blocking MISSING_PLACEHOLDER; optional field empty → warning only", () => {
  const { form, report } = build();
  const { flags, canSign: ok } = flagsFor(report, form);
  const missing = flags.filter((x) => x.code === "MISSING_PLACEHOLDER");
  const blocking = missing.filter((x) => x.severity === "blocking").map((x) => x.sectionKey);
  assert.deepEqual(blocking.sort(), ["F-02", "F-03", "F-04", "F-05", "F-06"]);
  const optional = missing.find((x) => x.sectionKey === "F-07");
  assert.equal(optional?.severity, "warning");
  assert.equal(optional?.evidence, "optional field blank");
  assert.ok(!missing.some((x) => x.sectionKey === "F-08"), "sign-off fields are filled on approval");
  assert.equal(ok, false);
});

test("structured answers count by value, not by their supporting paragraphs", () => {
  const support: Paragraph[] = [para("On 06/05/2026 Tom Ellis recorded that he is fit for a phased return to normal duties over 2 weeks.", ["N-002"], { basis: "clinician_opinion_recorded" })];
  assert.equal(isSectionAnswered({ paragraphs: support, answer: { kind: "choice", value: null } }), false);
  assert.equal(isSectionAnswered({ paragraphs: [], answer: { kind: "choice", value: "Fit with adjustments" } }), true);
  assert.equal(isSectionAnswered({ paragraphs: [], answer: { kind: "yes_no", value: false } }), true);

  const { form, report } = build();
  const withJustOneText = setSection(report, "F-05", { paragraphs: support, answer: { kind: "choice", value: null }, status: "needs_input" });
  assert.ok(flagsFor(withJustOneText, form, "F-05").mine.some((x) => x.code === "MISSING_PLACEHOLDER" && x.severity === "blocking"));
  const answered = setSection(report, "F-05", { paragraphs: support, answer: { kind: "choice", value: "Fit with adjustments" }, status: "drafted" });
  const after = flagsFor(answered, form, "F-05").mine;
  assert.deepEqual(after, [], JSON.stringify(after));
});

test("a drafted DATE answer must appear in the sources its support cites (blocking); numbers warn", () => {
  const { form, report } = build();
  const goodDate = setSection(report, "F-03", {
    answer: { kind: "date", value: "2026-03-12" },
    paragraphs: [para("The employee reported a lifting injury at work on 12/03/2026.", ["N-001"], { basis: "patient_reported" })],
  });
  assert.deepEqual(flagsFor(goodDate, form, "F-03").mine, []);

  const badDate = setSection(report, "F-03", {
    answer: { kind: "date", value: "2026-03-14" },
    paragraphs: [para("The employee reported a lifting injury at work.", ["N-001"], { basis: "patient_reported" })],
  });
  const flag = flagsFor(badDate, form, "F-03").mine.find((x) => x.code === "FIGURE_NOT_IN_SOURCE");
  assert.equal(flag?.severity, "blocking");
  assert.equal(flag?.evidence, "answer 14/03/2026");

  const badNumber = setSection(report, "F-04", {
    answer: { kind: "number", value: "21" },
    paragraphs: [para("The ODI at discharge was recorded.", ["N-002"])],
  });
  assert.equal(flagsFor(badNumber, form, "F-04").mine.find((x) => x.code === "FIGURE_NOT_IN_SOURCE")?.severity, "warning");

  // A value the clinician typed with no drafted support is theirs: not checked.
  const clinicianValue = setSection(report, "F-04", { answer: { kind: "number", value: "21" }, paragraphs: [] });
  assert.deepEqual(flagsFor(clinicianValue, form, "F-04").mine.filter((x) => x.code === "FIGURE_NOT_IN_SOURCE"), []);
});

test("opinion fields: attributing the recorded opinion passes; strengthening it is blocked", () => {
  const { form, report } = build();
  const attributed = setSection(report, "F-06", {
    paragraphs: [
      para(
        "On 06/05/2026 Tom Ellis, physiotherapist, recorded that in his opinion he is fit for a phased return to normal duties over 2 weeks and should avoid repetitive lifting >15 kg for 4 weeks.",
        ["N-002"],
        { basis: "clinician_opinion_recorded" },
      ),
    ],
  });
  assert.deepEqual(flagsFor(attributed, form, "F-06").mine, []);

  const strengthened = setSection(report, "F-06", {
    paragraphs: [para("He has made a full recovery and is fit for normal duties without restrictions.", ["N-002"], { basis: "clinician_opinion_recorded" })],
  });
  const codes = flagsFor(strengthened, form, "F-06").mine.filter((x) => x.code === "OPINION_LANGUAGE").map((x) => x.evidence);
  assert.ok(codes.length >= 2, JSON.stringify(codes));

  const noNote = setSection(report, "F-06", {
    paragraphs: [para("He is fit for a phased return to normal duties over 2 weeks.", ["REG"], { basis: "clinician_opinion_recorded" })],
  });
  assert.ok(flagsFor(noNote, form, "F-06").mine.some((x) => x.code === "UNCITED_PARAGRAPH" && x.evidence === "no note cited"));
});

test("employer forms: past medical and social history are out of scope in every field", () => {
  const { form, report } = build();
  const leaked = setSection(report, "F-02", {
    paragraphs: [para("He reported central low back pain; he is a smoker with a past medical history of asthma.", ["N-001"], { basis: "patient_reported" })],
  });
  const scope = flagsFor(leaked, form, "F-02").mine.filter((x) => x.code === "SCOPE_TERM").map((x) => x.evidence?.toLowerCase());
  assert.ok(scope.includes("smoker") && scope.includes("past medical history"), JSON.stringify(scope));
});

test("uncited and unknown sources are flagged per field; open gaps block until resolved", () => {
  const { form, report } = build();
  const uncited = setSection(report, "F-02", { paragraphs: [para("He reported low back pain.", [])] });
  assert.ok(flagsFor(uncited, form, "F-02").mine.some((x) => x.code === "UNCITED_PARAGRAPH"));
  const unknown = setSection(report, "F-02", { paragraphs: [para("He reported low back pain.", ["N-001", "N-999"], { basis: "patient_reported" })] });
  assert.ok(flagsFor(unknown, form, "F-02").mine.some((x) => x.code === "UNKNOWN_SOURCE_ID" && x.evidence === "N-999"));

  const withGap: Report = {
    ...report,
    gaps: [{ id: "gap-1", sectionKey: "F-06", issue: "No adjustments recorded", suggestedQuestion: "What adjustments do you recommend?", relatedNoteIds: ["N-002"], raisedBy: "ai" }],
  };
  const result = flagsFor(withGap, form, "F-06");
  assert.ok(result.mine.some((x) => x.code === "OPEN_GAP" && x.gapId === "gap-1"));
  const resolved = withGap.gaps.map((g) => ({ ...g, resolution: { kind: "resolved" as const, text: "Written by clinician", at: AT } }));
  assert.equal(canSign(result.flags.filter((x) => x.code === "OPEN_GAP"), resolved).ok, true);
});

test("parseFormAnswerValue: yes/no, tick box, choice, date and number; never guesses", () => {
  const yn = { answerType: "yes_no" as const, options: ["Yes", "No"] };
  assert.deepEqual(parseFormAnswerValue(yn, "Yes"), { kind: "yes_no", value: true });
  assert.deepEqual(parseFormAnswerValue(yn, "no."), { kind: "yes_no", value: false });
  assert.deepEqual(parseFormAnswerValue(yn, "Possibly"), { kind: "yes_no", value: null });
  assert.deepEqual(parseFormAnswerValue({ answerType: "yes_no", options: ["Yes – see details", "No"] }, "Yes – see details"), { kind: "yes_no", value: true });
  assert.deepEqual(parseFormAnswerValue({ answerType: "checkbox" }, "ticked"), { kind: "checkbox", value: true });
  const choice = { answerType: "single_choice" as const, options: ["Fit for normal duties", "Fit with adjustments", "Not fit"] };
  assert.deepEqual(parseFormAnswerValue(choice, "fit with adjustments"), { kind: "choice", value: "Fit with adjustments" });
  assert.deepEqual(parseFormAnswerValue(choice, "Unfit"), { kind: "choice", value: null });
  assert.deepEqual(parseFormAnswerValue({ answerType: "date" }, "12/03/2026"), { kind: "date", value: "2026-03-12" });
  assert.deepEqual(parseFormAnswerValue({ answerType: "date" }, "2026-03-12"), { kind: "date", value: "2026-03-12" });
  assert.deepEqual(parseFormAnswerValue({ answerType: "date" }, "March 2026"), { kind: "date", value: null });
  assert.deepEqual(parseFormAnswerValue({ answerType: "number" }, "10"), { kind: "number", value: "10" });
  assert.deepEqual(parseFormAnswerValue({ answerType: "number" }, "about ten"), { kind: "number", value: null });
  assert.deepEqual(parseFormAnswerValue({ answerType: "long_text" }, "anything"), { kind: "text", value: null });
  assert.deepEqual(parseFormAnswerValue(yn, ""), { kind: "yes_no", value: null });
});

test("planDraftGroups: form fields in form order; a long narrative counts double", () => {
  const base = employerForm();
  const fields: FormField[] = [
    ...Array.from({ length: 5 }, (_, i) => f(i + 1, `Narrative ${i + 1}`, { answerType: "long_text" as const, fillSource: { kind: "notes_narrative" as const } })),
    ...Array.from({ length: 5 }, (_, i) => f(i + 6, `Opinion ${i + 1}`, { answerType: "long_text" as const, fillSource: { kind: "clinician_opinion" as const } })),
    f(11, "Short fact", { answerType: "short_text", fillSource: { kind: "notes_narrative" } }),
  ];
  const form = { ...base, fields };
  const { report } = build(form);
  const groups = planDraftGroups(report, formToTemplate(form));
  assert.deepEqual(groups, [
    ["F-01", "F-02"],
    ["F-03", "F-04"],
    ["F-05", "F-06", "F-07"],
    ["F-08", "F-09", "F-10", "F-11"],
  ]);
  assert.deepEqual(groups.flat(), fields.map((x) => x.id));
});
