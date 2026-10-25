/**
 * Conditional questions (Blue Heart fix round 2): what a condition depends on (B1-1, B1-9), a yes/no that carries its
 * own condition (B1-5), numbered sessions the record does not have (B1-11), and the one rule the forms engine and
 * "Copy answers" share for a box that does not apply – a person's answer is never dropped silently (B1-1).
 * Labels as printed on Blue Heart's referrer forms; fictional record.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyEntries } from "./answer-copy";
import { computeFacts } from "./computed-facts";
import { conditionOf, conditionText, conditionWanted, factCondition, notApplicable, sessionNotInRecord } from "./conditions";
import { buildFormAnswers, formToTemplate } from "./forms";
import { createFormReport, planDraftGroups } from "./report-factory";
import type { FormDefinition, FormField, Report, ReportSection } from "./types";
import { validateReport, canAcknowledge } from "./validation";
import { TEST_FACTS_DATE, testBundle } from "./validation/test-fixtures";

type Answer = ReportSection["answer"];
const sec = (key: string, title: string, answer?: Answer, extra: Partial<ReportSection> = {}): ReportSection => ({
  key,
  title,
  kind: "ai_narrative",
  status: "drafted",
  fieldId: key,
  paragraphs: [],
  ...(answer ? { answer } : {}),
  ...extra,
});
const yn = (value: boolean | null): Answer => ({ kind: "yes_no", value });
const tick = (value: boolean | null): Answer => ({ kind: "checkbox", value });
const choice = (value: string | null): Answer => ({ kind: "choice", value });

/* Ascenti Initial Assessment, "3. Employment" ------------------------------------------------------------------------ */

const employment = (b: boolean | null, c: boolean | null, d: boolean | null) => [
  sec("F-23", "a. Was the client working prior to the accident?", yn(true)),
  sec("F-24", "b. Has the client had to take time off work as a result of the accident?", yn(b)),
  sec("F-25", "c. Is the client still off work as a result of the accident?", yn(c)),
  sec("F-26", "d. Is the client at work but unable to fulfil all duties as a result of the accident?", yn(d)),
  sec("F-27", "If yes for b, c or d above please provide brief details"),
];

test("B1-1: “If yes for b, c or d above” depends on b, c and d – not on d alone", () => {
  assert.deepEqual(conditionWanted("If yes for b, c or d above please provide brief details"), { wants: "yes", anyOfAbove: false, letters: ["b", "c", "d"] });
  // Gemma: off work since the accident (b Yes, c Yes), d No – the box applies.
  const gemma = conditionOf(employment(true, true, false), "F-27");
  assert.deepEqual(gemma?.controllers.map((s) => s.key), ["F-24", "F-25", "F-26"]);
  assert.equal(gemma?.applies, true);
  // No, No, No – it does not apply, and the reason names all three.
  const none = conditionOf(employment(false, false, false), "F-27");
  assert.equal(none?.applies, false);
  assert.match(none?.because ?? "", /^“b\. Has the client.*” is “No” and “c\. Is the client.*” is “No” and “d\. Is the client.*” is “No”$/);
  // Only d still unknown: nothing decided yet.
  assert.equal(conditionOf(employment(false, false, null), "F-27")?.applies, null);
  // The drafting call names the same three questions.
  const fields = employment(null, null, null).map((s) => ({ id: s.key, label: s.title, answerType: s.answer ? "yes_no" : "long_text" }));
  assert.equal(
    conditionText(fields, "F-27"),
    "any of F-24 (“b. Has the client had to take time off work as a result of the accident?”), F-25 (“c. Is the client still off work as a result of the accident?”) or F-26 (“d. Is the client at work but unable to fulfil all duties as a result of the accident?”) is Yes",
  );
});

