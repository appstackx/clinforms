import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPLOYER_FFW_TEMPLATE, SOLICITOR_RTA_TEMPLATE } from "../../templates/registry";
import { computeFacts } from "../computed-facts";
import { ReportFlagSchema } from "../schemas";
import type { Report, ReportFlag, ReportTemplate } from "../types";
import { canAcknowledge, canSign, runValidators, validateReport } from "./index";
import { findUnsupportedOpinionPhrases } from "./opinion-language";
import { normaliseForMatch } from "./text";
import { TEST_FACTS_DATE, para, testBundle, testReport, withSection } from "./test-fixtures";

function run(report: Report, template: ReportTemplate): ReportFlag[] {
  const flags = runValidators({
    report,
    bundle: report.bundleSnapshot,
    template,
    computedFacts: computeFacts(report.bundleSnapshot, { asOf: TEST_FACTS_DATE }),
  });
  for (const f of flags) ReportFlagSchema.parse(f);
  return flags;
}

const of = (flags: ReportFlag[], code: ReportFlag["code"], paragraphId?: string) =>
  flags.filter((f) => f.code === code && (paragraphId === undefined || f.paragraphId === paragraphId));

const SOL = SOLICITOR_RTA_TEMPLATE;
const EMP = EMPLOYER_FFW_TEMPLATE;

/* ------------------------------------------------------------------------------------------------
 * Citations
 * ----------------------------------------------------------------------------------------------*/

test("citations: AI/edited text needs a valid citation; clinician and from-records text is exempt", () => {
  const ai = para("Mr Testcase reported central low back pain.", []);
  const edited = para("Mr Testcase reported back pain.", [], { origin: "edited" });
  const own = para("I saw him once.", [], { origin: "clinician" });
  const unknownOnly = para("He reported back pain.", ["N-099", "A-002"]);
  const mixed = para("He reported central LBP.", ["N-001", "FACT-nonsense"]);
  const report = withSection(testReport(SOL), "presenting_complaints", [ai, edited, own, unknownOnly, mixed]);
  const flags = run(report, SOL);

  assert.equal(of(flags, "UNCITED_PARAGRAPH", ai.id)[0]?.severity, "blocking");
  assert.equal(of(flags, "UNCITED_PARAGRAPH", edited.id).length, 1);
  assert.equal(of(flags, "UNCITED_PARAGRAPH", own.id).length, 0);
  // Unknown IDs are ignored (warning) and do not count as citations.
  assert.deepEqual(of(flags, "UNKNOWN_SOURCE_ID", unknownOnly.id).map((f) => f.evidence), ["N-099", "A-002"]);
  assert.equal(of(flags, "UNCITED_PARAGRAPH", unknownOnly.id).length, 1);
  assert.equal(of(flags, "UNKNOWN_SOURCE_ID", mixed.id)[0]?.severity, "warning");
  assert.equal(of(flags, "UNCITED_PARAGRAPH", mixed.id).length, 0);
  // From-records paragraphs built by code are valid.
  assert.equal(flags.filter((f) => f.sectionKey === "claimant_details" || f.sectionKey === "attendance").length, 0);
});

test("citations: an attributed opinion must cite the note that records it", () => {
  const factOnly = para("He was discharged.", ["FACT-episode"], { basis: "clinician_opinion_recorded" });
  const withNote = para(
    "On 06/05/2026 Tom Ellis recorded that he is fit for a phased return to normal duties over 2 weeks.",
    ["N-002"],
    { basis: "clinician_opinion_recorded" },
  );
  const report = withSection(testReport(EMP), "fitness_opinion", [factOnly, withNote]);
  const flags = run(report, EMP);
  assert.equal(of(flags, "UNCITED_PARAGRAPH", factOnly.id).length, 1);
  assert.equal(of(flags, "UNCITED_PARAGRAPH", withNote.id).length, 0);
  assert.equal(flags.filter((f) => f.paragraphId === withNote.id).length, 0, JSON.stringify(flags));
});

test("citations: a dropped-ID flag from drafting is carried over while the paragraph is unchanged AI text", () => {
  const p = para("He reported central LBP.", ["N-001"]);
  const dropped: ReportFlag = {
    id: `UNKNOWN_SOURCE_ID:presenting_complaints:${p.id}:n-014`,
    code: "UNKNOWN_SOURCE_ID",
    severity: "warning",
    sectionKey: "presenting_complaints",
    paragraphId: p.id,
    evidence: "N-014",
    message: "Dropped",
  };
  const report = { ...withSection(testReport(SOL), "presenting_complaints", [p]), flags: [dropped] };
  assert.equal(of(run(report, SOL), "UNKNOWN_SOURCE_ID", p.id).length, 1);
  const edited = withSection(report, "presenting_complaints", [{ ...p, origin: "edited" }]);
  assert.equal(of(run(edited, SOL), "UNKNOWN_SOURCE_ID", p.id).length, 0);
});

/* ------------------------------------------------------------------------------------------------
 * Figures
 * ----------------------------------------------------------------------------------------------*/

test("figures: dates and numbers must be in the cited sources; dates block, numbers warn", () => {
  const good = para(
    "On 18/03/2026 Sarah Reid recorded central low back pain of 7/10 at worst, a sitting tolerance of twenty minutes and an SLR of 70°; a review was planned in about six to seven weeks.",
    ["N-001"],
  );
  const wrongDate = para("On 19/03/2026 Sarah Reid recorded low back pain.", ["N-001"]);
  const wrongNumber = para("Pain was 8/10 at worst.", ["N-001"]);
  const wrongPeriod = para("A review was planned within 8 weeks.", ["N-001"]);
  const future = para("He was expected back by March 2027.", ["N-001"]);
  const wrongLevel = para("Tenderness at L3/4.", ["N-001"]);
  const report = withSection(testReport(SOL), "examination_findings", [good, wrongDate, wrongNumber, wrongPeriod, future, wrongLevel]);
  const flags = run(report, SOL);
  const fig = (id: string) => of(flags, "FIGURE_NOT_IN_SOURCE", id);

  assert.deepEqual(fig(good.id), [], JSON.stringify(fig(good.id)));
  assert.deepEqual(fig(wrongDate.id).map((f) => [f.evidence, f.severity]), [["19/03/2026", "blocking"]]);
  assert.deepEqual(fig(wrongNumber.id).map((f) => [f.evidence, f.severity]), [["8", "warning"]]);
  assert.deepEqual(fig(wrongPeriod.id).map((f) => [f.evidence, f.severity]), [["8 weeks", "blocking"]]);
  assert.deepEqual(fig(future.id).map((f) => f.severity), ["blocking"]);
  assert.deepEqual(fig(wrongLevel.id).map((f) => [f.evidence, f.severity]), [["L3/4", "warning"]]); // L4 is recorded, L3 is not
});

