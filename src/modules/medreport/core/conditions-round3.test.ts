/**
 * Blue Heart fix round 3 – conditional questions and values filled by code:
 * - B2-4: the condition a question carries in its heading or guidance survives drafting (applyDraftResult dropped it), and
 *   a report drafted before the fix gets it from the form map (validation, forms engine, Copy answers, review).
 * - B2-5: "Barriers to recovery – details" depends on "Is there evidence of any barriers to recovery?".
 * - B2-13: "Restrictions on daily living – status / – details" do not apply when the activity cell says "None".
 * - B2-19: attended session dates are filled by code, in date order – never drafted.
 * - B2-24: the numbered sessions the record does not have are named in one activity entry.
 * Labels and guidance as printed on Blue Heart's forms; fictional record (test fixtures).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyEntries } from "./answer-copy";
import { computeFacts } from "./computed-facts";
import { conditionOf, conditionText, notApplicable, withReportConditions } from "./conditions";
import { buildFormAnswers, formToTemplate } from "./forms";
import { applyDraftResult, createFormReport, planDraftGroups, sessionDatesByCode } from "./report-factory";
import type { FormDefinition, FormField, GenerationMeta, Report, ReportSection } from "./types";
import { validateReport } from "./validation";
import { TEST_FACTS_DATE, testBundle } from "./validation/test-fixtures";

let n = 0;
const field = (label: string, rest: Partial<FormField> = {}): FormField => {
  n += 1;
  return {
    id: `F-${String(n).padStart(2, "0")}`,
    label,
    guidance: "",
    answerType: "long_text",
    anchor: { kind: "docx", target: "table_cell", blockId: `t0.r${n}.c1` },
    fillSource: { kind: "notes_narrative" },
    required: false,
    confidence: "high",
    ...rest,
  };
};

function formOf(fields: FormField[], title = "End of Treatment Report"): FormDefinition {
  return {
    id: "frm_cond3",
    tenantId: "demo",
    title,
    referrer: { name: "10Bridge", type: "mlc" },
    kind: "docx",
    file: { name: "f.docx", sha256: "b".repeat(64), size: 1000 },
    fields,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "t", at: "2026-10-25T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-25T09:00:00.000Z",
    updatedAt: "2026-10-25T09:00:00.000Z",
  } as unknown as FormDefinition;
}

const reportOf = (form: FormDefinition, bundle = testBundle()): Report =>
  createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle, { asOf: TEST_FACTS_DATE }), id: "rpt_cond3", now: new Date("2026-10-25T09:00:00.000Z") });

const META: GenerationMeta = { mode: "demo_prewritten", sectionKeys: [], at: "2026-10-25T09:05:00.000Z", promptVersion: "forms-10" };

/** A drafted section as POST /drafts returns it: no `condition` of its own. */
const drafted = (key: string, title: string, text: string, answer?: ReportSection["answer"]): ReportSection => ({
  key,
  title,
  kind: "ai_narrative",
  status: "drafted",
  fieldId: key,
  paragraphs: text ? [{ id: `${key}-p1`, text, sourceIds: ["N-002"], origin: "ai" }] : [],
  ...(answer ? { answer } : {}),
});

const set = (report: Report, key: string, edit: Partial<ReportSection>): Report => ({ ...report, sections: report.sections.map((s) => (s.key === key ? { ...s, ...edit } : s)) });

/* B2-4 ------------------------------------------------------------------------------------------------------------------ */