test("B1-1: Ascenti discharge “If no for either of the above” depends on a and b", () => {
  const eots = (a: boolean | null, b: boolean | null) => [
    sec("F-26", "Quality of life – further information"),
    sec("F-27", "a. If the client was working prior to the accident but was off work at the time of the assessment, is the client at work now?", yn(a)),
    sec("F-28", "b. If the client is at work, is the client able to fulfil all the duties?", yn(b)),
    sec("F-29", "If no for either of the above, please provide brief details."),
  ];
  assert.deepEqual(conditionWanted("If no for either of the above, please provide brief details."), { wants: "no", anyOfAbove: true, lastTwo: true });
  assert.equal(conditionOf(eots(false, true), "F-29")?.applies, true, "F-27 No / F-28 Yes: it applies");
  assert.deepEqual(conditionOf(eots(false, true), "F-29")?.controllers.map((s) => s.key), ["F-27", "F-28"]);
  assert.equal(conditionOf(eots(true, true), "F-29")?.applies, false);
  // F-27 marked not applicable by the clinician (he was never off work): only F-28 counts.
  const marked = eots(null, true).map((s) => (s.key === "F-27" ? { ...s, markedNotApplicable: { by: "Sarah Reid", at: "2026-10-25T10:00:00.000Z" } } : s));
  assert.equal(conditionOf(marked, "F-29")?.applies, false);
  assert.equal(notApplicable(marked, "F-27")?.because, "the condition does not hold (marked by Sarah Reid)");
});

/* B1-9: more conditions recognised ----------------------------------------------------------------------------------- */

test("B1-9: conditions after a dash, “If you do not …”, “If the condition is worsening”, guidance, headings and “Rationale for further treatment”", () => {
  // "Overnight stay in Hospital - If yes, please provide details" after "Overnight stay in Hospital" = No.
  const hospital = [sec("F-14", "Overnight stay in Hospital", yn(false)), sec("F-15", "Overnight stay in Hospital - If yes, please provide details")];
  assert.equal(conditionOf(hospital, "F-15")?.applies, false);
  const otc = [sec("F-18", "Taken over the counter medicine", yn(false)), sec("F-19", "Taken over the counter medicine - If yes, please provide details and if still taking the medicine")];
  assert.equal(conditionOf(otc, "F-19")?.applies, false);
  // A question that asks its own yes/no and its detail in one box is not conditional.
  assert.equal(conditionWanted("Have any home exercises been recommended? If yes, which?"), null);
  assert.equal(conditionWanted("Was the first appointment within 5 working days? If not, give reason"), null);

  // "If you do not anticipate a full recovery" after "Do you expect … a full recovery?" = Yes.
  const plan = [
    sec("F-54", "Proposed treatment – Home Exercises", tick(true)),
    sec("F-63", "Number of sessions required (excluding the assessment)", { kind: "number", value: "6" }),
    sec("F-66", "Do you expect the client to make a full recovery?", yn(true)),
    sec("F-67", "If you do not anticipate a full recovery, can you provide reasons"),
    sec("F-68", "If you do not recommend home exercises at this stage, please outline the reasons why"),
  ];
  assert.equal(conditionOf(plan, "F-67")?.applies, false);
  assert.deepEqual(conditionOf(plan, "F-68")?.controllers.map((s) => s.key), ["F-54"], "the tick it names, 14 questions before it on the form");
  assert.equal(conditionOf(plan, "F-68")?.applies, false);
  assert.equal(conditionOf(plan, "F-68")?.because, "“Proposed treatment – Home Exercises” is “Ticked”");

  // "If the condition is worsening, what do you recommend?" after "Improving".
  const worse = (v: string | null) => [sec("F-43", "How is the condition following treatment?", choice(v)), sec("F-44", "Do you expect a full recovery – with time, with further treatment or not at all?"), sec("F-46", "If the condition is worsening, what do you recommend?")];
  assert.equal(conditionOf(worse("Improving"), "F-46")?.applies, false);
  assert.equal(conditionOf(worse("Worsening"), "F-46")?.applies, true);
  assert.equal(conditionOf(worse(null), "F-46")?.applies, null);

  // JJ Physio IA: "Lifting limit (kg)", guidance "Only when the lifting restriction is kept…", lifting restriction not ticked.
  const lifting = [
    sec("F-28", "Restriction required – no pushing/pulling", tick(false)),
    sec("F-29", "Restriction required – lifting limit", tick(false)),
    sec("F-30", "Lifting limit (kg)", undefined, { condition: "Only when the lifting restriction is kept: the most the employee may lift from the waist, in kg." }),
  ];
  assert.deepEqual(conditionOf(lifting, "F-30")?.controllers.map((s) => s.key), ["F-29"]);
  assert.equal(conditionOf(lifting, "F-30")?.applies, false);

  // JJ Physio discharge: rows under the printed heading "If employee is not on full duties, …" – work status normal role.
  const heading = "If employee is not on full duties, please list main concerns and time scale for recovery:";
  const jj = (status: string | null) => [
    sec("F-08", "Work status", choice(status)),
    sec("F-09", "Average pain level now (0–10)", choice("2")),
    sec("F-10", "Able to carry out daily non-work activities (%)", choice("90%")),
    sec("F-11", "Able to carry out daily work activities (%)", choice("100%")),
    sec("F-12", "Main concern 1", undefined, { condition: "If the employee is not on full duties: the main problem present." }),
    sec("F-13", "Main concern 1 – related work restriction", undefined, { condition: heading }),
    sec("F-14", "Main concern 1 – full recovery date", { kind: "date", value: null }, { condition: heading }),
  ];
  for (const key of ["F-12", "F-13", "F-14"]) {
    assert.equal(conditionOf(jj("Functioning in normal role or on planned return to work"), key)?.applies, false, key);
    assert.equal(conditionOf(jj("Functioning in role with temporary modifications"), key)?.applies, true, key);
    assert.deepEqual(conditionOf(jj(null), key)?.controllers.map((s) => s.key), ["F-08"], key);
  }

  // 10Bridge discharge: "Rationale for recommending further treatment" after "Is further treatment necessary?" = No.
  const tenBridge = [sec("F-32", "Is further treatment necessary?", yn(false)), sec("F-33", "If yes, the number of additional sessions"), sec("F-34", "Rationale for recommending further treatment")];
  assert.equal(conditionOf(tenBridge, "F-34")?.applies, false);
  assert.equal(conditionOf(tenBridge, "F-33")?.applies, false);
});