test("figures: a computed fact supports its own figures but not a recalculation", () => {
  const ok = para("The episode ran from 18/03/2026 to 06/05/2026, with the ODI falling from 48% to 18%.", [
    "FACT-episode",
    "FACT-outcomes-ODI",
  ]);
  const recalculated = para("The episode lasted 8 weeks.", ["FACT-episode"]); // the fact says 49 days (7 weeks)
  const wrongSource = para("The ODI fell from 48% to 18%.", ["N-002"]); // 48% is only in N-001 / the fact
  const report = withSection(testReport(SOL), "progress_current_status", [ok, recalculated, wrongSource]);
  const flags = run(report, SOL);
  assert.deepEqual(of(flags, "FIGURE_NOT_IN_SOURCE", ok.id), []);
  assert.equal(of(flags, "FIGURE_NOT_IN_SOURCE", recalculated.id)[0]?.evidence, "8 weeks");
  assert.deepEqual(of(flags, "FIGURE_NOT_IN_SOURCE", wrongSource.id).map((f) => f.evidence), ["48"]);
});

test("terms: a corrupted glossary term the record uses blocks (acknowledgeable); other phrasing does not", () => {
  const bundle = testBundle();
  bundle.notes[0] = { ...bundle.notes[0], assessment: `${bundle.notes[0].assessment} Neck: WAD II.` };
  const report0 = testReport(SOL, bundle);
  const whale = para("On 18/03/2026 Sarah Reid assessed whale-associated disorder grade II.", ["N-001"]);
  const exorcise = para("A home exorcise programme was issued.", ["N-001"]);
  const oswald = para("The Oswald Disability Index was 48%.", ["N-001"]);
  const right = para("Whiplash-associated disorder grade II, a home exercise programme and an Oswestry Disability Index of 48% were recorded.", ["N-001"]);
  const otherPhrases = para(
    "A graded exercise programme, home exercises were advised, soft tissue massage, full range of movement and lower back pain were noted.",
    ["N-001"],
  );
  const clinician = para("Whale-associated disorder.", [], { origin: "clinician" });
  const edited = para("He had whale-associated disorder.", ["N-001"], { origin: "edited" });
  const report = withSection(report0, "examination_findings", [whale, exorcise, oswald, right, otherPhrases, clinician, edited]);
  const flags = run(report, SOL);
  const term = (id: string) => of(flags, "TERM_NOT_IN_SOURCE", id);

  assert.deepEqual(term(whale.id).map((f) => [f.evidence, f.severity]), [["whale-associated disorder", "blocking"]]);
  assert.match(term(whale.id)[0].message, /WAD \(whiplash-associated disorder\)/);
  assert.deepEqual(term(exorcise.id).map((f) => f.evidence), ["home exorcise programme"]);
  assert.deepEqual(term(oswald.id).map((f) => f.evidence), ["Oswald Disability Index"]);
  for (const ok of [right, otherPhrases, clinician]) assert.deepEqual(term(ok.id), [], JSON.stringify(term(ok.id)));
  assert.equal(term(edited.id).length, 1, "edited text is checked too");
  assert.equal(canAcknowledge(term(whale.id)[0]), true);
  // Corrected wording clears the flag.
  const fixed = withSection(report, "examination_findings", [{ ...whale, text: "On 18/03/2026 Sarah Reid assessed whiplash-associated disorder grade II.", origin: "edited" }]);
  assert.deepEqual(of(run(fixed, SOL), "TERM_NOT_IN_SOURCE"), []);
  // A term the record never uses is not checked (no WAD in the standard test record).
  const plain = withSection(testReport(SOL), "examination_findings", [para("Whale-associated disorder.", ["N-001"])]);
  assert.deepEqual(of(run(plain, SOL), "TERM_NOT_IN_SOURCE"), []);
});

test("figures: clinician text is not checked; edited text is; scoped-out fields are not sources", () => {
  const own = para("Review planned for March 2027.", [], { origin: "clinician" });
  const edited = para("Review planned for March 2027.", ["N-002"], { origin: "edited" });
  const fromPmh = para("He had a knee operation in 2015.", ["N-001"]);
  const sol = run(withSection(testReport(SOL), "progress_current_status", [own, edited, fromPmh]), SOL);
  assert.equal(of(sol, "FIGURE_NOT_IN_SOURCE", own.id).length, 0);
  assert.equal(of(sol, "FIGURE_NOT_IN_SOURCE", edited.id).length, 1);
  assert.equal(of(sol, "FIGURE_NOT_IN_SOURCE", fromPmh.id).length, 0); // PMH is a source for the solicitor template
  const emp = run(withSection(testReport(EMP), "functional_status", [fromPmh]), EMP);
  assert.equal(of(emp, "FIGURE_NOT_IN_SOURCE", fromPmh.id)[0]?.severity, "blocking"); // stripped by scope
});

/* ------------------------------------------------------------------------------------------------
 * Opinion language
 * ----------------------------------------------------------------------------------------------*/

test("opinion: unsupported opinion wording blocks AI text and cannot be acknowledged", () => {
  const p = para("Sarah Reid recorded that he is expected to make a full recovery.", ["N-001"]);
  let report = withSection(testReport(SOL), "prognosis", [p]);
  const first = of(run(report, SOL), "OPINION_LANGUAGE", p.id);
  assert.deepEqual(first.map((f) => f.evidence).sort(), ["expected to", "full recovery"]);
  assert.ok(first.every((f) => f.severity === "blocking"));
  assert.equal(canAcknowledge(first[0], report), false);
  // An acknowledgement stored on the flag is ignored for AI text.
  report = { ...report, flags: first.map((f) => ({ ...f, acknowledged: { reason: "fine", at: "2026-10-06T10:00:00.000Z" } })) };
  const again = run(report, SOL);
  assert.ok(of(again, "OPINION_LANGUAGE", p.id).every((f) => !f.acknowledged));
  assert.equal(canSign(again, report.gaps).ok, false);
});

test("opinion: edited text blocks until acknowledged with a reason; clinician text is never flagged", () => {
  const edited = para("In my view the symptoms were caused by the accident.", ["N-001"], { origin: "edited" });
  const own = para("In my opinion the symptoms were caused by the accident.", [], { origin: "clinician" });
  const base = withSection(testReport(SOL), "prognosis", [edited, own]);
  const flags = of(run(base, SOL), "OPINION_LANGUAGE");
  assert.deepEqual(flags.map((f) => [f.paragraphId, f.evidence]), [[edited.id, "caused"]]);
  assert.equal(flags[0].acknowledged, undefined);
  assert.equal(canAcknowledge(flags[0], base), true);
  const acked = withSection(base, "prognosis", [{ ...edited, ackReason: "My own opinion as treating clinician." }, own]);
  const after = of(run(acked, SOL), "OPINION_LANGUAGE", edited.id);
  assert.equal(after[0].acknowledged?.reason, "My own opinion as treating clinician.");
});

