/**
 * bh2 WE (data, maps and mapping page): the stored map is the single source of truth. Fictional data and ClinForms'
 * own wording only.
 *
 * - map lint (core/form-map-lint.ts): messages never quote the form's wording; the bundled sample maps are clean; the
 *   generator's own wording passes L3 (T6 – never "filled from the record" for a clinic detail or a staff entry);
 * - record paths (T7): the 14th of 14 sessions, a session the record does not have, index 31 refused, address parts above
 *   12 still refused; episode.attendedDates {fromSession, of?};
 * - session dates filled by code only for maps that do not name them (sessionDatesByCode, B2-19);
 * - one outline for the review and the mapping page (CLM-, Proclaim-, Bodycare- and 10Bridge-like structures);
 * - guidance: a v2 map as stored, an earlier map as it reads now; the field editor saves the stored text (B1-16);
 * - L5 at /forms/confirm (blocking; acceptance only by a clinician, server-stamped, audited) and on a store PUT to
 *   confirmed status.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { bindHandler, type MedreportHandler } from "@/modules/medreport/api/http";
import { handleFormsConfirm } from "@/modules/medreport/api/handlers/forms-confirm";
import { handleStoreFormPut } from "@/modules/medreport/api/handlers/store-forms";
import { verifyFormConfirmation, withAttestedConfirmation } from "@/modules/medreport/auth/attestations";
import { buildDocxOutline } from "@/modules/medreport/forms/docx-outline";
import { bindPracticeMergeCodes } from "@/modules/medreport/ai/practice-merge-binding";
import { computeFacts } from "@/modules/medreport/core/computed-facts";
import { acceptanceFor, lintFormMap, lintErrors, lintSummary, judgementOf } from "@/modules/medreport/core/form-map-lint";
import { classifyPortalQuestion } from "@/modules/medreport/core/question-set";
import { resolveRegistrationValue } from "@/modules/medreport/core/forms";
import { currentGuidance, guidanceIsCurrent, withheldReference } from "@/modules/medreport/core/forms/guidance";
import { UNTITLED_HEADING, formOutline } from "@/modules/medreport/core/forms/headings";
import { createFormReport } from "@/modules/medreport/core/report-factory";
import { FormFieldSchema, GUIDANCE_VERSION } from "@/modules/medreport/core/schemas";
import { mapsSessionsExplicitly, sessionDatesByCode, sessionQuestionOf } from "@/modules/medreport/core/session-dates";
import type { AuditEvent } from "@/modules/medreport/api/deps";
import type { Appointment, EpisodeBundle, FormDefinition, FormField } from "@/modules/medreport/core/types";
import { SAMPLE_FORMS } from "@/modules/medreport/forms/samples/registry";
import { buildDocx, buildBundle, CORPUS_TENANT } from "@/modules/medreport/core/validation/__corpus__/harness/fixtures";
import { buildForm } from "@/modules/medreport/core/validation/__corpus__/harness/build";
import { createHttpHarness } from "@/modules/medreport/core/validation/__corpus__/harness/http";
import { buildQuestionGroups } from "@/modules/medreport/ui/components/review/status";
import { guidanceForEditing } from "@/modules/medreport/ui/components/forms/field-editor";
import { firstQuestionToCheck, judgementConfirmProblem, mappingGroups, mappingLint, mayAcceptJudgement } from "@/modules/medreport/ui/components/forms/mapping";

const AT = "2026-10-26T09:00:00.000Z";

const field = (id: string, patch: Partial<FormField> = {}): FormField =>
  ({
    id,
    label: `Question ${id}`,
    guidance: "",
    answerType: "short_text",
    anchor: { kind: "docx", target: "table_cell", blockId: `t0.r${Number(id.slice(2))}.c1` },
    fillSource: { kind: "notes_narrative" },
    required: false,
    confidence: "high",
    ...patch,
  }) as FormField;

const map = (fields: FormField[], analysis: Partial<FormDefinition["analysis"]> = {}): FormDefinition => ({
  id: "frm_we_test",
  tenantId: CORPUS_TENANT,
  referrer: { name: "Orchard Case Management (fictional)", type: "case_manager" },
  title: "Discharge Report (fictional)",
  file: { fileName: "orchard.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: "a".repeat(64), sizeBytes: 100 },
  kind: "docx",
  fields,
  status: "proposed",
  analysis: { mode: "rules", promptVersion: "test", at: AT, warnings: [], ...analysis },
  createdAt: AT,
  updatedAt: AT,
});

/* ------------------------------------------------------------------------------------------------
 * Map lint
 * ----------------------------------------------------------------------------------------------*/