test("B2-4: a question's heading or guidance condition survives drafting – JJ IA F-30, JJ EOTS F-12 to F-14, 10Bridge IA F-45", () => {
  n = 0;
  const heading = "If employee is not on full duties, please list main concerns and time scale for recovery:";
  const form = formOf([
    field("Restriction required – lifting limit", { answerType: "checkbox", options: ["Can only lift … Kg from waist"], fillSource: { kind: "registration", path: "staff.entry" } as never }),
    field("Lifting limit (kg)", { answerType: "short_text", fillSource: { kind: "clinician_opinion" }, guidance: "Only when the lifting restriction is kept: the most the employee may lift from the waist, in kg." }),
    field("Work status", { answerType: "single_choice", options: ["Functioning in normal role or on planned return to work", "Absent due to this condition"], fillSource: { kind: "registration", path: "staff.entry" } as never }),
    field("Main concern 1", { answerType: "short_text", section: heading, guidance: "If the employee is not on full duties: the main problem present." }),
    field("Main concern 1 – related work restriction", { answerType: "short_text", section: heading, fillSource: { kind: "clinician_opinion" } }),
    field("Main concern 1 – full recovery date", { answerType: "date", section: heading, fillSource: { kind: "clinician_opinion" } }),
    field("Treatment plan – multimodal/multidisciplinary: please specify", { answerType: "short_text", fillSource: { kind: "clinician_opinion" }, guidance: "Only when multimodal or multidisciplinary treatment is planned: what it is." }),
    field("Treatment plan – Multimodal/Multidisciplinary", { answerType: "checkbox", options: ["Multimodal/Multidisciplinary"], fillSource: { kind: "clinician_opinion" } }),
  ]);
  const created = reportOf(form);
  assert.ok(created.sections.find((s) => s.key === "F-02")?.condition, "kept at creation (fix round 2)");
  const draft = {
    sections: [
      drafted("F-02", "Lifting limit (kg)", "15 kg"),
      drafted("F-04", "Main concern 1", "Neck pain when turning"),
      drafted("F-05", "Main concern 1 – related work restriction", "No overhead lifting"),
      drafted("F-06", "Main concern 1 – full recovery date", "", { kind: "date", value: null }),
      drafted("F-07", "Treatment plan – multimodal/multidisciplinary: please specify", "Physiotherapy and GP review"),
    ],
    gaps: [],
    flags: [],
    generation: META,
  };
  let report = applyDraftResult(created, draft);
  for (const key of ["F-02", "F-04", "F-05", "F-06", "F-07"]) assert.ok(report.sections.find((s) => s.key === key)?.condition, `${key} keeps its condition after drafting`);
  // F-29 not ticked, the normal role, F-46 not ticked: none of them applies.
  report = set(set(set(report, "F-01", { answer: { kind: "checkbox", value: false } }), "F-03", { answer: { kind: "choice", value: "Functioning in normal role or on planned return to work" } }), "F-08", { answer: { kind: "checkbox", value: false } });
  for (const key of ["F-02", "F-04", "F-05", "F-06", "F-07"]) assert.equal(notApplicable(report, key)?.applies, false, key);
  const flags = validateReport(report, formToTemplate(form), { form }).flags;
  assert.deepEqual(flags.filter((f) => ["F-02", "F-04", "F-05", "F-06", "F-07"].includes(f.sectionKey ?? "") && f.code !== "OPEN_GAP"), [], "no blocking opinion item left");
  assert.deepEqual(buildFormAnswers({ ...report, flags, status: "signed" }, form)["F-07"], { leftBlank: true });

  // A report drafted before the fix (no condition on its sections): the form map supplies it everywhere it is read.
  const old: Report = { ...report, sections: report.sections.map(({ condition: _c, ...s }) => s) };
  assert.equal(notApplicable(old, "F-02"), null, "the bug: no condition, so it still applied");
  assert.equal(notApplicable(withReportConditions(old, form), "F-02")?.applies, false);
  assert.deepEqual(validateReport(old, formToTemplate(form), { form }).flags.filter((f) => f.sectionKey === "F-07" && f.code !== "OPEN_GAP"), []);
  assert.deepEqual(buildFormAnswers({ ...old, status: "signed" }, form)["F-07"], { leftBlank: true });
  assert.equal(copyEntries({ ...old, receipt: undefined }, form).find((e) => e.key === "F-07")?.status, "not_applicable");
});

test("B2-4: the review takes the form map's conditions for a report drafted without them, and settles their gaps", async () => {
  const { reviewReducer } = await import("../ui/components/review/use-review-state");
  n = 0;
  const form = formOf([
    field("Restriction required – lifting limit", { answerType: "checkbox", options: ["Can only lift … Kg from waist"], fillSource: { kind: "registration", path: "staff.entry" } as never }),
    field("Lifting limit (kg)", { answerType: "short_text", fillSource: { kind: "clinician_opinion" }, guidance: "Only when the lifting restriction is kept: the most the employee may lift from the waist, in kg." }),
  ]);
  const base = set(reportOf(form), "F-01", { answer: { kind: "checkbox", value: false } });
  const old: Report = { ...base, sections: base.sections.map(({ condition: _c, ...s }) => s), gaps: [{ id: "gap-F-02-x", sectionKey: "F-02", issue: "No clinician recorded a lifting limit.", suggestedQuestion: "What is it?", relatedNoteIds: [], raisedBy: "ai" }] };
  const next = reviewReducer(old, { type: "formConditions", form });
  assert.ok(next.sections.find((s) => s.key === "F-02")?.condition);
  assert.equal(next.gaps[0].resolution?.notApplicable, true);
});