test("opinion: quoting a recorded opinion passes; strengthening or moving it does not", () => {
  const quoted = para(
    "On 06/05/2026 Tom Ellis recorded that, in his opinion, he was fit for a phased return to normal duties over 2 weeks and should avoid repetitive lifting >15 kg for 4 weeks, with a review in six weeks.",
    ["N-002"],
    { basis: "clinician_opinion_recorded" },
  );
  const strengthened = para("Tom Ellis recorded that he was fit for normal duties.", ["N-002"], { basis: "clinician_opinion_recorded" });
  const wrongNote = para("Sarah Reid recorded that he was fit for a phased return to normal duties over 2 weeks.", ["N-001"]);
  const report = withSection(testReport(EMP), "fitness_opinion", [quoted, strengthened, wrongNote]);
  const flags = run(report, EMP);
  assert.deepEqual(flags.filter((f) => f.paragraphId === quoted.id), []);
  assert.deepEqual(of(flags, "OPINION_LANGUAGE", strengthened.id).map((f) => f.evidence), ["fit for normal duties"]);
  assert.ok(of(flags, "OPINION_LANGUAGE", wrongNote.id).some((f) => f.evidence === "fit for a phased return to normal duties"));
});

test("opinion: phrase finder covers causation, probability, prognosis, timeframes, permanence and diagnosis", () => {
  const source = "presentation consistent with acute mechanical low back pain. review in 6 weeks.";
  const found = (t: string) => findUnsupportedOpinionPhrases(t, source).map((m) => m.label);
  assert.deepEqual(found("Presentation consistent with acute mechanical low back pain."), []);
  assert.deepEqual(found("Review in six weeks."), []);
  assert.deepEqual(found("Review within six weeks."), ["timeframe"]);
  assert.deepEqual(found("On the balance of probabilities"), ["balance of probabilities"]);
  assert.deepEqual(found("symptoms attributable to the accident"), ["causation"]);
  assert.deepEqual(found("as a result of the accident"), ["causation"]);
  assert.deepEqual(found("The prognosis is good."), ["prognosis"]);
  assert.deepEqual(found("symptoms will resolve"), ["prediction"]);
  assert.deepEqual(found("a permanent restriction"), ["permanence"]);
  assert.deepEqual(found("He was diagnosed with a disc injury."), ["diagnosis"]);
  assert.deepEqual(found("symptoms 12 months post-accident"), ["timeframe"]);
  assert.deepEqual(found("He has improved."), []);
});

/* Work and activity status is not a recovery opinion (Blue Heart trial, 10/2026) --------------------- */

/** The Blue Heart test run's 10Bridge F-37 (time off work): the drafted answer and the note it cites. */
const F37_NOTE = "Took 3 days off work, then back on normal duties with breaks from the desk.";
const F37_DRAFT = "Mr Ellery told me on 15/07/2026 that he took 3 days off work, then returned to normal duties with breaks from the desk.";

/** A drafted paragraph citing the F-37 note (N-003), and the report it is in. */
function f37Report(text: string): { report: Report; p: ReturnType<typeof para> } {
  const bundle = testBundle();
  bundle.notes.push({
    id: "N-003",
    date: "2026-07-15",
    type: "initial_assessment",
    author: { name: "Sarah Reid", hcpc: "PH-DEMO-01", role: "Senior Physiotherapist, MCSP" },
    subjective: F37_NOTE,
    objective: "",
    assessment: "",
    plan: "",
  });
  const p = para(text, ["N-003"], { basis: "patient_reported" });
  return { report: withSection(testReport(SOL, bundle), "progress_current_status", [p]), p };
}

/** Labels of the opinion phrases in `draft` that a note with `note` as its Subjective does not support. */
function opinionLabels(draft: string, note: string): string[] {
  return findUnsupportedOpinionPhrases(draft, normaliseForMatch(`Subjective: ${note}`)).map((m) => m.label);
}

test("opinion: the F-37 work status passes – \"returned to normal duties\" from a note's \"back on normal duties\"", () => {
  const { report, p } = f37Report(F37_DRAFT);
  assert.deepEqual(run(report, SOL).filter((f) => f.paragraphId === p.id), []);
  assert.deepEqual(findUnsupportedOpinionPhrases(F37_DRAFT, normaliseForMatch(F37_NOTE)), []);
});

test("fix round 2 (B1-2): a narrated “before returning to normal duties” states the return the note records; future and planned returns still block", () => {
  // Proclaim final report F-10 (Jordan, printed notes) as drafted, citing N-001 – no flag, so no forced rewrite.
  const note = "Took 3 days off work, then back on normal duties with breaks from the desk.";
  const draft = "Mr Ellery was the driver of a car hit from behind on 12/07/2026, and reported neck pain the next morning, taking 3 days off work before returning to normal duties.";
  assert.deepEqual(opinionLabels(draft, note), []);
  const { report, p } = f37Report(draft);
  assert.deepEqual(of(run(report, SOL), "OPINION_LANGUAGE", p.id), []);
  for (const ok of ["He took 3 days off, then returning to normal duties.", "After returning to normal duties he had no further time off.", "On returning to normal duties he took breaks from the desk."]) {
    assert.deepEqual(opinionLabels(ok, note), [], ok);
  }
  // Not a stated return: a present or future "returning", a plan, an aim – or a note that does not record it.
  const blocked: Array<[draft: string, note: string]> = [
    ["He is returning to normal duties.", note],
    ["He will be returning to normal duties.", note],
    ["He took 3 days off before returning to normal duties next week.", note],
    ["He took 3 days off before returning to normal duties from Monday.", note],
    ["The aim of returning to normal duties was agreed.", note],
    ["He plans a week off before returning to normal duties.", note],
    ["He should rest for a week before returning to normal duties.", note],
    ["He is returning to his normal work.", note],
    ["He took 3 days off before returning to normal duties.", "Off work since the accident."],
  ];
  for (const [d, n] of blocked) assert.deepEqual(opinionLabels(d, n), ["return to normal work or activity"], d);
});

test("opinion: symptoms back to normal \"during work\" stay a recovery opinion, even citing the F-37 note", () => {
  const { report, p } = f37Report("Mr Ellery told me on 15/07/2026 that his symptoms returned to normal during work.");
  const [flag, ...rest] = of(run(report, SOL), "OPINION_LANGUAGE", p.id);
  assert.equal(rest.length, 0);
  assert.equal(flag.severity, "blocking");
  assert.equal(flag.evidence, "returned to normal");
  assert.match(flag.message, /\(recovery\)/);
  assert.equal(canAcknowledge(flag, report), false);
  // Only a few plain describing words may stand between "normal" and the activity; any other word keeps it recovery.
  const cases: Array<[draft: string, note: string]> = [
    ["His neck was back to normal during duties.", F37_NOTE],
    ["His neck returned to normal while driving.", "Driving normally; the nervousness has settled."],
    ["Her back returned to normal when working shifts.", "Back on full shifts."],
    ["He has returned to normal pain-free activities.", "Back on normal activities with some pain."],
    ["He returned to his normal unrestricted duties.", "Back on normal duties, restrictions on lifting."],
  ];
  for (const [draft, note] of cases) assert.deepEqual(opinionLabels(draft, note), ["recovery"], draft);
});

