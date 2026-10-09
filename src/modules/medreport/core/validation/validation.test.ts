import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPLOYER_FFW_TEMPLATE, SOLICITOR_RTA_TEMPLATE } from "../../templates/registry";
import { computeFacts } from "../computed-facts";
import { ReportFlagSchema } from "../schemas";
import type { Report, ReportFlag, ReportTemplate } from "../types";
import { canAcknowledge, canSign, runValidators, validateReport } from "./index";
import { findUnsupportedOpinionPhrases } from "./opinion-language";
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
