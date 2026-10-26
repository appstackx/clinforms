/**
 * bh2 WD: the DRAFT_FIT parts – repeats (advisory; never across an initial/current pair; printed labels; numerals and
 * reporting frames ignored), the shorten triggers, the time point, dated leads, doses, wording fragments and the
 * printed lead – on fictional reports. Also pins R-regression-6 (no drafting-only "In words:" text in a printed fact).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SOLICITOR_RTA_TEMPLATE } from "../../templates/registry";
import { computeFacts } from "../computed-facts";
import { formToTemplate } from "../forms";
import { createFormReport } from "../report-factory";
import { initialAssessmentView } from "../scope";
import type { FormDefinition, FormField, Paragraph, Report, ReportFlag } from "../types";
import { runValidators } from "./index";
import { repeatsPrintedVerb, withoutPrintedVerb } from "./draft-fit/printed-lead";
import { sentencesRepeat, nameWords, timePointPair } from "./draft-fit/repeats";
import { shortenTrigger, valueOnlyText } from "./draft-fit/shorten";
import { undosedMedicine } from "./draft-fit/measure";
import { wordingFragment } from "./draft-fit/fragments";
import { TEST_FACTS_DATE, testBundle, testReport, withSection } from "./test-fixtures";

const AT = "2026-10-06T09:00:00.000Z";
const SOL = SOLICITOR_RTA_TEMPLATE;
let n = 0;
const ai = (text: string, sourceIds = ["N-001"]): Paragraph => ({ id: `wd-p${++n}`, text, sourceIds, origin: "ai", basis: "clinician_observed" });

function cell(id: string, label: string, rest: Partial<FormField> = {}): FormField {
  return { id, label, guidance: "", answerType: "short_text", anchor: { kind: "docx", target: "table_cell", blockId: `t0.r${id.slice(2)}.c1` }, fillSource: { kind: "notes_narrative" }, required: false, confidence: "high", ...rest };
}
function box(id: string, label: string, rest: Partial<FormField> = {}): FormField {
  return { id, label, guidance: "", answerType: "long_text", anchor: { kind: "docx", target: "after_paragraph", blockId: `p${id.slice(2)}` }, fillSource: { kind: "notes_narrative" }, required: false, confidence: "high", ...rest };
}
function form(title: string, fields: FormField[], analysis: Partial<FormDefinition["analysis"]> = {}): FormDefinition {
  return {
    id: "frm_wd_test",
    tenantId: "demo",
    referrer: { name: "Example Case Services (fictional)", type: "mlc" },
    title,
    file: { fileName: "wd.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: "a".repeat(64), sizeBytes: 1 },
    kind: "docx",
    fields,
    status: "confirmed",
    analysis: { mode: "rules", promptVersion: "t", at: AT, warnings: [], ...analysis },
    confirmed: { by: "Test", at: AT },
    createdAt: AT,
    updatedAt: AT,
  };
}
function formReport(f: FormDefinition, answers: Record<string, Paragraph[]>): Report {
  const bundle = testBundle();
  const base = createFormReport({ form: f, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle, { asOf: TEST_FACTS_DATE }), id: "rpt_wd", now: new Date(AT), author: { name: "Sarah Reid", hcpc: "PH-DEMO-01" } });
  return { ...base, sections: base.sections.map((s) => (answers[s.key] ? { ...s, paragraphs: answers[s.key] } : s)) };
}
function draftFit(report: Report, f?: FormDefinition): ReportFlag[] {
  const template = f ? formToTemplate(f) : SOL;
  return runValidators({ report, bundle: report.bundleSnapshot, template, computedFacts: computeFacts(report.bundleSnapshot, { asOf: TEST_FACTS_DATE }), ...(f ? { form: f } : {}) }).filter((x) => x.code === "DRAFT_FIT");
}

test("repeats: alphabetic content words only, ≥0.8 of the shorter sentence; numerals, units and the reporting frame never count", () => {
  const names = nameWords(testBundle());
  assert.ok(sentencesRepeat("Mr Testcase reported that he had been off work since 13/03/2026 with a fit note.", "On 18/03/2026 Sarah Reid, physiotherapist, recorded that Mr Testcase had been off work since 13/03/2026 with a fit note.", names), "B3-11 (b): a repeat behind a date lead and an attribution");
  assert.equal(sentencesRepeat("Gym sessions 2–3 times a week.", "Headaches 3–4 times a week.", names), false, "B3-11 (a): numerals and frequency words");
  assert.equal(sentencesRepeat("Exercises daily.", "Exercises daily.", names), false, "fewer than 5 words is a value, not a sentence");
  assert.ok(timePointPair("Lumbar flexion – at first assessment", "Lumbar flexion – now"));
  assert.ok(timePointPair("Objective markers – Initial assessment", "Objective markers – Current assessment"));
  assert.equal(timePointPair("Mechanism of injury", "Objective findings"), false);
});

test("R-regression-4: an initial and a current measurement are never a repeat; R-regression-7: built-in messages use titles and say 'in this report'", () => {
  const f = form("Treatment Summary Report", [cell("F-13", "Lumbar flexion – at first assessment"), cell("F-14", "Lumbar flexion – now"), box("F-31", "Mechanism of injury"), box("F-32", "Objective findings")]);
  const r = formReport(f, {
    "F-13": [ai("Lumbar flexion was 50% of normal range, with pain at end range.")],
    "F-14": [ai("Lumbar flexion was 90% of normal range, with pain at end range.", ["N-002"])],
  });
  assert.deepEqual(draftFit(r, f).filter((x) => (x.evidence ?? "").startsWith("repeat")), []);

  const builtIn = withSection(
    withSection(testReport(SOL), "incident_history", [ai("Mr Testcase described pain across the lower back after lifting a box at work.")]),
    "presenting_complaints",
    [ai("Mr Testcase described pain across the lower back after lifting a box at work.")],
  );
  const flag = draftFit(builtIn).find((x) => x.sectionKey === "presenting_complaints" && (x.evidence ?? "").startsWith("repeat"));
  assert.ok(flag);
  assert.equal(flag.severity, "warning", "advisory");
  assert.match(flag.message, /^This repeats what “History of the incident \(as reported\)” says in this report: /);
  assert.doesNotMatch(flag.message, /incident_history|presenting_complaints|on the form/);
});

test("numbered rows: an identical name cell blocks and may be acknowledged; a frequency column is never compared", () => {
  const f = form("Initial Assessment Report", [cell("F-28", "Activity 1"), cell("F-29", "Activity 1 – frequency"), cell("F-32", "Activity 2"), cell("F-33", "Activity 2 – frequency")]);
  const r = formReport(f, { "F-28": [ai("Running")], "F-29": [ai("Twice a week")], "F-32": [ai("Running")], "F-33": [ai("Twice a week")] });
  const flags = draftFit(r, f).filter((x) => (x.evidence ?? "").startsWith("repeat"));
  assert.equal(flags.length, 1);
  assert.equal(flags[0].sectionKey, "F-32");
  assert.equal(flags[0].severity, "blocking");
  assert.equal(flags[0].ackPolicy, "member");
});

test("shorten names its real trigger; 'None reported', '(dose not stated)' and a date mid-sentence are not triggers (B2-14, B3-12)", () => {
  const f = cell("F-12", "Pain now (0-10)");
  assert.equal(shortenTrigger("None reported.", f), null);
  assert.equal(shortenTrigger("Ibuprofen (dose not stated)", f), null);
  assert.equal(shortenTrigger("He lifted a 20 kg parcel at work on 12/03/2026.", f), null);
  assert.equal(shortenTrigger("On 06/05/2026 Tom Ellis recorded pain of 2/10.", f)?.kind, "date");
  assert.equal(shortenTrigger("2/10 at worst, assessed by Tom Ellis.", f)?.kind, "attribution");
  assert.equal(shortenTrigger("pain at worst after long shifts on the delivery round with lifting and driving all day long", f)?.kind, "length");
  assert.equal(shortenTrigger("pain at worst after long shifts on the delivery round with lifting and driving all day long", cell("F-15", "Pain score with how it feels", { guidance: "The score and the symptoms, on up to 2 lines." })), null);
});

test("value-only keeps the value and never drops a dated attribution (B2-16, B1-6)", () => {
  assert.equal(valueOnlyText("7/10 at worst, as recorded by Sarah Reid using the Numeric Pain Rating Scale."), "7/10 at worst");
  assert.equal(valueOnlyText("50% limited, measured by Sarah Reid on 18/03/2026."), null);
  assert.equal(valueOnlyText("Full and pain-free."), null);
});

test("time point: a later note on an initial assessment form, an earlier note for 'now' on a discharge form, a date no source has", () => {
  const ia = form("Initial Assessment Report", [box("F-12", "Current medication")]);
  const iaFlags = draftFit(formReport(ia, { "F-12": [ai("He was working amended duties.", ["N-002"])] }), ia);
  assert.ok(iaFlags.some((x) => (x.evidence ?? "").startsWith("later note 2026-05-06")));

  const dc = form("Treatment Summary Report", [box("F-20", "Current medication"), box("F-21", "Mechanism of injury")]);
  const dcFlags = draftFit(formReport(dc, { "F-20": [ai("He was taking no medication.", ["N-001"])], "F-21": [ai("At the discharge assessment on 16/09/2026 I recorded the injury.", ["N-001"])] }), dc);
  assert.ok(dcFlags.some((x) => x.sectionKey === "F-20" && (x.evidence ?? "").startsWith("earlier note 2026-03-18")));
  assert.ok(dcFlags.some((x) => x.sectionKey === "F-21" && x.evidence === "date 16/09/2026"), "B3-7: dated to a day none of its sources has");
  assert.ok(dcFlags.every((x) => x.severity === "warning"));
});

test("B1-21: the initial assessment view keeps the next appointment, as booked, without its note", () => {
  const view = initialAssessmentView(testBundle());
  assert.ok(view);
  const later = view.bundle.appointments.filter((a) => a.date > view.date);
  assert.equal(later.length, 1);
  assert.equal(later[0].status, "BOOKED");
  assert.ok(view.bundle.notes.every((x) => x.date <= view.date));
});

test("dose (B3-12): a medicine taken without a dose that no cited note gives", () => {
  assert.equal(undosedMedicine("He was taking ibuprofen.", "Taking ibuprofen."), "ibuprofen");
  assert.equal(undosedMedicine("He was taking ibuprofen 400 mg three times a day.", ""), null);
  assert.equal(undosedMedicine("He was taking ibuprofen.", "Ibuprofen 400 mg tds."), null, "the note gives it: the clinician adds it");
  assert.equal(undosedMedicine("He stopped taking ibuprofen.", ""), null);
});

test("wording fragments are flagged; the drafting's house style is not (B1-3, B3-13)", () => {
  assert.ok(wordingFragment("On 15/07/2026: in my assessment mild travel anxiety when driving."));
  assert.ok(wordingFragment("Lumbar movement was full at discharge. so there is no 4th session."));
  assert.equal(wordingFragment("On 20/10/2026 Tom Ellis, physiotherapist, assessed the sprain as resolving well, and recorded that Mrs Whitlock was not yet back at netball."), null);
  assert.equal(wordingFragment("Mr. Testcase reported approx. 3 weeks of pain, e.g. on stairs and kneeling."), null);
});

test("printed lead (B2-8, B3-8): a repeated printed verb blocks, from analysis.printedLeads or the guidance, and the fix takes it out", () => {
  assert.ok(repeatsPrintedVerb("returning to work as a senior care assistant", "To return to"));
  assert.ok(repeatsPrintedVerb("Walking the dog daily (shorter walks at present) and returning to work as a carer", "To return to"));
  assert.equal(repeatsPrintedVerb("lighter work", "To return to"), false);
  assert.equal(withoutPrintedVerb("returning to work as a senior care assistant", "To return to"), "work as a senior care assistant");
  assert.equal(withoutPrintedVerb("Walking the dog daily (shorter walks at present) and returning to work as a carer", "To return to"), "Walking the dog daily (shorter walks at present) and work as a carer");
  assert.equal(withoutPrintedVerb("walking the dog every day, returning to work", "To return to"), "walking the dog every day and work");

  const blank = (guidance: string): FormField => cell("F-09", "Goal", { guidance, anchor: { kind: "docx", target: "replace_placeholder", blockId: "t0.r9.c1", placeholderText: "…" } });
  const byGuidance = form("Initial Assessment Report", [blank("Completes the printed words “To return to”.")]);
  const flags = draftFit(formReport(byGuidance, { "F-09": [ai("returning to work as a senior care assistant")] }), byGuidance).filter((x) => x.evidence === "printed lead");
  assert.equal(flags.length, 1);
  assert.equal(flags[0].severity, "blocking");
  const byAnalysis = form("Initial Assessment Report", [blank("The answer goes where the template shows “…”.")], { printedLeads: { "F-09": "To return to" } });
  assert.equal(draftFit(formReport(byAnalysis, { "F-09": [ai("returning to work")] }), byAnalysis).filter((x) => x.evidence === "printed lead").length, 1, "B3-8: the lead from the template, not the guidance");
});

test("R-regression-6: a printed fact never carries drafting-only 'In words:' text", () => {
  for (const fact of computeFacts(testBundle(), { asOf: TEST_FACTS_DATE })) assert.doesNotMatch(`${fact.value} ${fact.detail}`, /In words:/);
});