/* B2-5 ------------------------------------------------------------------------------------------------------------------ */

test("B2-5: “Barriers to recovery – details” applies only on “Yes” to the barriers question (10Bridge IA F-41 / F-42)", () => {
  n = 40;
  const form = formOf([
    field("Is there evidence of any barriers to recovery?", { answerType: "yes_no", options: ["Yes", "No"], required: true }),
    field("Barriers to recovery – details", { guidance: "Co-existing conditions, psychological or psychosocial factors recorded, if any." }),
  ], "Initial Assessment Report");
  assert.equal(conditionText(form.fields, "F-42"), "F-41 (“Is there evidence of any barriers to recovery?”) is Yes");
  const report = set(set(reportOf(form), "F-42", { status: "drafted", paragraphs: [{ id: "F-42-p1", text: "One episode of low back pain in 2019; sleeping poorly; off work since 02/09/2026.", sourceIds: ["N-001"], origin: "ai" }] }), "F-41", { answer: { kind: "yes_no", value: false } });
  assert.equal(conditionOf(report.sections, "F-42")?.applies, false);
  assert.match(conditionOf(report.sections, "F-42")?.because ?? "", /“Is there evidence of any barriers to recovery\?” is “No”/);
  assert.deepEqual(buildFormAnswers({ ...report, status: "signed" }, form)["F-42"], { leftBlank: true }, "no barrier details printed under “No”");
  assert.equal(conditionOf(set(report, "F-41", { answer: { kind: "yes_no", value: true } }).sections, "F-42")?.applies, true);
  // A "details" box after an unrelated yes/no stays an ordinary question.
  n = 0;
  const other = formOf([field("Is the patient taking medication?", { answerType: "yes_no" }), field("Barriers to recovery – details")]);
  assert.equal(conditionText(other.fields, "F-02"), null);
});

/* B2-13 ----------------------------------------------------------------------------------------------------------------- */

test("B2-13: restriction status and details do not apply when the activity cell says “None” (10Bridge EOTS F-27 to F-29)", () => {
  n = 26;
  const form = formOf([
    field("Restrictions on daily living – activity", { answerType: "short_text", required: true, guidance: "An activity of daily living still restricted, as recorded (or “None”)." }),
    field("Restrictions on daily living – status", { answerType: "single_choice", options: ["Restricted", "Unable to perform"], guidance: "Restricted or Unable to perform – the other is deleted. Only when an activity is still restricted." }),
    field("Restrictions on daily living – details", { answerType: "short_text", guidance: "The details of that restriction, as recorded." }),
  ]);
  assert.equal(conditionText(form.fields, "F-28"), "F-27 (“Restrictions on daily living – activity”) names one (not “None”)");
  assert.equal(conditionText(form.fields, "F-29"), conditionText(form.fields, "F-28"), "the details follow the status");
  const withActivity = (text: string) => set(reportOf(form), "F-27", { status: "drafted", paragraphs: [{ id: "F-27-p1", text, sourceIds: ["N-002"], origin: "ai" }] });
  const none = withActivity("None");
  assert.equal(notApplicable(none, "F-28")?.because, "“Restrictions on daily living – activity” is “None”");
  assert.equal(notApplicable(none, "F-29")?.applies, false);
  assert.deepEqual(buildFormAnswers({ ...none, status: "signed" }, form)["F-28"], { leftBlank: true }, "prints blank");
  const flags = validateReport(none, formToTemplate(form), { form }).flags;
  assert.deepEqual(flags.filter((f) => (f.sectionKey === "F-28" || f.sectionKey === "F-29") && f.code !== "OPEN_GAP"), [], "no open optional item");
  // Something still restricted: they apply; nothing drafted yet: not known.
  assert.equal(notApplicable(withActivity("Carrying shopping"), "F-28"), null);
  assert.equal(conditionOf(reportOf(form).sections, "F-28")?.applies, null);
});