test("opinion: faithful work and activity paraphrases pass when the cited note records the same thing", () => {
  const cases: Array<[draft: string, note: string]> = [
    ["He went back to his normal duties after 3 days.", "Back on full duties after 3 days off."],
    ["He has returned to his normal working hours.", "No pain, back on full hours."],
    ["She returned to her usual gym routine.", "Back at the gym."],
    ["He has returned to normal training.", "Back to full training with the team, no pain."],
    ["He has returned to normal driving.", "Driving normally; the nervousness has settled."],
    ["He returned to normal work.", "Back on normal duties."],
    ["He has returned to his normal role.", "Back in his normal role."],
    ["He has returned to normal duties.", "Returned to work on full duties on 10/08/2026."],
    ["She has returned to her normal 12-hour shifts.", "Back on full 12-hour shifts."],
    ["He returned to his normal hobbies.", "Back to all his usual hobbies."],
    ["He has returned to all his normal activities.", "Back to all normal activities."],
    ["He returned to his normal duties in the warehouse.", "Back on full duties in the warehouse."],
    // A drafted status that has not happened, recorded the same way (Gemma Whitlock's review of 13/10/2026).
    ["She has not yet returned to her normal 12-hour shifts.", "Working 8-hour shifts with full moving and handling using equipment; not yet back on 12-hour shifts."],
    ["He was back at work after 3 days.", "Took 3 days off work."],
    ["She resumed full duties on 13/10/2026.", "Back on full duties."],
    ["She returned to work on light duties on 28/09/2026.", "Phased return to work: 4-hour shifts."],
    ["He was back to the gym for lower body work only.", "Back at the gym for lower body work only."],
    ["At discharge he was working full time without restrictions.", "Working full time with no restrictions."],
    ["He returned to football and the gym without restrictions.", "Back to football and the gym with no restrictions."],
    ["Sessions focused on strengthening and on balance, with step-ups.", "Step-ups, split squats and single-leg balance."],
    ["Treatment progressed to split squats, with work on balance.", "Progressed: split squats and single-leg balance."],
    ["Side-stepping and cutting drills caused mild discomfort on the inner side of the knee.", "Side-stepping and cutting drills cause mild discomfort on the inner side of the knee."],
  ];
  for (const [draft, note] of cases) assert.deepEqual(opinionLabels(draft, note), [], draft);
});

test("opinion: a note that says the opposite, or names another activity, does not support a full return", () => {
  const cases: Array<[draft: string, note: string]> = [
    ["He can return to normal activities.", "Pain with all activities."],
    ["He has returned to his normal sports.", "Has stopped all sports since the accident."],
    ["He has returned to his normal daily activities.", "Difficulty with normal daily activities."],
    ["He has returned to his normal training.", "Pain on full training."],
    ["He returned to normal duties.", "Off normal duties since 02/09/2026."],
    ["He returned to normal duties.", "No full duties until review."],
    ["He returned to normal duties.", "Normal duties: not yet."],
    ["He returned to normal duties.", "Back on full duties - not yet."],
    ["He returned to normal duties.", "Prior to the accident he was on full duties as a scaffolder. Currently off work."],
    ["He returned to normal duties.", "Previously on full duties; currently off work."],
    ["He returned to normal duties.", "Fit for full duties from 01/10/2026 (GP fit note)."],
    ["He returned to normal duties.", "Back on full duties from 01/10/2026."],
    ["He returned to normal duties.", "Back on full duties in 2 weeks."],
    ["He returned to normal duties.", "Back on full duties? Unsure."],
    ["He returned to normal duties.", "Keen to get back to full duties."],
    ["He returned to normal duties.", "Back to full duties would be premature."],
    ["He returned to normal duties.", "Back on full duties but avoiding lifting."],
    // A current level is not a recorded return; the drafted describing word must match the note.
    ["He has returned to normal training.", "Usual training with the team, no pain."],
    ["She returned to her normal 12-hour shifts.", "Back on full 8-hour shifts."],
    // Another activity: "driving normally" records driving only.
    ["He has returned to his pre-accident activities.", "Pre-accident activities: gym 3 times a week and football. All stopped."],
    ["He has returned to his pre-accident activities.", "Driving normally. Unable to play football or go to the gym."],
    ["He has returned to all his normal activities.", "Driving normally."],
    // A drafted "has not returned" needs the note's own negation; a modal ("can't") is a fitness opinion.
    ["She has not yet returned to her normal shifts.", "Back on full shifts."],
    ["He can't return to normal duties.", "Not yet back on normal duties."],
  ];
  for (const [draft, note] of cases) {
    assert.deepEqual(opinionLabels(draft, note), ["return to normal work or activity"], `${draft} | ${note}`);
  }
});

test("opinion: unrecorded opinions and unsupported full returns still block", () => {
  const cases: Array<[draft: string, note: string, label: string]> = [
    // A full return the note gives at a lower level, negated, hedged, planned or only as history.
    ["He returned to normal duties.", "Back on light duties.", "return to normal work or activity"],
    ["He returned to normal duties.", "Not yet back on normal duties.", "return to normal work or activity"],
    ["He returned to normal duties.", "Nearly back on normal duties.", "return to normal work or activity"],
    ["She returned to normal duties.", "In my opinion she should be able to return to full duties within 4 weeks.", "return to normal work or activity"],
    ["She returned to normal duties.", "Request 3 further sessions to complete the graded return to full duties.", "return to normal work or activity"],
    ["He returned to normal duties.", "Goal: normal duties by week 6.", "return to normal work or activity"],
    ["He returned to normal duties.", "Neck pain since the accident. Social history: Works full time on normal duties.", "return to normal work or activity"],
    ["He returned to normal activities.", "Back on normal duties.", "return to normal work or activity"],
    ["He has returned to his pre-accident activities.", "Pain 2/10.", "return to normal work or activity"],
    // Recovery, prognosis, causation, fitness and the standard of proof.
    ["His symptoms returned to normal.", "Neurological screen normal. Back on normal duties.", "recovery"],
    ["He has fully recovered.", "Back on normal duties.", "recovery"],
    ["He will make a full recovery.", "Pain 2/10.", "recovery"],
    ["The symptoms are expected to resolve.", "Pain 2/10.", "prediction"],
    ["The symptoms were caused by the accident.", "Turning his head causes pain.", "causation"],
    ["The accident caused pain.", "Turning his head causes pain.", "causation"],
    ["The findings are consistent with the index event.", "Pain 2/10.", "causation"],
    ["He is fit for work.", "Back on normal duties.", "fitness for work"],
    ["He has no further restrictions.", "Working with no restrictions.", "fitness for work"],
    ["He is working without restrictions.", "Restrictions on lifting for 4 weeks.", "fitness for work"],
    ["On balance, I consider the symptoms to be genuine.", "Worked on strength.", "balance of probabilities"],
    ["He worked hard and on balance he is fit to play.", "Pain 2/10.", "balance of probabilities"],
    // "Focused on … and on balance" is exercise only when the note records balance work.
    ["Having focused on the records and on balance, the symptoms are genuine.", "Pain 2/10.", "balance of probabilities"],
    ["His progress on balance suggests the account is reliable.", "Pain 2/10.", "balance of probabilities"],
  ];
  for (const [draft, note, label] of cases) {
    const labels = opinionLabels(draft, note);
    assert.ok(labels.includes(label), `${draft} → ${JSON.stringify(labels)}`);
  }
});