test("B1-9: the condition a question carries in its heading or guidance is kept on the report and reaches the drafting call", async () => {
  const { conditionTextOf } = await import("./conditions");
  const heading = "If employee is not on full duties, please list main concerns and time scale for recovery:";
  assert.equal(conditionTextOf({ label: "Main concern 1 – related work restriction", guidance: "How much of their work duties they can undertake.", section: heading }), heading);
  assert.equal(conditionTextOf({ label: "Lifting limit (kg)", guidance: "Only when the lifting restriction is kept: the most the employee may lift from the waist, in kg." }), "Only when the lifting restriction is kept: the most the employee may lift from the waist, in kg.");
  // A heading that is an earlier question's own label is a sub-question, not a condition.
  assert.equal(conditionTextOf({ label: "If yes, details", section: "If off work, since when?" }, [{ label: "If off work, since when?" }]), null);
  assert.equal(conditionTextOf({ label: "Pain VAS", guidance: "The pain score out of 10." }), null);
  const fields = [
    { id: "F-29", label: "Restriction required – lifting limit", answerType: "checkbox" },
    { id: "F-30", label: "Lifting limit (kg)", answerType: "short_text", guidance: "Only when the lifting restriction is kept: the most the employee may lift from the waist, in kg." },
  ];
  assert.equal(conditionText(fields, "F-30"), "F-29 (“Restriction required – lifting limit”) is ticked");
});

/* B1-5: a yes/no that carries its own condition --------------------------------------------------------------------- */

test("B1-5: “a. If the client was … off work at the time of the assessment, is the client at work now?” carries its own condition", () => {
  assert.equal(
    factCondition("a. If the client was working prior to the accident but was off work at the time of the assessment, is the client at work now?"),
    "the client was working prior to the accident but was off work at the time of the assessment",
  );
  assert.equal(factCondition("b. If the client is at work, is the client able to fulfil all the duties?"), "the client is at work");
  assert.equal(factCondition("5. If not, are they fit for modified duties?"), null);
  assert.equal(factCondition("If yes, is it still taken?"), null);
  assert.equal(factCondition("Is the client at work now?"), null);
});

/* The fictional form the rest of the tests complete ------------------------------------------------------------------ */

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

function formOf(fields: FormField[]): FormDefinition {
  return {
    id: "frm_cond_test",
    tenantId: "demo",
    title: "Initial Assessment Report",
    referrer: { name: "Ascenti", type: "mlc" },
    kind: "docx",
    file: { name: "ia.docx", sha256: "a".repeat(64), size: 1000 },
    fields,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "t", at: "2026-10-25T09:00:00.000Z", warnings: [] },
    createdAt: "2026-10-25T09:00:00.000Z",
    updatedAt: "2026-10-25T09:00:00.000Z",
  } as unknown as FormDefinition;
}