/* B2-19 ----------------------------------------------------------------------------------------------------------------- */

test("B2-19: attended session dates are filled by code, in date order – CLM “Session date 4”, JJ EOTS “Dates of the treatment sessions”", () => {
  // Gemma-like record: the assessment then four treatment sessions (one missed in between), notes in any order.
  const bundle = testBundle();
  const appts = [
    { id: "A-1", date: "2026-09-08", time: "09:00", status: "ATT" as const, noteId: "N-001" },
    { id: "A-2", date: "2026-09-15", time: "09:00", status: "ATT" as const },
    { id: "A-3", date: "2026-09-22", time: "09:00", status: "DNA" as const },
    { id: "A-5", date: "2026-10-13", time: "09:00", status: "ATT" as const, noteId: "N-002" },
    { id: "A-4", date: "2026-09-29", time: "09:00", status: "ATT" as const },
    { id: "A-6", date: "2026-10-06", time: "09:00", status: "ATT" as const },
  ];
  const record = { ...bundle, appointments: appts };
  const facts = computeFacts(record, { asOf: TEST_FACTS_DATE });
  const date = (label: string, guidance: string) => sessionDatesByCode({ label, guidance, answerType: "date" }, record, facts);
  assert.deepEqual(date("Session date 4", "The date of the 4th attended treatment session after the assessment, if there was one.")?.answer, { kind: "date", value: "2026-10-13" }, "the 4th after the assessment");
  assert.equal(date("Session date 5", "The date of the 5th attended treatment session after the assessment, if there was one."), null, "not in the record (not applicable)");
  assert.deepEqual(date("Session 2 – date", "The date of attended session 2, if there was one.")?.answer, { kind: "date", value: "2026-09-15" }, "Medcare counts the assessment as session 1");
  assert.deepEqual(sessionDatesByCode({ label: "Dates of the treatment sessions", guidance: "The dates of the treatment sessions after the assessment.", answerType: "long_text" }, record, facts)?.text, "15/09/2026, 29/09/2026, 06/10/2026, 13/10/2026", "in date order, the assessment left out");
  assert.equal(sessionDatesByCode({ label: "Dates of any non-attendances", guidance: "", answerType: "short_text" }, record, facts), null);

  n = 15;
  const form = formOf([
    field("Session date – initial assessment", { answerType: "date", fillSource: { kind: "registration", path: "episode.firstSeen" } as never }),
    field("Session date 4", { answerType: "date", guidance: "The date of the 4th attended treatment session after the assessment, if there was one." }),
    field("Session date 7", { answerType: "date", guidance: "The date of the 7th attended treatment session after the assessment, if there was one." }),
    field("Dates of the treatment sessions", { guidance: "The dates of the treatment sessions after the assessment (printed under “Treatment:”)." }),
  ], "(CLM) - EOTS");
  const report = reportOf(form, record);
  const s4 = report.sections.find((s) => s.key === "F-17")!;
  assert.equal(s4.kind, "from_records");
  assert.deepEqual(s4.answer, { kind: "date", value: "2026-10-13" });
  assert.equal(report.sections.find((s) => s.key === "F-19")?.paragraphs[0].text, "15/09/2026, 29/09/2026, 06/10/2026, 13/10/2026");
  assert.deepEqual(planDraftGroups(report, formToTemplate(form)).flat(), [], "never drafted");
  assert.equal(buildFormAnswers({ ...report, status: "signed" }, form)["F-17"]?.value, "2026-10-13");
  assert.deepEqual(validateReport(report, formToTemplate(form), { form }).flags.filter((f) => f.severity === "blocking"), []);
  // B2-24: the session the record does not have is named in one activity entry.
  assert.ok(report.activity.some((a) => a.detail === "Not applicable: F-18 – only 4 treatment sessions after the assessment were attended, so nothing is printed there."));
  // An initial assessment form is drafted as at the assessment: nothing filled from later sessions.
  assert.equal(reportOf(formOf(form.fields, "Initial Assessment Report"), record).sections.find((s) => s.key === "F-17")?.kind, "ai_narrative");
});