test("opinion: a drafted return the F-37 note does not record – a modal, advice or a contradiction – still blocks", () => {
  // Integration review (10/2026): the note recording the return supports only a drafted return that happened.
  const drafts = [
    "He can return to normal duties.",
    "He can't return to normal duties.",
    "He cannot return to his normal duties.",
    "He is able to return to his normal duties.",
    "He is unable to return to his normal duties.",
    "He should return to normal duties.",
    "He should be able to return to his normal duties.",
    "He would be able to return to his normal duties in 2 weeks.",
    "He could return to normal duties.",
    "He may return to normal duties.",
    "He is ready to return to normal duties.",
    "None – he can go back to his normal duties.",
    "I recommend a graded return to normal duties over 4 weeks.",
    "I would advise a return to his normal duties.",
    "He has been advised to return to normal duties.",
    "He should be back to normal duties by the end of the month.",
    "Once his pain settles he can return to normal duties.",
    "There is no reason he cannot return to normal duties.",
    "He did not return to normal duties.",
    "He never returned to normal duties.",
    "He was unable to return to normal duties after the accident.",
  ];
  for (const draft of drafts) assert.notDeepEqual(opinionLabels(draft, F37_NOTE), [], draft);
  // Through the validators, as /sign runs them: a fitness view on F-37's note cannot be approved as drafted.
  const { report, p } = f37Report("None. He can return to his normal duties.");
  const [flag] = of(run(report, SOL), "OPINION_LANGUAGE", p.id);
  assert.equal(flag.severity, "blocking");
  assert.equal(canAcknowledge(flag, report), false);
  // Elsewhere: fitness and prognosis on other activities, and a prognosis after a recorded "not yet".
  const others: Array<[draft: string, note: string]> = [
    ["He can return to normal driving.", "Driving normally; the nervousness has settled."],
    ["He should be able to return to normal training.", "Back to full training with the team, no pain."],
    ["She has not yet returned to her normal 12-hour shifts, but should be able to shortly.", "Working 8-hour shifts; not yet back on 12-hour shifts."],
    ["He can return to work without restrictions.", "Not yet able to work with no restrictions."],
    // A symptom or body part as the subject is recovery, whatever word follows.
    ["His neck is back to normal work-wise.", F37_NOTE],
    ["His symptoms have returned to normal activity levels.", "Back to normal activity."],
    ["His knee function returned to normal sporting activities.", "Back to full sporting activities."],
  ];
  for (const [draft, note] of others) assert.notDeepEqual(opinionLabels(draft, note), [], `${draft} | ${note}`);
  // A drafted return that happened still passes.
  for (const draft of [
    "He returned to normal duties after 3 days off work.",
    "He has returned to normal duties.",
    "He went back to his normal duties.",
    "He is back to his normal duties.",
    "He had returned to normal duties by 15/07/2026.",
    "He was back to normal duties.",
    "Yes – he returned to his normal duties after 3 days.",
  ]) {
    assert.deepEqual(opinionLabels(draft, F37_NOTE), [], draft);
  }
});

test("opinion: causation, the standard of proof and recorded returns – the review's remaining cases", () => {
  const BALANCE_NOTE = "Progressed: step-ups, split squats and single-leg balance.";
  const block: Array<[draft: string, note: string]> = [
    // "Which / that / it caused" is causation, however the note's "which causes pain" goes on.
    ["Ms Whitlock was injured lifting at work, which caused pain in her lower back.", "Lifting boxes at work, which causes pain in her lower back."],
    ["The collision, which caused pain in his neck, was on 04/07/2026.", "Turning, which causes pain in his neck."],
    ["He was hit from behind and that caused neck pain.", "Looking over his shoulder and that causes neck pain."],
    ["The accident and it caused headaches.", "Reading and it causes headaches."],
    // "On balance" as the standard of proof, even when the note records balance work.
    ["Having worked on the evidence and on balance, the symptoms are genuine.", BALANCE_NOTE],
    ["Having focused on the records and on balance, the symptoms are genuine.", BALANCE_NOTE],
    ["His progress on balance suggests the account is reliable.", BALANCE_NOTE],
    // Notes that give a goal, an earlier episode, a qualifier after a comma or an exception.
    ["He returned to normal duties.", "LTG: back on full duties."],
    ["He returned to normal duties.", "Objectives: back on full duties."],
    ["He returned to normal duties.", "Had a similar injury in 2019 and was back on full duties after 4 weeks. Currently off work."],
    ["He returned to normal duties.", "Back on full duties, but avoiding lifting."],
    ["He returned to normal duties.", "Back on full duties, except lifting."],
    ["He has returned to all his normal activities.", "Back to all activities other than running."],
    ["He returned to normal duties.", "Back on full duties is unrealistic at present."],
    ["He returned to normal duties.", "Back on full duties Monday."],
  ];
  for (const [draft, note] of block) assert.notDeepEqual(opinionLabels(draft, note), [], `${draft} | ${note}`);
  const pass: Array<[draft: string, note: string]> = [
    ["Sessions focused on strengthening and on balance, with step-ups.", BALANCE_NOTE],
    ["Treatment progressed to split squats, with work on balance.", BALANCE_NOTE],
    ["He worked on balance and strength.", BALANCE_NOTE],
    ["Side-stepping and cutting drills caused mild discomfort on the inner side of the knee.", "Side-stepping and cutting drills cause mild discomfort on the inner side of the knee."],
    // Jordan Ellery's discharge note (welcome pack): "Working full time with no restrictions".
    ["Yes – he has returned to his normal duties and is working full time with no restrictions.", "Working full time with no restrictions."],
    ["He has now returned to his normal working hours.", "Working full time with no restrictions."],
  ];
  for (const [draft, note] of pass) assert.deepEqual(opinionLabels(draft, note), [], `${draft} | ${note}`);
});