function reportOf(form: FormDefinition, bundle = testBundle()): Report {
  return createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle, { asOf: TEST_FACTS_DATE }), id: "rpt_cond", now: new Date("2026-10-25T09:00:00.000Z") });
}

const withAnswers = (report: Report, edit: (s: ReportSection) => ReportSection): Report => ({ ...report, sections: report.sections.map(edit) });

/* B1-1: a box that does not apply never drops a person's answer silently --------------------------------------------- */

test("B1-1: a person's answer in a box that does not apply blocks approval until removed – or acknowledged, then it is printed and copied", () => {
  n = 0;
  const form = formOf([
    field("b. Has the client had to take time off work as a result of the accident?", { answerType: "yes_no", required: true }),
    field("c. Is the client still off work as a result of the accident?", { answerType: "yes_no", required: true }),
    field("d. Is the client at work but unable to fulfil all duties as a result of the accident?", { answerType: "yes_no", required: true }),
    field("If yes for b, c or d above please provide brief details"),
  ]);
  const template = formToTemplate(form);
  const typed = "Off work since 02/09/2026 with a fit note.";
  // All three answered "No" by the clinician, and she typed her own words in F-04 anyway.
  const base = withAnswers(reportOf(form), (s) =>
    s.key === "F-04"
      ? { ...s, status: "complete", paragraphs: [{ id: "F-04-c1", text: typed, sourceIds: [], origin: "clinician" }] }
      : { ...s, status: "complete", answer: { kind: "yes_no", value: false } },
  );
  const result = validateReport(base, template, { form });
  const flag = result.flags.find((f) => f.code === "NOT_APPLICABLE_ANSWERED" && f.sectionKey === "F-04");
  assert.equal(flag?.severity, "blocking");
  assert.match(flag?.message ?? "", /^This box does not apply because “b\. Has the client.*” is “No”.*, so your answer would not be printed\. Remove your answer, or change that answer\./);
  assert.equal(result.canSign, false, "never approved with the answer silently dropped");
  assert.equal(canAcknowledge(flag!, base), true);
  // Until then the form prints nothing there and "Copy answers" copies nothing – the same rule.
  assert.deepEqual(buildFormAnswers({ ...base, flags: result.flags }, form)["F-04"], { leftBlank: true });
  assert.equal(copyEntries({ ...base, flags: result.flags }, form).find((e) => e.key === "F-04")?.status, "not_applicable");
  // Acknowledged with a reason: printed and copied.
  const acked = { ...base, flags: result.flags.map((f) => (f.id === flag!.id ? { ...f, acknowledged: { reason: "The client is off work; the grid was answered for the day of the assessment.", at: "2026-10-25T10:00:00.000Z" } } : f)) };
  assert.equal(buildFormAnswers(acked, form)["F-04"]?.text, typed);
  assert.equal(copyEntries(acked, form).find((e) => e.key === "F-04")?.answer, typed);
  assert.equal(validateReport(acked, template, { form }).canSign, true);
  // A drafted answer in a box that does not apply is simply not asked: no check, nothing printed or copied.
  const drafted = withAnswers(base, (s) => (s.key === "F-04" ? { ...s, paragraphs: [{ id: "F-04-p1", text: typed, sourceIds: ["N-001"], origin: "ai" }] } : s));
  assert.equal(validateReport(drafted, template, { form }).flags.filter((f) => f.sectionKey === "F-04").length, 0);
  assert.deepEqual(buildFormAnswers(drafted, form)["F-04"], { leftBlank: true });
  assert.equal(copyEntries(drafted, form).find((e) => e.key === "F-04")?.answer, null);
});