describe("map lint (core/form-map-lint.ts)", () => {
  test("messages are ClinForms' own words: they never quote the form's label, guidance or note", () => {
    const f = map([
      field("F-01", { label: "Zebra-crossing fitness for zoo duty?", fillSource: { kind: "registration", path: "staff.entry" }, guidance: "Quokka unanswered, the printed default stays", note: "Ask the quokka keeper what it means" }),
      field("F-02", { label: "Session 3 – date", answerType: "date" }),
    ]);
    const issues = lintFormMap(f);
    assert.deepEqual(lintSummary(lintErrors(issues)), "L1@F-01, L2@F-01, L5@F-01, L6@F-02");
    for (const i of issues) for (const word of ["Zebra", "zoo", "Quokka", "quokka"]) assert.ok(!i.message.includes(word), `${i.rule}: ${i.message}`);
  });

  test("the bundled sample maps are clean (no false finding on a printed label blank, a question that is its own heading)", async () => {
    for (const s of SAMPLE_FORMS) {
      for (const load of [s.loadForm, s.loadPrewrittenAnalysis]) {
        const form = await load?.();
        if (form) assert.deepEqual(lintErrors(lintFormMap(form)), [], s.id);
      }
    }
  });

  test("T6: the clinic-system code reading never words a clinic detail or a staff entry as 'filled from the record' (L3 clean)", async () => {
    const layout = [
      { p: "Practice: <<P_LOCATION_NAME>>" },
      { p: "Clinic address: <<P_LOCATION_ADDRESS1>>, <<P_LOCATION_ADDRESS2>>" },
      { p: "Clinic postcode: <<P_LOCATION_POSTCODE>>" },
      { p: "Hospital number: <<P_HOSP_NUM>>" },
      { p: "Something else: <<P_CORPUS_UNKNOWN>>" },
      { p: "Patient: <<P_SURNAME>>" },
    ];
    const parsed = buildDocxOutline(buildDocx(layout));
    const r = bindPracticeMergeCodes({ kind: "docx", blocks: parsed.blocks, warnings: [] }, []);
    const clinicOrStaff = r.fields.filter((f) => f.fillSource.kind === "registration" && (f.fillSource.path.startsWith("clinic.") || f.fillSource.path === "staff.entry"));
    assert.ok(clinicOrStaff.length >= 4, JSON.stringify(r.fields.map((f) => [f.id, f.fillSource])));
    for (const f of clinicOrStaff) {
      assert.doesNotMatch(`${f.note ?? ""} ${f.guidance}`, /\bfilled from the record\b/i, f.id);
      if (f.fillSource.kind === "registration" && f.fillSource.path === "staff.entry") assert.match(f.guidance, /^(?:Printed as “[^”]*”\. )?Entered by staff on each report: /, f.id);
      else assert.match(`${f.note} ${f.guidance}`, /From your Clinic details/, f.id);
    }
    // The patient's record is still "filled from the record".
    assert.ok(r.fields.some((f) => f.fillSource.kind === "registration" && f.fillSource.path.startsWith("patient.") && /filled from the record/i.test(`${f.note} ${f.guidance}`)));
    assert.deepEqual(lintErrors(lintFormMap(map(r.fields))).filter((i) => i.rule === "L3"), []);
  });

  test("L5 kinds: judgement wording in the label or options; patient-reported facts and red flags are not judgements", () => {
    assert.equal(judgementOf({ label: "Reason the problem began", options: ["At work", "Worse because of work", "Not related to work"] }), "causation");
    assert.equal(judgementOf({ label: "Any yellow flags?" }), "yellow flags");
    assert.equal(judgementOf({ label: "Declaration: I confirm the identity documents were seen" }), "a declaration");
    assert.equal(judgementOf({ label: "Job title" }), null);
    assert.equal(judgementOf({ label: "Usual duties (as described)" }), null);
    assert.equal(judgementOf({ label: "Red flags noted" }), null);
    assert.equal(judgementOf({ label: "Date returned to work" }), null);
  });

  // check-WE M1: the judgement questions L5 must see – every kind of the plan's list, in other words, plus explicit
  // opinion questions and recommendations (fictional labels in ClinForms' own wording). The corpus pins the same
  // shapes (LINT-l5-recall-*, LINT-l5-fact-*) through lintFormMap.
  const RECALL: Array<[string, string[]?]> = [
    ["Fit to resume normal duties?", ["Yes", "No"]],
    ["Is the claimant able to drive a car?", ["Yes", "No"]],
    ["Can the employee lift boxes at work?", ["Yes", "No"]],
    ["Is the member capable of their usual role?"],
    ["Suitable for full shifts?"],
    ["Is the patient ready to go back to the warehouse?"],
    ["Should the claimant stay off work for now?"],
    ["Work restrictions advised"],
    ["Lighter duties needed?"],
    ["Lifting limit at work (kg)"],
    ["Was the knee injury sustained in the collision?", ["Yes", "No"]],
    ["Symptoms resulting from the fall at work"],
    ["Is the back pain the result of the lift at work?"],
    ["Details of injuries directly related to the crash"],
    ["Aggravation of a pre-existing condition?"],
    ["Any unrelated conditions?"],
    ["Expected date the shoulder is better"],
    ["Anticipated number of weeks to discharge"],
    ["Is more progress likely?"],
    ["Maximum improvement reached?"],
    ["Time until full recovery (weeks)"],
    ["Symptoms all gone by the final session?", ["Yes", "No"]],
    ["Has the back settled?"],
    ["Is the patient symptom-free now?"],
    ["Status at discharge", ["Resolved", "Improving", "No change"]],
    ["Returned to pre-injury level?"],
    ["Any permanent loss of movement?"],
    ["Will the condition become chronic?"],
    ["Some lasting weakness?"],
    ["Ongoing impairment"],
    ["Factors delaying recovery"],
    ["Issues stopping a return to the office"],
    ["Emotional state since the accident"],
    ["Social factors to consider"],
    ["Statement of truth (tick)", ["Yes"]],
    ["Sign-off wording", ["I agree"]],
    ["Return to work recommended?"],
    ["Should the patient continue with physiotherapy?"],
    ["Further sessions needed?"],
    ["Appointments required from now on"],
    ["Is treatment still appropriate?"],
    ["In your opinion, is the wrist improving?"],
    ["Do you consider the shoulder injury minor?"],
    ["Would you expect the ankle to heal?"],
  ];
  // Facts that only look like judgements: a fit note, a restriction of movement, a return that happened, "due to start",
  // a recommendation already made, history, a second opinion obtained.
  const FACTS = [
    "Is the claimant back at work already?",
    "Date returned to work",
    "Fit note from the GP received?",
    "Fitness level before the fall, in the patient's words",
    "Lumbar range – restricted",
    "Restriction to movement on examination",
    "Treatment due to start on",
    "Aggravating factors",
    "Injuries noted at the first session",
    "Has a home programme been recommended?",
    "Long-term medication",
    "Chronic conditions in the medical history",
    "Second opinion obtained?",
    "Visits attended so far",
    "Was the claimant working before the incident?",
    "Advice given at the session",
    "Patient's goals – hobbies to take up again",
    "Benefit of treatment – hobbies to take up again",
    "If yes, the treatment needed",
    "Mechanism of injury",
  ];

  test("L5 recall: every judgement kind in other words, on a drafted, staff or fixed source (check-WE M1)", () => {
    const missed = RECALL.filter(([label, options]) => judgementOf({ label, options }) === null).map(([l]) => l);
    assert.deepEqual(missed, []);
    const sources: FormField["fillSource"][] = [{ kind: "notes_narrative" }, { kind: "registration", path: "staff.entry" }, { kind: "fixed", value: "No" }];
    for (const fillSource of sources) {
      for (const [label, options] of RECALL) {
        const f = field("F-01", { label, ...(options ? { options, answerType: options.length === 2 ? "yes_no" : "single_choice" } : {}), fillSource });
        assert.ok(lintErrors(lintFormMap(map([f]))).some((i) => i.rule === "L5"), `${label} (${fillSource.kind})`);
      }
    }
    // A clinician's own answer, a box left blank and a sign-off are never L5.
    for (const fillSource of [{ kind: "clinician_opinion" }, { kind: "leave_blank" }] as FormField["fillSource"][]) {
      assert.deepEqual(lintErrors(lintFormMap(map([field("F-01", { label: "Fit to resume normal duties?", fillSource })]))), []);
    }
  });

  test("L5 precision: facts that only look like judgements are not judgements", () => {
    assert.deepEqual(FACTS.filter((label) => judgementOf({ label }) !== null).map((l) => `${l} → ${judgementOf({ label: l })}`), []);
  });

  test("one vocabulary: every question the question classifier gives the clinician is a judgement to L5 (documented exceptions only)", () => {
    // The classifier counts any restriction (an examination's restriction of movement too), any "recommended" (one
    // already made too), any "long-term" (medication in the history too) and any "opinion" (a second opinion obtained
    // too) as the clinician's: L5 leaves those facts to the notes.
    const EXCEPTIONS = new Set(["Restriction to movement on examination", "Has a home programme been recommended?", "Long-term medication", "Second opinion obtained?"]);
    const labels = [...RECALL.map(([l]) => l), ...FACTS];
    const drift = labels.filter((l) => classifyPortalQuestion(l).fillSource.kind === "clinician_opinion" && !EXCEPTIONS.has(l) && judgementOf({ label: l }) === null);
    assert.deepEqual(drift, []);
    for (const l of Array.from(EXCEPTIONS)) assert.equal(classifyPortalQuestion(l).fillSource.kind, "clinician_opinion", `${l}: still an exception`);
  });

  test("the acceptance needs a reason that says something: a blank one accepts nothing (lint, load-forms, confirm and store alike)", () => {
    const f = field("F-01", { label: "Fit to resume normal duties?", lintAccepted: [{ rule: "L5", reason: "   ", at: AT }] });
    assert.deepEqual(lintSummary(lintErrors(lintFormMap(map([f])))), "L5@F-01");
    assert.equal(acceptanceFor(f, "L5"), undefined);
    assert.ok(acceptanceFor({ lintAccepted: [{ rule: "L5", reason: "The patient reports it.", at: AT }] }, "L5"));
  });

  test("L1 and L3 recall: preparer's notes and record wording in other words (check-WE minors 5, 6)", () => {
    const notes = [
      "Need to ask the owner what this box is for.",
      "Owner to confirm whether this is required.",
      "Waiting on the clinic's answer about the score.",
      "Pending the owner's reply.",
      "Query for the owner: is the solicitor always typed?",
      "Double-check against the printed copy on Monday.",
      "To do: map the second row.",
      "Fixed 24/10: was the wrong cell.",
      "Previously mapped as a staff entry.",
      "Changed from drafted to the record.",
      "We still need the owner's decision here.",
      "I have assumed the top row; confirm later.",
    ];
    assert.deepEqual(notes.filter((note) => !lintErrors(lintFormMap(map([field("F-01", { note })]))).some((i) => i.rule === "L1")), []);
    const forStaff = ["Ask the patient whether they still take it.", "The top row is used; the rows below stay empty.", "Tick the box that matches the notes.", "The clinician picks the answer on every report."];
    assert.deepEqual(forStaff.filter((note) => lintErrors(lintFormMap(map([field("F-01", { note })]))).some((i) => i.rule === "L1")), []);
    const record = ["Taken from the records.", "From the clinic's record: the site name.", "Comes from the patient records.", "Read from the record."];
    const clinicField = (guidance: string) => field("F-01", { guidance, fillSource: { kind: "registration", path: "clinic.name" } });
    assert.deepEqual(record.filter((g) => !lintErrors(lintFormMap(map([clinicField(g)]))).some((i) => i.rule === "L3")), []);
    assert.deepEqual(lintErrors(lintFormMap(map([clinicField("From your Clinic details.")]))), []);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Record paths (T7) and session dates
 * ----------------------------------------------------------------------------------------------*/

function bundleWith(attended: number, missedAfter?: number): EpisodeBundle {
  const b = buildBundle("owen", CORPUS_TENANT);
  const appointments: Appointment[] = [];
  for (let i = 0; i < attended; i++) {
    const day = String(1 + i).padStart(2, "0");
    appointments.push({ id: `A-${100 + i}`, date: `2026-09-${day}`, time: "18:00", status: "ATT", noteId: b.notes[i % b.notes.length]?.id });
    if (missedAfter === i) appointments.push({ id: `A-${200 + i}`, date: `2026-09-${day}`, time: "19:00", status: "DNA", reason: "Unwell (fictional)" });
  }
  return { ...b, appointments };
}

const ctxOf = (bundle: EpisodeBundle) => ({ bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle, { asOf: "2026-10-26" }), reportDate: "2026-10-26" });

describe("record paths: attended sessions (T7) and the list of attended dates", () => {
  test("attendedDate 14 of 14 resolves; a session the record does not have prints nothing; times too", () => {
    const ctx = ctxOf(bundleWith(14));
    assert.equal(resolveRegistrationValue("episode.attendedDate", ctx, "date", { index: 14, of: 14 })?.value, "2026-09-14");
    assert.equal(resolveRegistrationValue("episode.attendedTime", ctx, "short_text", { index: 14, of: 14 })?.text, "18:00");
    const short = ctxOf(bundleWith(3));
    assert.deepEqual(resolveRegistrationValue("episode.attendedDate", short, "date", { index: 10, of: 14 })?.blank, true, "the 10th of 3: written as nothing");
  });

  test("the schema: index and of up to 30 for attended sessions; 31 refused; an address part above 12 still refused", () => {
    const f = (path: string, index: number, of: number) => FormFieldSchema.safeParse(field("F-01", { fillSource: { kind: "registration", path, part: { index, of } } as FormField["fillSource"] })).success;
    assert.equal(f("episode.attendedDate", 30, 30), true);
    assert.equal(f("episode.attendedDate", 31, 31), false);
    assert.equal(f("episode.attendedTime", 14, 31), false);
    assert.equal(f("patient.addressLines", 12, 12), true);
    assert.equal(f("patient.addressLines", 13, 13), false);
    assert.equal(f("clinic.addressLines", 2, 13), false);
  });

  test("episode.attendedDates: the attended dates in order from fromSession, at most `of`; nothing left → blank; none at all → not held", () => {
    const ctx = ctxOf(bundleWith(5, 1));
    assert.equal(resolveRegistrationValue("episode.attendedDates", ctx, "long_text", undefined, { fromSession: 2 })?.text, "02/09/2026, 03/09/2026, 04/09/2026, 05/09/2026", "the missed one left out, the first assessment too");
    assert.equal(resolveRegistrationValue("episode.attendedDates", ctx, "long_text", undefined, { fromSession: 1, of: 2 })?.text, "01/09/2026, 02/09/2026");
    assert.equal(resolveRegistrationValue("episode.attendedDates", ctxOf(bundleWith(1)), "long_text", undefined, { fromSession: 2 })?.blank, true);
    assert.equal(resolveRegistrationValue("episode.attendedDates", ctxOf(bundleWith(0)), "long_text", undefined, { fromSession: 2 }), null);
    // createFormReport fills it from the records (core/report-factory.ts passes the fill source's `sessions`).
    const bundle = bundleWith(4);
    const form = map([field("F-01", { label: "List of attended visit dates", answerType: "long_text", fillSource: { kind: "registration", path: "episode.attendedDates", sessions: { fromSession: 2 } } })]);
    const report = createFormReport({ form, bundle, instructingParty: bundle.referral, computedFacts: computeFacts(bundle, { asOf: "2026-10-26" }), now: new Date(AT) });
    const s = report.sections.find((x) => x.key === "F-01");
    assert.equal(s?.status, "complete");
    assert.equal(s?.paragraphs[0]?.text, "02/09/2026, 03/09/2026, 04/09/2026");
  });
});

describe("session dates: the classifier, and the fill by code for maps that do not name the record paths (B2-19)", () => {
  test("sessionQuestionOf reads the printed label (and 'after the assessment' in the guidance)", () => {
    const q = (label: string, answerType: FormField["answerType"] = "date", guidance = "") => sessionQuestionOf({ label, answerType, guidance });
    assert.deepEqual(q("Session 4 – date"), { kind: "session_date", n: 4, afterAssessment: false });
    assert.deepEqual(q("Treatment date 7"), { kind: "session_date", n: 7, afterAssessment: false });
    assert.deepEqual(q("Session date 2", "date", "Counted after the assessment."), { kind: "session_date", n: 2, afterAssessment: true });
    assert.deepEqual(q("Session 3 – time", "short_text"), { kind: "session_time", n: 3, afterAssessment: false });
    assert.deepEqual(q("Initial assessment time", "short_text"), { kind: "first_time" });
    assert.deepEqual(q("Date first seen"), { kind: "first_date" });
    assert.deepEqual(q("Dates of the visits", "long_text"), { kind: "session_dates", afterAssessment: false });
    assert.equal(q("Session length", "short_text"), null, "a duration is not a record value");
    assert.equal(q("Lumbar flexion – at first assessment", "short_text"), null);
    assert.equal(q("Expected date of a full return"), null);
    assert.equal(q("Was a session given on the date of the first assessment?", "yes_no"), null, "a yes/no is never a record value");
    assert.equal(q("Session 2 – date", "checkbox"), null);
  });

  const discharge = (fields: FormField[]) => ({ ...map(fields), title: "Discharge Report (fictional)" });
  const input = (f: FormField, form: Pick<FormDefinition, "title" | "fields">, bundle = bundleWith(6)) => ({ field: f, form, bundle, computedFacts: computeFacts(bundle, { asOf: "2026-10-26" }) });

  test("a drafted session date on a map without explicit session paths is filled from the attended appointments", () => {
    const d4 = field("F-04", { label: "Session date 4", answerType: "date" });
    assert.equal(sessionDatesByCode(input(d4, discharge([d4])))?.answer?.value, "2026-09-04");
    const after = field("F-04", { label: "Session date 4", answerType: "date", guidance: "Sessions after the assessment." });
    assert.equal(sessionDatesByCode(input(after, discharge([after])))?.answer?.value, "2026-09-05");
    const list = field("F-09", { label: "Dates of the visits", answerType: "long_text" });
    assert.equal(sessionDatesByCode(input(list, discharge([list])))?.text, "01/09/2026, 02/09/2026, 03/09/2026, 04/09/2026, 05/09/2026, 06/09/2026");
    assert.equal(sessionDatesByCode(input(field("F-07", { label: "Session date 7", answerType: "date" }), discharge([d4]))), null, "no 7th: drafted as before");
  });

  test("never for a clinician's box, an initial assessment form, or a map that names its session values (the map is the source of truth)", () => {
    const d2 = field("F-02", { label: "Session date 2", answerType: "date" });
    assert.equal(sessionDatesByCode(input({ ...d2, fillSource: { kind: "clinician_opinion" } }, discharge([d2]))), null);
    assert.equal(sessionDatesByCode(input(d2, { ...discharge([d2]), title: "Initial Assessment Report (fictional)" })), null);
    const explicit = field("F-03", { label: "Session 3 – date", answerType: "date", fillSource: { kind: "registration", path: "episode.attendedDate", part: { index: 3, of: 8 } } });
    assert.equal(mapsSessionsExplicitly([d2, explicit]), true);
    assert.equal(sessionDatesByCode(input(d2, discharge([d2, explicit]))), null);
    // Through createFormReport (the seam): filled from the records on a map without explicit paths, drafted on one with them.
    const bundle = bundleWith(6);
    const facts = computeFacts(bundle, { asOf: "2026-10-26" });
    const legacy = createFormReport({ form: discharge([d2]), bundle, instructingParty: bundle.referral, computedFacts: facts, now: new Date(AT) });
    assert.equal(legacy.sections.find((s) => s.key === "F-02")?.kind, "from_records");
    assert.equal(legacy.sections.find((s) => s.key === "F-02")?.answer?.value, "2026-09-02");
    const v2 = createFormReport({ form: discharge([d2, explicit]), bundle, instructingParty: bundle.referral, computedFacts: facts, now: new Date(AT) });
    assert.equal(v2.sections.find((s) => s.key === "F-02")?.status, "pending", "drafted as the map says");
  });
});

/* ------------------------------------------------------------------------------------------------
 * One outline for both screens
 * ----------------------------------------------------------------------------------------------*/

describe("one outline for the review and the mapping page", () => {
  const titlesOfReview = (fields: FormField[]) =>
    buildQuestionGroups({ sections: [], form: { id: "frm_we_test", sha256: "a".repeat(64) } as never }, { fields }, null).map((g) => [g.title, g.questions.map((q) => q.key)] as const);
  const titlesOfMapping = (fields: FormField[]) => mappingGroups(fields, fields).map((g) => [g.title, g.fields.map((f) => f.id)] as const);
  const heading = (s?: string) => (s ? { section: s } : {});
  const structures: Record<string, FormField[]> = {
    // CLM-like: no heading at the top, then headings, a run without one later, a sign-off without one at the end.
    clm: [field("F-01"), field("F-02"), field("F-03", heading("TREATMENT CONCLUSION")), field("F-04", heading("TREATMENT CONCLUSION")), field("F-05"), field("F-06", { answerType: "signature", fillSource: { kind: "signoff", part: "signature" } })],
    // Proclaim-like: yes/no flags under one heading, then questions with their own heading.
    proclaim: [field("F-01", heading("Flags")), field("F-02", { ...heading("Flags"), answerType: "yes_no" }), field("F-03", heading("Return to work")), field("F-04", heading("Treatment plan"))],
    // Bodycare-like: a form that prints no headings at all (a sign-off in the middle).
    bodycare: [field("F-01"), field("F-02", { answerType: "signature", fillSource: { kind: "signoff", part: "signature" } }), field("F-03")],
    // 10Bridge-like: address lines without a heading between two questions of one heading (round 1's narrow fill).
    tenbridge: [field("F-01", heading("CLAIMANT DETAILS")), field("F-02"), field("F-03"), field("F-04", heading("CLAIMANT DETAILS")), field("F-05", heading("INJURY"))],
  };

  test("the same groups, titles and order on both screens", () => {
    for (const [name, fields] of Object.entries(structures)) assert.deepEqual(titlesOfMapping(fields), titlesOfReview(fields), name);
  });

  test("the map's own headings exactly; an untitled run is the same label on both; a headingless form is one untitled group", () => {
    assert.deepEqual(titlesOfMapping(structures.clm), [
      [UNTITLED_HEADING, ["F-01", "F-02"]],
      ["TREATMENT CONCLUSION", ["F-03", "F-04"]],
      [UNTITLED_HEADING, ["F-05", "F-06"]],
    ]);
    assert.deepEqual(titlesOfMapping(structures.proclaim), [
      ["Flags", ["F-01", "F-02"]],
      ["Return to work", ["F-03"]],
      ["Treatment plan", ["F-04"]],
    ]);
    assert.deepEqual(titlesOfMapping(structures.bodycare), [["", ["F-01", "F-02", "F-03"]]], "no 'Form questions / Sign-off / Form questions' split (B3-17)");
    assert.deepEqual(titlesOfMapping(structures.tenbridge), [
      ["CLAIMANT DETAILS", ["F-01", "F-02", "F-03", "F-04"]],
      ["INJURY", ["F-05"]],
    ]);
    assert.equal(formOutline(structures.bodycare)[0].title, "");
  });

  test("the mapping page lists numbered table questions by number, inside the review's groups", () => {
    const fields = [field("F-01", { label: "Session date 7", ...heading("Sessions") }), field("F-02", { label: "Session date 1", ...heading("Sessions") }), field("F-03", { label: "Session date 8", ...heading("Sessions") })];
    const visible = [fields[1], fields[0], fields[2]];
    assert.deepEqual(mappingGroups(fields, visible).map((g) => [g.title, g.fields.map((f) => f.id)]), [["Sessions", ["F-02", "F-01", "F-03"]]]);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Guidance, the field editor, the mapping page's checks
 * ----------------------------------------------------------------------------------------------*/

describe("guidance: a v2 map as stored, an earlier map as it reads now; the field editor saves the stored text", () => {
  const staff = field("F-01", { fillSource: { kind: "registration", path: "staff.entry" }, guidance: "Filled from the record: the hospital number." });
  const clinic = field("F-02", { fillSource: { kind: "registration", path: "clinic.name" }, guidance: "Printed as “Clinic”. Filled from the record: the practice name." });
  const blank = field("F-03", { guidance: "Tick when given (unanswered: the printed default stays)." });
  const tick = field("F-04", { answerType: "checkbox", options: ["TENS"], guidance: "Ticked when tens was provided." });

  test("an earlier map: source, left-blank and option wording said as they are now; a v2 map unchanged", () => {
    assert.equal(currentGuidance(staff.guidance, staff), "Entered by staff on each report: the hospital number.");
    assert.equal(currentGuidance(clinic.guidance, clinic), "Printed as “Clinic”. From your Clinic details: the practice name.");
    assert.equal(currentGuidance(blank.guidance, blank), "Tick when given (left blank, the printed default is removed).");
    assert.equal(currentGuidance(tick.guidance, tick), "Ticked when TENS was provided.");
    for (const f of [staff, clinic, blank, tick]) assert.equal(currentGuidance(f.guidance, f, { guidanceVersion: GUIDANCE_VERSION }), f.guidance, f.id);
    assert.equal(guidanceIsCurrent({ guidanceVersion: 2 }), true);
    assert.equal(guidanceIsCurrent({}), false);
  });

  test("the withheld-reference rewrite applies to every map (a fact about the report)", () => {
    const ref = field("F-05", { fillSource: { kind: "registration", path: "referral.reference" }, guidance: "Filled from the record: the referrer's reference." });
    const section = { kind: "from_records" as const, paragraphs: [], blankFromRecords: undefined };
    assert.equal(withheldReference(ref, section), true);
    assert.equal(currentGuidance(ref.guidance, ref, { guidanceVersion: 2, withheldReference: true }), "Typed in by staff from the referrer's letter: the referrer's reference.");
  });

  test("B1-16: the editor shows and saves the stored guidance; the rewrite is a separate 'reads on reports' line", () => {
    const e = guidanceForEditing(blank);
    assert.equal(e.value, blank.guidance, "the stored text");
    assert.equal(e.readsAs, "Tick when given (left blank, the printed default is removed).");
    assert.equal(guidanceForEditing(blank, GUIDANCE_VERSION).readsAs, null);
  });

  test("the mapping page's checks: L9/L11 are ClinForms' own loading checks; L5 blocks confirming; a clinician may accept", () => {
    const f = map([field("F-01", { label: "Fit for usual duties?", fillSource: { kind: "registration", path: "staff.entry" } })], { warnings: ["prepared by ClinForms – check each question"] });
    const l = mappingLint(f);
    assert.deepEqual(Array.from(l.byField.get("F-01") ?? []).map((i) => i.rule), ["L5"]);
    assert.deepEqual(l.mapLevel, [], "L9 is not shown to the clinic");
    assert.equal(l.blocking.length, 1);
    assert.match(l.blocking[0], /^F-01: /);
    const accepted = map([{ ...f.fields[0], lintAccepted: [{ rule: "L5", reason: "The patient reports it.", at: AT }] }]);
    assert.deepEqual(mappingLint(accepted).blocking, []);
    assert.equal(mayAcceptJudgement({ role: "clinician", canSign: false }), true);
    assert.equal(mayAcceptJudgement({ role: "owner", canSign: true, hcpc: "PH-DEMO-01" }), true);
    // check-WE minor 3: "may sign" without a registration number is stamped as one who may not – the server's rule.
    assert.equal(mayAcceptJudgement({ role: "owner", canSign: true }), false);
    assert.equal(mayAcceptJudgement({ role: "admin", canSign: false }), false);
    assert.equal(mayAcceptJudgement({ role: "staff" }), false);
    assert.equal(mayAcceptJudgement(undefined), true, "the public demo acts as a clinician");
    // check-WE minor 9: a map that accepts a judgement as worded says before the click who confirms it.
    assert.deepEqual(mappingLint(accepted).acceptedJudgements, ["F-01"]);
    assert.equal(judgementConfirmProblem(mappingLint(accepted), true), null);
    assert.equal(judgementConfirmProblem(mappingLint(accepted), false), "This mapping accepts a clinical judgement as worded on question F-01: a clinician (or a member who may sign) confirms it.");
    assert.equal(judgementConfirmProblem(mappingLint(f), false), null, "nothing accepted: the open L5 is listed on its own");
  });

  test("B1-17(c), B2-30: the page opens on 'Needs review' before 'Check', a required clinical question before a staff entry or sign-off", () => {
    assert.equal(
      firstQuestionToCheck([
        { id: "F-03", confidence: "medium", required: true, fillSource: { kind: "notes_narrative" } },
        { id: "F-04", confidence: "low", required: true, fillSource: { kind: "registration", path: "staff.entry" } },
        { id: "F-11", confidence: "low", required: true, fillSource: { kind: "clinician_opinion" } },
      ]),
      "F-11",
    );
    assert.equal(
      firstQuestionToCheck([
        { id: "F-18", confidence: "medium", required: true, fillSource: { kind: "signoff", part: "signature" } },
        { id: "F-19", confidence: "medium", required: true, fillSource: { kind: "notes_narrative" } },
      ]),
      "F-19",
    );
  });
});

/* ------------------------------------------------------------------------------------------------
 * L5 on the server: /forms/confirm and a store PUT to confirmed
 * ----------------------------------------------------------------------------------------------*/

describe("L5 on the server: a clinical judgement is the clinician's, or a clinician accepts it", () => {
  const MEMBER = "x-corpus-member";
  async function call(h: ReturnType<typeof createHttpHarness>, handler: MedreportHandler, url: string, member: string, body: unknown, opts: { method?: string; params?: Record<string, string>; headers?: Record<string, string> } = {}) {
    const req = new Request(`http://localhost/api/reports/v1${url}`, { method: opts.method ?? "POST", headers: { "content-type": "application/json", [MEMBER]: member, ...opts.headers }, body: JSON.stringify(body) });
    const res = await bindHandler(handler, () => h.deps)(req, { params: opts.params ?? {} });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }
  const harness = () => {
    const h = createHttpHarness();
    const audit: AuditEvent[] = [];
    h.deps.audit = async (_t, e) => {
      audit.push(e);
    };
    return { h, audit };
  };
  /** The corpus's fictional discharge form: F-04 is a staff-entered work status (lighter duties) – an L5 question. */
  const proposed = async () => (await buildForm("cf-discharge", CORPUS_TENANT)).form;
  const withAcceptance = (form: FormDefinition, by?: unknown): FormDefinition => ({
    ...form,
    status: "proposed",
    confirmed: undefined,
    fields: form.fields.map((f) => (f.id === "F-04" ? ({ ...f, lintAccepted: [{ rule: "L5", reason: "Patient-reported work status (fictional).", at: "2020-01-01T00:00:00.000Z", ...(by ? { by } : {}) }] } as FormField) : f)),
  });

  test("/forms/confirm: an open L5 is refused (422, the question named); nothing is confirmed", async () => {
    const { h, audit } = harness();
    const form = { ...(await proposed()), status: "proposed" as const, confirmed: undefined };
    const r = await call(h, handleFormsConfirm, "/forms/confirm", "tom", { form, confirmedBy: "Tom Ellis" });
    assert.equal(r.status, 422, JSON.stringify(r.body));
    assert.equal(r.body.code, "VALIDATION_FAILED");
    assert.deepEqual((r.body.issues as Array<{ path: string }>).map((i) => i.path), ["form.fields.F-04"]);
    assert.deepEqual(audit, []);
  });

  test("/forms/confirm: an acceptance needs a clinician (403 for an administrator who may not sign); a clinician's is stamped, attested and audited", async () => {
    const { h, audit } = harness();
    const forged = { memberId: "mem_sarah", name: "Sarah Reid", role: "owner", canSign: true, hcpc: "PH-DEMO-01" };
    const form = withAcceptance(await proposed(), forged);
    const refused = await call(h, handleFormsConfirm, "/forms/confirm", "chris", { form, confirmedBy: "Chris Dale" });
    assert.equal(refused.status, 403, JSON.stringify(refused.body));
    assert.equal(refused.body.code, "ROLE_NOT_ALLOWED");
    const ok = await call(h, handleFormsConfirm, "/forms/confirm", "priya", { form, confirmedBy: "Priya Shah" });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const confirmed = ok.body.form as FormDefinition;
    const acceptance = confirmed.fields.find((f) => f.id === "F-04")?.lintAccepted?.[0];
    assert.equal(acceptance?.by?.name, "Priya Shah", "the confirming clinician – the browser's `by` is replaced");
    assert.equal(acceptance?.by?.role, "clinician");
    assert.notEqual(acceptance?.at, "2020-01-01T00:00:00.000Z", "the server's time");
    assert.equal(acceptance?.reason, "Patient-reported work status (fictional).");
    assert.equal(verifyFormConfirmation(confirmed, { tenantId: CORPUS_TENANT }).ok, true, "the attestation covers the stamped acceptance");
    const row = audit.find((e) => e.action === "form.lint_accepted");
    assert.deepEqual(row?.detail, { rule: "L5", fieldId: "F-04", judgement: "restrictions", reason: "Patient-reported work status (fictional)." });
    assert.ok(audit.some((e) => e.action === "form.confirm"));
  });

  test("/forms/confirm stamps EVERY acceptance with the confirming person – another rule, or L5 on a question that is no judgement (check-WE minor 2)", async () => {
    const { h, audit } = harness();
    const forged = { memberId: "mem_tom", name: "Tom Ellis", role: "clinician", canSign: true, hcpc: "PH-DEMO-02" };
    const base = withAcceptance(await proposed());
    const form: FormDefinition = {
      ...base,
      fields: base.fields.map((f) =>
        f.id === "F-12"
          ? ({ ...f, lintAccepted: [{ rule: "L6", reason: "Held elsewhere (fictional).", at: "2020-01-01T00:00:00.000Z", by: forged }, { rule: "L5", reason: "Not a judgement (fictional).", at: "2020-01-01T00:00:00.000Z", by: forged }, { rule: "L7", reason: "   ", at: AT }] } as FormField)
          : f,
      ),
    };
    const ok = await call(h, handleFormsConfirm, "/forms/confirm", "priya", { form, confirmedBy: "Priya Shah" });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const confirmed = ok.body.form as FormDefinition;
    const stamped = confirmed.fields.flatMap((f) => (f.lintAccepted ?? []).map((a) => `${f.id} ${a.rule} ${a.by?.name} ${a.at === "2020-01-01T00:00:00.000Z" ? "browser time" : "server time"}`));
    assert.deepEqual(stamped, ["F-04 L5 Priya Shah server time", "F-12 L6 Priya Shah server time", "F-12 L5 Priya Shah server time"], "no forged author survives; a blank reason is dropped");
    assert.equal(verifyFormConfirmation(confirmed, { tenantId: CORPUS_TENANT }).ok, true);
    assert.deepEqual(audit.filter((e) => e.action === "form.lint_accepted").map((e) => e.detail?.fieldId), ["F-04"], "the judgement acceptance has its own row");
    assert.deepEqual(audit.find((e) => e.action === "form.confirm")?.detail?.lintAccepted, ["L6@F-12", "L5@F-12"], "the others are listed on the confirmation's row");
  });

  test("/forms/confirm decides 'a clinician' on the Actor it stamps: 'may sign' without a registration number is refused, not stored and then refused (check-WE minor 3)", async () => {
    const { h } = harness();
    const signedIn = h.deps.authenticate as (req: Request) => Promise<unknown>;
    h.deps.authenticate = (async (req: Request) =>
      req.headers.get(MEMBER) === "olive"
        ? { userId: "usr_olive", authSessionId: "sess_olive", tenantId: CORPUS_TENANT, role: "owner", name: "Olive Grant", clinician: { name: "Olive Grant", canSign: true }, twoFactorVerified: true }
        : signedIn(req)) as typeof h.deps.authenticate;
    const form = withAcceptance(await proposed());
    const refused = await call(h, handleFormsConfirm, "/forms/confirm", "olive", { form, confirmedBy: "Olive Grant" });
    assert.equal(refused.status, 403, JSON.stringify(refused.body));
    assert.equal(refused.body.code, "ROLE_NOT_ALLOWED");
    // The same map without an L5 acceptance on a judgement question: an owner confirms it as before.
    const plain = await call(h, handleFormsConfirm, "/forms/confirm", "olive", { form: { ...form, fields: form.fields.map((f) => (f.id === "F-04" ? { ...f, fillSource: { kind: "clinician_opinion" }, lintAccepted: undefined } : f)) }, confirmedBy: "Olive Grant" });
    assert.equal(plain.status, 200, JSON.stringify(plain.body));
  });

  test("a store PUT to confirmed: refused while an L5 is open or accepted by someone who is not a clinician; stored when a clinician accepted it", async () => {
    const { h } = harness();
    const base = await proposed();
    const put = (form: FormDefinition, member = "sarah", ifMatch?: number) =>
      call(h, handleStoreFormPut, `/store/forms/${form.id}`, member, { form }, { method: "PUT", params: { id: form.id }, headers: { origin: "http://localhost", ...(ifMatch ? { "if-match": `"${ifMatch}"` } : {}) } });
    // Confirmed by an earlier build (attested, no acceptance): a NEW confirmation is refused.
    const legacy = withAttestedConfirmation({ ...base, id: "frm_we_legacy", status: "proposed", confirmed: undefined }, "Pat Morgan", AT);
    const r1 = await put(legacy);
    assert.equal(r1.status, 422, JSON.stringify(r1.body));
    // Accepted, but stamped by an administrator who may not sign.
    const byAdmin = withAttestedConfirmation(withAcceptance({ ...base, id: "frm_we_admin" }, { memberId: "mem_chris", name: "Chris Dale", role: "admin", canSign: false }), "Chris Dale", AT);
    assert.equal((await put(byAdmin)).status, 422);
    // Accepted and stamped by a clinician: stored.
    const byClinician = withAttestedConfirmation(withAcceptance({ ...base, id: "frm_we_ok" }, { memberId: "mem_tom", name: "Tom Ellis", role: "clinician", canSign: true, hcpc: "PH-DEMO-02" }), "Tom Ellis", AT);
    const r3 = await put(byClinician);
    assert.equal(r3.status, 201, JSON.stringify(r3.body));
    // The same confirmation stored again (an earlier build's map already held as confirmed): not a new confirmation.
    await h.store.createForm(CORPUS_TENANT, { id: legacy.id, status: "confirmed", title: legacy.title, referrer: legacy.referrer.name, kind: legacy.kind, fileSha256: legacy.file.sha256, sampleId: null, payload: legacy });
    const again = await put(legacy, "sarah", 1);
    assert.equal(again.status, 200, JSON.stringify(again.body));
  });
});