test("opinion: an unsupported full return blocks drafted text with no acknowledgement; edited text needs a reason", () => {
  const ai = para("He returned to normal duties.", ["N-002"]);
  const report = withSection(testReport(EMP), "functional_status", [ai]);
  const [flag] = of(run(report, EMP), "OPINION_LANGUAGE", ai.id);
  assert.equal(flag.evidence, "returned to normal duties"); // N-002 records "amended duties"
  assert.equal(flag.severity, "blocking");
  assert.equal(canAcknowledge(flag, report), false);
  const edited = withSection(report, "functional_status", [{ ...ai, origin: "edited" }]);
  const [own] = of(run(edited, EMP), "OPINION_LANGUAGE", ai.id);
  assert.equal(canAcknowledge(own, edited), true);
  assert.equal(own.acknowledged, undefined);
});

/* ------------------------------------------------------------------------------------------------
 * Scope terms
 * ----------------------------------------------------------------------------------------------*/

test("scope: excluded terms block in any origin for a scoped template, longest term wins", () => {
  const ai = para("There is no relevant past medical history.", ["N-001"]);
  const own = para("He is a non-smoker.", [], { origin: "clinician" });
  const emp = run(withSection(testReport(EMP), "reason_for_referral", [ai, own]), EMP);
  assert.deepEqual(of(emp, "SCOPE_TERM", ai.id).map((f) => f.evidence), ["past medical history"]);
  assert.deepEqual(of(emp, "SCOPE_TERM", own.id).map((f) => f.evidence), ["smoker"]);
  assert.ok(of(emp, "SCOPE_TERM").every((f) => f.severity === "blocking" && !canAcknowledge(f)));
  // The solicitor template has no scope; the employer declaration is fixed text and not checked.
  assert.equal(of(run(withSection(testReport(SOL), "incident_history", [ai]), SOL), "SCOPE_TERM").length, 0);
  assert.equal(of(emp, "SCOPE_TERM").filter((f) => f.sectionKey === "declaration").length, 0);
});

/* ------------------------------------------------------------------------------------------------
 * Gaps, placeholders, data checks, determinism, robustness
 * ----------------------------------------------------------------------------------------------*/

test("gaps and placeholders: open gaps and empty sections block until dealt with", () => {
  let report = withSection(testReport(SOL), "prognosis", [], "needs_input");
  report = {
    ...report,
    gaps: [{ id: "g1", sectionKey: "prognosis", issue: "No prognosis is recorded.", suggestedQuestion: "What is your prognosis?", relatedNoteIds: ["N-002"] }],
  };
  const flags = run(report, SOL);
  const gap = of(flags, "OPEN_GAP")[0];
  assert.equal(gap.gapId, "g1");
  assert.equal(gap.severity, "blocking");
  assert.ok(of(flags, "MISSING_PLACEHOLDER").some((f) => f.sectionKey === "prognosis" && !f.paragraphId));
  // Undrafted sections are listed too.
  assert.ok(of(flags, "MISSING_PLACEHOLDER").some((f) => f.sectionKey === "incident_history"));

  const left = para("[CLAIMANT] reported pain on XX/XX/XXXX [TBC].", ["N-001"]);
  const placeholders = of(run(withSection(report, "incident_history", [left]), SOL), "MISSING_PLACEHOLDER", left.id);
  assert.deepEqual(placeholders.map((f) => f.evidence), ["[CLAIMANT]", "[TBC]", "XX/XX/XXXX"]);

  const resolved = { ...report, gaps: report.gaps.map((g) => ({ ...g, resolution: { kind: "resolved" as const, text: "Written.", at: "2026-10-06T10:00:00.000Z" } })) };
  assert.equal(of(run(resolved, SOL), "OPEN_GAP").length, 0);
});

test("runValidators: data checks become flags; blocking consent cannot be acknowledged", () => {
  const bundle = testBundle();
  bundle.consent = { disclosureConsentRecorded: false };
  const report = testReport(SOL, bundle);
  const flags = run(report, SOL);
  const consent = flags.find((f) => f.code === "DATA_CHECK" && f.evidence === "CONSENT_NOT_RECORDED");
  assert.equal(consent?.severity, "blocking");
  assert.equal(canAcknowledge(consent as ReportFlag), false);
  const dna = flags.find((f) => f.code === "DATA_CHECK" && f.evidence === "DNA_WITHOUT_REASON");
  assert.equal(dna?.severity, "warning");
  assert.ok(!flags.some((f) => f.evidence === "MULTIPLE_CLINICIANS"), "info checks are dropped");
  assert.equal(flags[flags.length - 1].code, "DATA_CHECK", "report-level flags come last");
});

test("runValidators: deterministic, stable IDs; warning acknowledgements carry over, blocking ones only where allowed", () => {
  const p = para("On 19/03/2026 pain was 8/10.", ["N-001"]);
  const u = para("No source.", []);
  const report = withSection(testReport(SOL), "presenting_complaints", [p, u]);
  const a = run(report, SOL);
  const b = run(structuredClone(report), SOL);
  assert.deepEqual(a, b);
  assert.equal(new Set(a.map((f) => f.id)).size, a.length);

  const at = "2026-10-06T11:00:00.000Z";
  const acked = { ...report, flags: a.map((f) => ({ ...f, acknowledged: { reason: "Checked with the clinician.", at } })) };
  const c = run(acked, SOL);
  const byEvidence = (ev: string) => c.find((f) => f.paragraphId === p.id && f.evidence === ev);
  assert.equal(byEvidence("8")?.acknowledged?.at, at); // number warning
  assert.equal(byEvidence("19/03/2026")?.acknowledged?.reason, "Checked with the clinician."); // date: allowed
  assert.equal(of(c, "UNCITED_PARAGRAPH", u.id)[0].acknowledged, undefined); // not allowed
  assert.equal(of(c, "OPEN_GAP").length, 0);
});

test("runValidators: never throws on malformed content", () => {
  const report = testReport(SOL);
  const broken = {
    ...report,
    sections: report.sections.map((s) =>
      s.key === "incident_history"
        ? { ...s, paragraphs: [{ id: "x", text: undefined, sourceIds: undefined, origin: "ai" }, { id: "y", text: 42, sourceIds: [null, 7], origin: "ai" }] }
        : s,
    ),
    gaps: undefined,
    flags: undefined,
  } as unknown as Report;
  assert.doesNotThrow(() => run(broken, SOL));
});

test("validateReport: computes facts from the snapshot and returns canSign", () => {
  const report = testReport(SOL);
  const r = validateReport(report, SOL);
  assert.equal(r.canSign, false); // narrative sections not drafted yet
  assert.ok(r.blocking.length > 0);
  assert.deepEqual(r.flags, run(report, SOL));
});