test("B1-1 invariant: every answer “Copy answers” copies is printed on the form, and every answer printed is copied", () => {
  n = 0;
  const form = formOf([
    field("Has the patient returned to work?", { answerType: "yes_no", required: true }),
    field("If not back at work, expected return to work date", { answerType: "date" }),
    field("ANY FURTHER TREATMENT RECOMMENDED?", { answerType: "yes_no", required: true }),
    field("IF YES, PLEASE DETAIL"),
    field("Session date 1", { answerType: "date", guidance: "The date of the 1st attended treatment session after the assessment, if there was one." }),
    field("Session date 2", { answerType: "date", guidance: "The date of the 2nd attended treatment session after the assessment, if there was one." }),
    field("Present condition"),
    field("If you do not anticipate a full recovery, can you provide reasons"),
  ]);
  const p = (key: string, text: string, origin: "ai" | "clinician" = "ai") => ({ id: `${key}-p`, text, sourceIds: origin === "ai" ? ["N-002"] : [], origin });
  const report = withAnswers(reportOf(form), (s) => {
    switch (s.key) {
      case "F-01": return { ...s, status: "drafted", answer: { kind: "yes_no", value: true }, paragraphs: [p("F-01", "Back at work on 06/05/2026.")] };
      case "F-02": return { ...s, status: "drafted", answer: { kind: "date", value: "2026-06-01" } };
      case "F-03": return { ...s, status: "drafted", answer: { kind: "yes_no", value: false } };
      case "F-04": return { ...s, status: "drafted", paragraphs: [p("F-04", "Three more sessions.")] };
      case "F-05": return { ...s, status: "drafted", answer: { kind: "date", value: "2026-05-06" } };
      case "F-06": return { ...s, status: "complete", answer: { kind: "date", value: "2026-05-20" } };
      case "F-07": return { ...s, status: "drafted", paragraphs: [p("F-07", "Pain 2/10 at worst.")] };
      case "F-08": return { ...s, status: "drafted", paragraphs: [p("F-08", "Not expected.", "clinician")] };
      default: return s;
    }
  });
  const flags = validateReport(report, formToTemplate(form), { form }).flags;
  const full = { ...report, flags };
  const printed = buildFormAnswers(full, form);
  const copied = copyEntries(full, form);
  for (const f of form.fields) {
    const copy = copied.find((e) => e.key === f.id);
    const print = printed[f.id];
    const prints = Boolean(print && !print.leftBlank && ((print.text ?? "").trim() !== "" || (print.value !== undefined && print.value !== null)));
    assert.equal(prints, copy?.answer !== null && copy?.answer !== undefined, `${f.id} “${f.label}”: printed ${prints}, copied “${copy?.answer}”`);
  }
  // The ones that do not apply: F-02 (back at work), F-04 (no further treatment), F-06 (only 1 session after the
  // assessment was attended). F-08 holds the clinician's own words (no recovery question before it: it applies).
  assert.deepEqual(copied.filter((e) => e.status === "not_applicable").map((e) => e.key), ["F-02", "F-04", "F-06"]);
});

/* B1-11: numbered sessions the record does not have ------------------------------------------------------------------- */

test("B1-11: session dates beyond the attended sessions are not applicable – not drafted, no gap, nothing printed", () => {
  // The test record: 2 attended appointments (the assessment and the discharge) and 1 missed.
  assert.equal(sessionNotInRecord({ title: "Session date 2", condition: "The date of the 2nd attended treatment session after the assessment, if there was one." }, testBundle()), "only 1 treatment session after the assessment was attended");
  assert.equal(sessionNotInRecord({ title: "Session date 1", condition: "The date of the 1st attended treatment session after the assessment, if there was one." }, testBundle()), null);
  // Without "after the assessment" the assessment is session 1 (Medcare: "Session 1 – date" is the assessment).
  assert.equal(sessionNotInRecord({ title: "Session 2 – date" }, testBundle()), null);
  assert.equal(sessionNotInRecord({ title: "Session 3 – time" }, testBundle()), "only 2 sessions were attended");
  assert.equal(sessionNotInRecord({ title: "Total sessions attended" }, testBundle()), null);
  // No attended appointment in the record: never assumed.
  assert.equal(sessionNotInRecord({ title: "Session 3 – date" }, { ...testBundle(), appointments: [] }), null);

  n = 0;
  const form = formOf([
    field("Total sessions attended", { answerType: "number", fillSource: { kind: "computed_fact", factId: "FACT-attendance", format: "attended_count" } as never, required: true }),
    field("Session date 7", { answerType: "date", guidance: "The date of the 7th attended treatment session after the assessment, if there was one." }),
    field("Session date 1", { answerType: "date", guidance: "The date of the 1st attended treatment session after the assessment, if there was one." }),
    field("Session 3 – time", { answerType: "short_text", fillSource: { kind: "registration", path: "staff.entry" } as never }),
  ]);
  const report = reportOf(form);
  assert.equal(notApplicable(report, "F-02")?.because, "only 1 treatment session after the assessment was attended");
  assert.equal(notApplicable(report, "F-04")?.because, "only 2 sessions were attended");
  assert.equal(notApplicable(report, "F-03"), null);
  const groups = planDraftGroups(report, formToTemplate(form)).flat();
  assert.ok(groups.indexOf("F-03") >= 0 && groups.indexOf("F-02") < 0, `drafted: ${groups.join(", ")}`);
  assert.deepEqual(report.gaps.filter((g) => g.sectionKey === "F-02" || g.sectionKey === "F-04"), [], "no gap to settle");
  const flags = validateReport(report, formToTemplate(form), { form }).flags;
  assert.deepEqual(flags.filter((f) => f.sectionKey === "F-02" || f.sectionKey === "F-04"), [], "nothing blocks and nothing warns");
  assert.deepEqual(buildFormAnswers({ ...report, flags, status: "signed" }, form)["F-02"], { leftBlank: true });
});