/* ------------------------------------------------------------------------------------------------
 * Fix round 1 (B0-1): another clinician's notes in the signer's first person
 * ----------------------------------------------------------------------------------------------*/

test("fix round 1: 'told me' / 'My assessment' / 'in my opinion' citing another clinician's note blocks; the signer's own note does not", () => {
  // Every note written by Tom Ellis; Sarah Reid is the author who signs.
  const tom = { name: "Tom Ellis", hcpc: "PH-DEMO-02", role: "Physiotherapist, MCSP" };
  const bundle = testBundle();
  const allTom = { ...bundle, notes: bundle.notes.map((n) => ({ ...n, author: tom })) };
  const sarah = { name: "Sarah Reid", hcpc: "PH-DEMO-01", role: "Senior Physiotherapist, MCSP" };
  const told = para("Mr Testcase told me that the pain started when he lifted a parcel.", ["N-001"], { basis: "patient_reported" });
  const assessed = para("My assessment on 18/03/2026 was acute mechanical low back pain.", ["N-001"]);
  const opinion = para("On 06/05/2026, in my opinion, he is fit for a phased return to normal duties over 2 weeks.", ["N-002"], { basis: "clinician_opinion_recorded" });
  const report = { ...withSection(testReport(SOL, allTom), "presenting_complaints", [told, assessed, opinion]), author: sarah };
  const flags = run(report, SOL);
  for (const p of [told, assessed, opinion]) {
    const f = of(flags, "OTHER_CLINICIAN_VOICE", p.id)[0];
    assert.equal(f?.severity, "blocking", p.text);
    assert.equal(f?.evidence, "Tom Ellis");
    assert.match(f?.message ?? "", /written by Tom Ellis/);
    assert.equal(canAcknowledge(f, report), false, "drafted text: name the clinician or rewrite it");
  }
  assert.equal(validateReport(report, SOL).canSign, false);

  // The same words citing Sarah Reid's own note (N-001 in the test bundle) raise nothing.
  const own = { ...withSection(testReport(SOL), "presenting_complaints", [{ ...told, id: "own-1" }, { ...assessed, id: "own-2" }]), author: sarah };
  assert.equal(of(run(own, SOL), "OTHER_CLINICIAN_VOICE").length, 0);

  // Edited by the clinician: still flagged, but they may acknowledge it (it is their own account).
  const edited = { ...report, sections: report.sections.map((s) => (s.key === "presenting_complaints" ? { ...s, paragraphs: [{ ...told, origin: "edited" as const, originalText: told.text }] } : s)) };
  const ef = of(run(edited, SOL), "OTHER_CLINICIAN_VOICE")[0];
  assert.equal(ef?.severity, "blocking");
  assert.equal(canAcknowledge(ef, edited), true);
});

/* ------------------------------------------------------------------------------------------------
 * Fix round 1 (B0-7): conditional questions
 * ----------------------------------------------------------------------------------------------*/

test("fix round 1: “IF YES, PLEASE DETAIL” after “NO” and “If not back at work…” after “Yes” are not asked – no blocking check, printed blank", async () => {
  const { conditionOf, conditionWanted } = await import("../conditions");
  const { buildFormAnswers } = await import("../forms");
  assert.deepEqual(conditionWanted("IF YES, PLEASE DETAIL"), { wants: "yes", anyOfAbove: false });
  assert.deepEqual(conditionWanted("If not back at work, expected return to work date"), { wants: "no", anyOfAbove: false });
  assert.deepEqual(conditionWanted("Frequency – if other, details"), { wants: "other", anyOfAbove: false });
  assert.deepEqual(conditionWanted("If yes to any of the above, note detail"), { wants: "yes", anyOfAbove: true });
  assert.equal(conditionWanted("Has the patient returned to work?"), null);
  const sec = (key: string, title: string, answer?: ReportSection_["answer"], text = "") => ({ key, title, kind: "ai_narrative" as const, status: "drafted" as const, fieldId: key, paragraphs: text ? [{ id: `${key}-p1`, text, sourceIds: ["N-001"], origin: "ai" as const }] : [], ...(answer ? { answer } : {}) });
  const sections = [
    sec("F-27", "Has the patient returned to work?", { kind: "yes_no", value: true }),
    sec("F-28", "If not back at work, expected return to work date", { kind: "date", value: null }),
    sec("F-32", "ANY FURTHER TREATMENT RECOMMENDED?", { kind: "yes_no", value: false }),
    sec("F-33", "IF YES, PLEASE DETAIL", undefined, "Request 3 further sessions."),
  ];
  assert.equal(conditionOf(sections, "F-28")?.applies, false);
  assert.equal(conditionOf(sections, "F-33")?.because, "“ANY FURTHER TREATMENT RECOMMENDED?” is “No”");
  const base = testReport(SOL);
  const report = { ...base, sections: [...base.sections, ...sections] } as unknown as Report;
  const template = { ...SOL, sections: [...SOL.sections, ...sections.map((s) => ({ key: s.key, title: s.title, kind: s.kind, required: true, guidance: "" }))] } as unknown as ReportTemplate;
  const flags = run(report, template);
  assert.equal(flags.filter((f) => f.sectionKey === "F-28" || f.sectionKey === "F-33").length, 0, "no “required, no answer” and no checks on the drafted text");
  const form = { fields: sections.map((s) => ({ id: s.key, label: s.title, guidance: "", answerType: "long_text", anchor: { kind: "docx", target: "table_cell", blockId: "t0.r0.c0" }, fillSource: { kind: "notes_narrative" }, required: true, confidence: "high" })) } as never;
  assert.deepEqual(buildFormAnswers({ sections } as never, form)["F-33"], { leftBlank: true }, "the drafted detail is not printed");
  // Answered "Yes" after all: it applies again.
  const yes = sections.map((s) => (s.key === "F-32" ? { ...s, answer: { kind: "yes_no" as const, value: true } } : s));
  assert.equal(conditionOf(yes, "F-33")?.applies, true);
});

type ReportSection_ = import("../types").ReportSection;

/* ------------------------------------------------------------------------------------------------
 * Fix round 1 (B0-5, B0-6, B0-16, B0-23): drafted wording that does not fit its place on the form (warnings)
 * ----------------------------------------------------------------------------------------------*/

test("fix round 1: a dated, attributed sentence in a table cell, a repeated row, commentary and a later note on an IA form are warnings", () => {
  const bundle = testBundle(); // N-001 18/03/2026 initial assessment, N-002 06/05/2026 discharge
  const cell = (id: string, label: string) => ({ id, label, guidance: "", answerType: "short_text", anchor: { kind: "docx", target: "table_cell", blockId: `t4.r${id.slice(2)}.c0` }, fillSource: { kind: "notes_narrative" }, required: false, confidence: "high" });
  const fields = [cell("F-28", "Activity 1"), cell("F-29", "Activity 1 – frequency"), cell("F-32", "Activity 2"), { ...cell("F-40", "Present condition"), answerType: "long_text", anchor: { kind: "docx", target: "after_paragraph", blockId: "p40" } }];
  const sec = (key: string, title: string, text: string, ids = ["N-001"]) => ({ key, title, kind: "ai_narrative" as const, status: "drafted" as const, fieldId: key, paragraphs: [{ id: `${key}-p1`, text, sourceIds: ids, origin: "ai" as const }] });
  const base = testReport(SOL, bundle);
  const report = {
    ...base,
    form: { formId: "frm_10bridge_ia", title: "Initial Assessment Report", referrer: { name: "10Bridge", type: "mlc" }, fileSha256: "0".repeat(64), kind: "docx" },
    sections: [
      sec("F-28", "Activity 1", "Mr Testcase told Tom Ellis, physiotherapist, on 18/03/2026 that he walks the dog every day."),
      sec("F-29", "Activity 1 – frequency", "Daily"),
      sec("F-32", "Activity 2", "He walks the dog every day."),
      sec("F-40", "Present condition", "The notes are written by Sarah Reid. On 06/05/2026 his back pain was 2/10 at worst.", ["N-002"]),
    ],
  } as unknown as Report;
  const template = { ...SOL, sections: report.sections.map((s) => ({ key: s.key, title: s.title, kind: s.kind, required: false, guidance: "" })) } as unknown as ReportTemplate;
  const flags = runValidators({ report, bundle, template, computedFacts: computeFacts(bundle, { asOf: TEST_FACTS_DATE }), form: { analysis: { mode: "rules", promptVersion: "t", at: "2026-10-25T09:00:00.000Z", warnings: [] }, fields } as never }).filter((f) => f.code === "DRAFT_FIT");
  const by = (key: string, ev: string) => flags.find((f) => f.sectionKey === key && (f.evidence ?? "").startsWith(ev));
  assert.match(by("F-28", "shorten")?.message ?? "", /^Shorten for the box: this answer goes in a table cell/);
  assert.equal(by("F-29", "shorten"), undefined, "“Daily” is the value alone");
  assert.match(by("F-32", "repeat")?.message ?? "", /^This repeats “Activity 1” \(F-28\)/);
  assert.match(by("F-40", "comment")?.message ?? "", /^Remove the comment about the notes \(“The notes are written by/);
  assert.match(by("F-40", "later note")?.message ?? "", /^From a later note of 06\/05\/2026 – check it belongs on an initial assessment \(18\/03\/2026\)\.$/);
  assert.ok(flags.filter((f) => !(f.evidence ?? "").startsWith("repeat")).every((f) => f.severity === "warning"), "never blocking");
  // Fix round 2 (B1-4): the same item drafted in two rows blocks (acknowledgeable) – see the test below.
  assert.equal(by("F-32", "repeat")?.severity, "blocking");
});

test("fix round 2 (B1-4): rows are compared by their name cell – a repeated item blocks, equal frequencies or statuses never flag", () => {
  const bundle = testBundle();
  const cell = (id: string, label: string) => ({ id, label, guidance: "", answerType: "short_text", anchor: { kind: "docx", target: "table_cell", blockId: `t4.r${id.slice(2)}.c0` }, fillSource: { kind: "notes_narrative" }, required: false, confidence: "high" });
  const labels: Array<[string, string]> = [
    ["F-28", "Activity 1"],
    ["F-29", "Activity 1 – frequency before the injury"],
    ["F-30", "Activity 1 – frequency since the injury"],
    ["F-32", "Activity 2"],
    ["F-33", "Activity 2 – frequency before the injury"],
    ["F-34", "Activity 2 – frequency since the injury"],
  ];
  const fields = labels.map(([id, l]) => cell(id, l));
  const template = { ...SOL, sections: labels.map(([key, title]) => ({ key, title, kind: "ai_narrative", required: false, guidance: "" })) } as unknown as ReportTemplate;
  const flagsFor = (texts: Record<string, string>) => {
    const sections = labels.map(([key, title]) => ({ key, title, kind: "ai_narrative" as const, status: "drafted" as const, fieldId: key, paragraphs: texts[key] ? [{ id: `${key}-p1`, text: texts[key], sourceIds: ["N-001"], origin: "ai" as const }] : [] }));
    const report = { ...testReport(SOL, bundle), sections } as unknown as Report;
    return runValidators({ report, bundle, template, computedFacts: computeFacts(bundle, { asOf: TEST_FACTS_DATE }), form: { analysis: { mode: "rules", promptVersion: "t", at: "2026-10-25T09:00:00.000Z", warnings: [] }, fields } as never }).filter((f) => f.code === "DRAFT_FIT" && (f.evidence ?? "").startsWith("repeat"));
  };
  // Reuben (10Bridge IA): running drafted twice, football missing.
  const reuben = flagsFor({ "F-28": "Running", "F-29": "Twice a week, 10 km", "F-32": "Running", "F-33": "Twice a week (10 km)" });
  assert.deepEqual(reuben.map((f) => [f.sectionKey, f.severity, f.evidence]), [["F-32", "blocking", "repeat F-28"]], "the name cell blocks; its frequency cell is not flagged on its own");
  assert.equal(canAcknowledge(reuben[0]), true, "acknowledged with a reason when both rows are right");
  // Jordan (10Bridge IA): two activities that really both stopped.
  assert.deepEqual(flagsFor({ "F-28": "Driving", "F-30": "Stopped since the accident", "F-32": "Gym", "F-34": "Stopped since the accident" }), []);
});

test("fix round 2 (B1-3): a fragment the first-person rewrite left gets a “Check the wording” warning", () => {
  const ps = [
    para("On 15/07/2026: that he was fit and well before the accident.", ["N-001"]),
    para("Past medical history: that he was fit and well.", ["N-001"]),
    para("On 15/07/2026: in my plan about 6 sessions over 8 weeks.", ["N-001"]),
    para("On 18/03/2026: a painful arc of movement when bending.", ["N-001"]),
  ];
  const report = withSection(testReport(SOL), "presenting_complaints", ps);
  const flags = run(report, SOL).filter((f) => f.code === "DRAFT_FIT" && f.evidence === "wording");
  // Fix round 3 (B2-6): a lower-case finding after a date lead and a colon is a fragment too (it was “a whole entry”) – the
  // rewrite now writes “On 18/03/2026, I recorded a painful arc…”.
  assert.deepEqual(flags.map((f) => f.paragraphId), ps.map((p) => p.id));
  assert.ok(flags.every((f) => f.severity === "warning"));
  assert.match(flags[0].message, /^Check the wording: “On 15\/07\/2026: that he was fit and well before…” is not a whole sentence – it would be printed as it is\.$/);
});