test("B1-5: marked not applicable by the clinician – audited, its gap settled, nothing printed; answering it takes the mark off", async () => {
  const { reviewReducer } = await import("../ui/components/review/use-review-state");
  n = 0;
  const label = "a. If the client was working prior to the accident but was off work at the time of the assessment, is the client at work now?";
  const form = formOf([
    field(label, { answerType: "yes_no", required: true }),
    field("b. If the client is at work, is the client able to fulfil all the duties?", { answerType: "yes_no", required: true }),
    field("If no for either of the above, please provide brief details."),
  ]);
  const template = formToTemplate(form);
  const gap = { id: "gap-F-01-t1-condition", sectionKey: "F-01", issue: `This question applies only if the client was … at the time of the assessment.`, suggestedQuestion: "Does it apply?", relatedNoteIds: ["N-001"], raisedBy: "system" as const };
  const report: Report = {
    ...withAnswers(reportOf(form), (s) => ({ ...s, status: s.key === "F-03" ? "drafted" : "needs_input", ...(s.answer ? { answer: { kind: "yes_no" as const, value: s.key === "F-02" ? true : null } } : {}) })),
    gaps: [gap],
  };
  assert.equal(validateReport(report, template, { form }).canSign, false, "required and its gap open");
  const marked = reviewReducer(report, { type: "markNotApplicable", key: "F-01", on: true, actor: "Sarah Reid" });
  const s1 = marked.sections.find((s) => s.key === "F-01")!;
  assert.equal(s1.markedNotApplicable?.by, "Sarah Reid");
  assert.deepEqual(s1.answer, { kind: "yes_no", value: null });
  assert.equal(marked.gaps[0].resolution?.text, "Not applicable: the condition does not hold (marked by Sarah Reid).");
  assert.ok(marked.activity.some((a) => a.actor === "Sarah Reid" && a.detail.startsWith("F-01: marked not applicable")));
  // F-02 "Yes" and F-01 not applicable: "If no for either of the above" does not apply either.
  assert.equal(notApplicable(marked, "F-03")?.applies, false);
  const result = validateReport(marked, template, { form });
  assert.deepEqual(result.flags.filter((f) => f.sectionKey === "F-01"), [], "no “required, no answer”");
  assert.equal(result.canSign, true);
  assert.deepEqual(buildFormAnswers({ ...marked, status: "signed" }, form)["F-01"], { leftBlank: true });
  // Answered after all: the mark is gone and its gap is settled by the answer.
  const answered = reviewReducer(marked, { type: "setAnswer", key: "F-01", value: true, actor: "Sarah Reid" });
  const s2 = answered.sections.find((s) => s.key === "F-01")!;
  assert.equal(s2.markedNotApplicable, undefined);
  assert.equal(answered.gaps[0].resolution?.byAnswer, true);
  // An older draft that answered it while its own supporting text says the condition does not hold: blocked.
  const old = withAnswers(report, (s) =>
    s.key === "F-01"
      ? { ...s, status: "drafted", answer: { kind: "yes_no", value: false }, paragraphs: [{ id: "F-01-p1", text: "On 15/07/2026 Mr Ellery told me he had taken 3 days off work and then returned to normal duties, so he was not off work at the time of the assessment.", sourceIds: ["N-001"], origin: "ai" }] }
      : s,
  );
  const flag = validateReport({ ...old, gaps: [] }, template, { form }).flags.find((f) => f.code === "NOT_APPLICABLE_ANSWERED" && f.sectionKey === "F-01");
  assert.equal(flag?.severity, "blocking");
  assert.match(flag?.message ?? "", /^The condition does not hold – check this answer\./);
  assert.equal(canAcknowledge(flag!, old), false);
});
