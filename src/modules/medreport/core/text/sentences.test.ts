/**
 * The shared sentence tokenizer and safe-edit primitives (bh-quality plan W0.5). Table-driven: every row is
 * also run through the structural invariants (offsets, trimming, white space between spans, no cut inside a
 * figure, re-splitting a span gives the span, mapSentences identity, whole-sentence removal keeps every
 * figure). Fictional data only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkSafeEdit,
  expandToSentences,
  figureChanges,
  figuresOf,
  isSentenceStart,
  mapSentences,
  removeSentences,
  sentenceAt,
  sentenceKey,
  sentenceStartProblem,
  sentenceTexts,
  splitSentences,
  type SafeEditProblem,
  type SentencePolicy,
  type SentenceSpan,
} from "./sentences";

interface Row {
  id: string;
  text: string;
  expect: string[];
  policy?: SentencePolicy;
  /** Expected list markers, by span index. */
  markers?: Record<number, string>;
}

/* ------------------------------------------------------------------------------------------------
 * Invariants every split must satisfy
 * ----------------------------------------------------------------------------------------------*/

/** Numbers with inner punctuation (decimals, dates, scores, ranges, times): a cut may never fall inside one. */
const JOINED_FIGURE = /\d+(?:[.,:/\-–]\d+)+%?/g;

function assertWellFormed(text: string, spans: readonly SentenceSpan[], policy: SentencePolicy, label: string): void {
  let last = 0;
  spans.forEach((s, k) => {
    assert.equal(s.index, k, `${label}: index`);
    assert.ok(s.start >= last && s.start < s.end, `${label}: span ${k} ordered and non-empty`);
    assert.equal(s.text, text.slice(s.start, s.end), `${label}: span ${k} text is its slice`);
    assert.ok(!/^\s|\s$/.test(s.text), `${label}: span ${k} is trimmed`);
    assert.ok(/^\s*$/.test(text.slice(last, s.start)), `${label}: only white space before span ${k}`);
    assert.ok(s.bodyStart >= s.start && s.bodyStart <= s.end, `${label}: span ${k} bodyStart inside`);
    assert.equal(s.marker !== undefined, s.bodyStart > s.start || (s.marker !== undefined && s.bodyStart === s.end), `${label}: marker iff body offset`);
    last = s.end;
  });
  assert.ok(/^\s*$/.test(text.slice(last)), `${label}: only white space after the last span`);
  const figure = new RegExp(JOINED_FIGURE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = figure.exec(text)) !== null) {
    const from = m.index;
    const to = from + m[0].length;
    assert.ok(spans.some((s) => s.start <= from && to <= s.end), `${label}: figure "${m[0]}" is never cut`);
  }
  assert.equal(mapSentences(text, (s) => s.text, policy), text, `${label}: mapSentences identity`);
  for (const s of spans) {
    const again = splitSentences(s.text, policy);
    assert.equal(again.length, 1, `${label}: re-splitting span ${s.index} "${s.text}" gives one span (got ${JSON.stringify(again.map((x) => x.text))})`);
  }
  for (const s of spans) {
    const { after, removedSpans } = removeSentences(text, [s.index], policy);
    const problems = checkSafeEdit({ before: text, after, removedSpans, policy }).filter((p) => p.kind === "partial_sentence" || p.kind === "figures_changed");
    assert.deepEqual(problems, [], `${label}: removing span ${s.index} keeps whole sentences and every other figure`);
  }
}

function runTable(name: string, rows: readonly Row[]): void {
  for (const row of rows) {
    test(`sentences ${name} ${row.id}: ${JSON.stringify(row.text).slice(0, 70)}`, () => {
      const policy = row.policy ?? "prose";
      const spans = splitSentences(row.text, policy);
      assert.deepEqual(
        spans.map((s) => s.text),
        row.expect,
      );
      if (row.markers) {
        for (const [k, marker] of Object.entries(row.markers)) assert.equal(spans[Number(k)].marker, marker, `marker of span ${k}`);
      }
      assertWellFormed(row.text, spans, policy, row.id);
    });
  }
}

/* ------------------------------------------------------------------------------------------------
 * The plan's tokenizer table (W0.5 tests), verbatim
 * ----------------------------------------------------------------------------------------------*/

test("sentences plan table: never splits '8.0, a mild ache', '52.3 to 29.5', 'VAS 6.5/10', 'Mr. Ellery', 'e.g. neck', 'approx. 6 sessions', '08.09.2026'", () => {
  for (const phrase of ["8.0, a mild ache", "52.3 to 29.5", "VAS 6.5/10", "Mr. Ellery", "e.g. neck", "approx. 6 sessions", "08.09.2026"]) {
    for (const policy of ["prose", "notes"] as const) {
      const text = `Before this, ${phrase} was recorded. Then he went home.`;
      const spans = sentenceTexts(text, policy);
      assert.equal(spans.length, 2, `${policy}: "${phrase}" → ${JSON.stringify(spans)}`);
      assert.ok(spans[0].indexOf(phrase) >= 0, `${policy}: "${phrase}" stays in one sentence`);
    }
  }
});

test("sentences plan table: splits '…at rest. He reported…' and '…10/10. Pain eased.'", () => {
  assert.deepEqual(sentenceTexts("Pain 4/10 at rest. He reported less stiffness."), ["Pain 4/10 at rest.", "He reported less stiffness."]);
  assert.deepEqual(sentenceTexts("Pain was 10/10. Pain eased."), ["Pain was 10/10.", "Pain eased."]);
});

test("sentences plan table: notes policy gives 3 sentences for 'pain 3/10 at rest. prev back injury 2019, settled. gym 2x/wk.'", () => {
  const text = "pain 3/10 at rest. prev back injury 2019, settled. gym 2x/wk.";
  assert.deepEqual(sentenceTexts(text, "notes"), ["pain 3/10 at rest.", "prev back injury 2019, settled.", "gym 2x/wk."]);
  assert.deepEqual(sentenceTexts(text, "prose"), [text], "prose never splits before a lower-case word");
  assert.deepEqual(sentenceTexts(text), [text], "the default policy is prose");
});

/* ------------------------------------------------------------------------------------------------
 * Figures and decimals
 * ----------------------------------------------------------------------------------------------*/

runTable("figures", [
  {
    id: "fig-01 TS-01 (B3-2)",
    text: "She recorded a Patient-Specific Functional Scale score of 8.0, a mild ache on the inner side of the knee after cutting drills.",
    expect: ["She recorded a Patient-Specific Functional Scale score of 8.0, a mild ache on the inner side of the knee after cutting drills."],
  },
  {
    id: "fig-02 TS-02 (R-regression-3)",
    text: "QuickDASH 52.3 to 29.5 and Patient-Specific Functional Scale 2.7 to 5.3 since 01/09/2026.",
    expect: ["QuickDASH 52.3 to 29.5 and Patient-Specific Functional Scale 2.7 to 5.3 since 01/09/2026."],
  },
  { id: "fig-03", text: "VAS 6.5/10 at worst. Sleep was disturbed.", expect: ["VAS 6.5/10 at worst.", "Sleep was disturbed."] },
  { id: "fig-04 percent", text: "Oswestry Disability Index 60.5%, down from 72.0% at the first visit.", expect: ["Oswestry Disability Index 60.5%, down from 72.0% at the first visit."] },
  { id: "fig-05 percent end", text: "Her ODI was 60.5%. It had been 72.0%.", expect: ["Her ODI was 60.5%.", "It had been 72.0%."] },
  { id: "fig-06 cm", text: "A 1.5cm swelling was noted over the lateral ankle. It had settled by 22/09/2026.", expect: ["A 1.5cm swelling was noted over the lateral ankle.", "It had settled by 22/09/2026."] },
  { id: "fig-07 kg", text: "Grip strength 28.4 kg on the left and 31.0 kg on the right.", expect: ["Grip strength 28.4 kg on the left and 31.0 kg on the right."] },
  { id: "fig-08 degrees", text: "Flexion improved from 95.5° to 120.0° over 4 weeks.", expect: ["Flexion improved from 95.5° to 120.0° over 4 weeks."] },
  { id: "fig-09 hours", text: "Standing tolerance 0.5 hours. Sitting tolerance 1.25 hours.", expect: ["Standing tolerance 0.5 hours.", "Sitting tolerance 1.25 hours."] },
  { id: "fig-10 leading point", text: "The score fell to .5 on the scale.", expect: ["The score fell to .5 on the scale."] },
  { id: "fig-11 metres", text: "He was 1.82 m tall and weighed 84.5 kg. BMI 25.5.", expect: ["He was 1.82 m tall and weighed 84.5 kg.", "BMI 25.5."] },
  { id: "fig-12 decimal range", text: "Pain 6.5–7.0/10 at rest.", expect: ["Pain 6.5–7.0/10 at rest."] },
  { id: "fig-13 score end", text: "Pain was 10/10. Pain eased.", expect: ["Pain was 10/10.", "Pain eased."] },
  { id: "fig-14 before a figure", text: "Her ODI was 46%. 2 weeks later it was 30%.", expect: ["Her ODI was 46%.", "2 weeks later it was 30%."] },
  { id: "fig-15 times", text: "Seen at 10.30am. Next review at 9.15.", expect: ["Seen at 10.30am.", "Next review at 9.15."] },
  { id: "fig-16 decimal at the end", text: "The score was 8.0. A mild ache remained.", expect: ["The score was 8.0.", "A mild ache remained."] },
  { id: "fig-17 thousands", text: "1,250 steps a day were recorded at the first session.", expect: ["1,250 steps a day were recorded at the first session."] },
  { id: "fig-18 N-1", text: "PSFS 6.5 for stairs. Previous back injury, settled.", expect: ["PSFS 6.5 for stairs.", "Previous back injury, settled."] },
  { id: "fig-19 two decimals in a row", text: "QuickDASH 52.3 to 29.5 … PSFS 2.7 to 5.3.", expect: ["QuickDASH 52.3 to 29.5 … PSFS 2.7 to 5.3."] },
  { id: "fig-20 fraction then decimal", text: "NPRS 7/10 to 3.5/10 over 6 weeks. He was pleased.", expect: ["NPRS 7/10 to 3.5/10 over 6 weeks.", "He was pleased."] },
  { id: "fig-21 money", text: "The invoice was £85.50. Paid on 01/10/2026.", expect: ["The invoice was £85.50.", "Paid on 01/10/2026."] },
  { id: "fig-22 before a currency sign", text: "The invoice was paid. £85.50 was received.", expect: ["The invoice was paid.", "£85.50 was received."] },
]);

/* ------------------------------------------------------------------------------------------------
 * Dates and times
 * ----------------------------------------------------------------------------------------------*/

runTable("dates", [
  { id: "date-01 dotted", text: "Seen on 08.09.2026 for review.", expect: ["Seen on 08.09.2026 for review."] },
  { id: "date-02 slashes", text: "Assessed on 01/09/2026. Reviewed on 15/09/2026.", expect: ["Assessed on 01/09/2026.", "Reviewed on 15/09/2026."] },
  { id: "date-03 dashes", text: "Injury on 12-03-2026 at work.", expect: ["Injury on 12-03-2026 at work."] },
  { id: "date-04 month abbreviation before a year", text: "Seen on 8 Sept. 2026 by Tom Ellis.", expect: ["Seen on 8 Sept. 2026 by Tom Ellis."] },
  { id: "date-05 month abbreviation before a capital", text: "Seen on 3 Jan. He reported less pain.", expect: ["Seen on 3 Jan.", "He reported less pain."] },
  { id: "date-06 date range", text: "Treated 01/09/2026–29/09/2026, 5 sessions.", expect: ["Treated 01/09/2026–29/09/2026, 5 sessions."] },
  { id: "date-07 ISO", text: "Last seen 2026-10-01. Discharged.", expect: ["Last seen 2026-10-01.", "Discharged."] },
  { id: "date-08 clock time", text: "Seen at 14:30 on 08/09/2026. Pain eased.", expect: ["Seen at 14:30 on 08/09/2026.", "Pain eased."] },
  { id: "date-09 short year", text: "Injured on 8.9.26 lifting a box. He rested.", expect: ["Injured on 8.9.26 lifting a box.", "He rested."] },
  { id: "date-10 dotted date at the end", text: "Next review 08.09.2026. Sarah Reid will see him.", expect: ["Next review 08.09.2026.", "Sarah Reid will see him."] },
]);

/* ------------------------------------------------------------------------------------------------
 * Ranges and lists
 * ----------------------------------------------------------------------------------------------*/

runTable("ranges and lists", [
  { id: "range-01", text: "He attended 3–5 sessions a month.", expect: ["He attended 3–5 sessions a month."] },
  { id: "range-02", text: "Advised 2-3 sets of 10 repetitions, 3 – 5 times a week.", expect: ["Advised 2-3 sets of 10 repetitions, 3 – 5 times a week."] },
  { id: "range-03 comma list", text: "Pain 3/10 to 5/10, worse on stairs, hills and slopes.", expect: ["Pain 3/10 to 5/10, worse on stairs, hills and slopes."] },
  { id: "range-04 to", text: "Headaches 3 to 4 times a week. Activity 2 to 3 times a week.", expect: ["Headaches 3 to 4 times a week.", "Activity 2 to 3 times a week."] },
  {
    id: "list-01 inline numbered after a colon",
    text: "Exercises: 1. Bridges 2. Clams 3. Side planks. He was advised to continue.",
    expect: ["Exercises: 1. Bridges 2. Clams 3. Side planks.", "He was advised to continue."],
  },
  { id: "list-02 dash bullets", text: "Plan:\n- bridges\n- clams\n- side planks", expect: ["Plan:", "- bridges", "- clams", "- side planks"], markers: { 1: "-", 2: "-", 3: "-" } },
  {
    id: "list-03 numbered lines",
    text: "1. Walk daily.\n2. Return to work.\n3. Review in 2 weeks.",
    expect: ["1. Walk daily.", "2. Return to work.", "3. Review in 2 weeks."],
    markers: { 0: "1.", 1: "2.", 2: "3." },
  },
  { id: "list-04 round bullets", text: "• Neck pain 3/10\n• Back pain 5/10", expect: ["• Neck pain 3/10", "• Back pain 5/10"], markers: { 0: "•", 1: "•" } },
  { id: "list-05 bullets inside a line", text: "Neck pain • Back pain • Headaches", expect: ["Neck pain", "• Back pain", "• Headaches"], markers: { 1: "•", 2: "•" } },
  { id: "list-06 an inline numbered list with stops stays whole", text: "Goals: 1. Walk 5km. 2. Return to work. He agreed.", expect: ["Goals: 1. Walk 5km. 2. Return to work.", "He agreed."] },
  { id: "list-06b a numbered line with stops stays whole", text: "1. Walk 5km. 2. Return to work.\n3. Review.", expect: ["1. Walk 5km. 2. Return to work.", "3. Review."], markers: { 0: "1.", 1: "3." } },
  { id: "list-07 lettered inline", text: "a) neck pain b) back pain c) headaches", expect: ["a) neck pain b) back pain c) headaches"] },
  { id: "list-08 lettered lines", text: "(a) Neck pain.\n(b) Back pain.", expect: ["(a) Neck pain.", "(b) Back pain."], markers: { 0: "(a)", 1: "(b)" } },
  { id: "list-09 lower-case letter markers", text: "a. neck pain b. back pain", expect: ["a. neck pain b. back pain"] },
  { id: "list-09b lettered list with capitals", text: "Problems: a. Neck pain b. Back pain c. Headaches. He agreed.", expect: ["Problems: a. Neck pain b. Back pain c. Headaches.", "He agreed."] },
  { id: "list-09c lettered line with capitals", text: "a. Neck pain\nb. Back pain", expect: ["a. Neck pain", "b. Back pain"], markers: { 0: "a.", 1: "b." } },
  { id: "list-10 numbered with brackets", text: "Plan:\n1) bridges\n2) clams", expect: ["Plan:", "1) bridges", "2) clams"], markers: { 1: "1)", 2: "2)" } },
  { id: "list-11 en dash bullets", text: "– Neck pain\n– Back pain", expect: ["– Neck pain", "– Back pain"], markers: { 0: "–", 1: "–" } },
  { id: "list-12 a score after a colon is not a list", text: "NPRS: 7. Worse at night.", expect: ["NPRS: 7.", "Worse at night."] },
  { id: "list-13 a week number is not a list", text: "He was seen in week 1. 2 sessions were missed.", expect: ["He was seen in week 1.", "2 sessions were missed."] },
  { id: "list-14 numbered sessions", text: "Session 1. Pain 7/10. Session 2. Pain 5/10.", expect: ["Session 1.", "Pain 7/10.", "Session 2.", "Pain 5/10."] },
  { id: "list-15 star bullets", text: "* Neck pain\n* Back pain", expect: ["* Neck pain", "* Back pain"], markers: { 0: "*", 1: "*" } },
  { id: "list-16 inline numbered, lower case", text: "Exercises: 1. bridges, 2. clams and 3. side planks, daily.", expect: ["Exercises: 1. bridges, 2. clams and 3. side planks, daily."] },
  { id: "list-17 bullet items with sentences", text: "- Pain eased. He slept well.\n- Back at work.", expect: ["- Pain eased.", "He slept well.", "- Back at work."], markers: { 0: "-", 2: "-" } },
  { id: "list-18 indented bullets", text: "Plan:\n  - bridges\n  - clams", expect: ["Plan:", "- bridges", "- clams"], markers: { 1: "-", 2: "-" } },
  { id: "list-19 roman numerals", text: "(i) Neck pain\n(ii) Back pain", expect: ["(i) Neck pain", "(ii) Back pain"], markers: { 0: "(i)", 1: "(ii)" } },
  { id: "list-20 a minus is not a bullet", text: "Extension -5° at the first visit.", expect: ["Extension -5° at the first visit."] },
]);

/* ------------------------------------------------------------------------------------------------
 * Abbreviations, titles and initials
 * ----------------------------------------------------------------------------------------------*/

runTable("abbreviations", [
  { id: "abbr-01 Mr. Dr.", text: "Mr. Ellery was assessed by Dr. Reid.", expect: ["Mr. Ellery was assessed by Dr. Reid."] },
  { id: "abbr-02 Mrs. Ms. Prof.", text: "Mrs. Shah, Ms. Morgan and Prof. Ellis attended.", expect: ["Mrs. Shah, Ms. Morgan and Prof. Ellis attended."] },
  { id: "abbr-03 e.g.", text: "Pain in the upper back, e.g. neck and shoulders, was reported.", expect: ["Pain in the upper back, e.g. neck and shoulders, was reported."] },
  { id: "abbr-04 approx.", text: "Advised approx. 6 sessions over 6 weeks.", expect: ["Advised approx. 6 sessions over 6 weeks."] },
  { id: "abbr-05 i.e.", text: "Symptoms settled, i.e. no pain at rest.", expect: ["Symptoms settled, i.e. no pain at rest."] },
  { id: "abbr-06 St.", text: "Seen at St. Thomas' Hospital in 2024. He was discharged.", expect: ["Seen at St. Thomas' Hospital in 2024.", "He was discharged."] },
  { id: "abbr-07 no. as number", text: "Claim no. 4471 was opened. No. of sessions: 6.", expect: ["Claim no. 4471 was opened.", "No. of sessions: 6."] },
  { id: "abbr-08 no. as an answer", text: "Red flags: no. He was well.", expect: ["Red flags: no.", "He was well."] },
  { id: "abbr-09 etc. at the end", text: "Stairs, hills etc. He reported less pain.", expect: ["Stairs, hills etc.", "He reported less pain."] },
  { id: "abbr-10 etc. inside", text: "Stairs, hills etc. and slopes were difficult.", expect: ["Stairs, hills etc. and slopes were difficult."] },
  { id: "abbr-11 vs.", text: "Tom Ellis vs. Priya Shah: both recorded full range.", expect: ["Tom Ellis vs. Priya Shah: both recorded full range."] },
  { id: "abbr-12 initials", text: "Seen by T. Ellis and P. Shah.", expect: ["Seen by T. Ellis and P. Shah."] },
  { id: "abbr-13 double initials", text: "Seen by J.R. Ellis on 01/09/2026.", expect: ["Seen by J.R. Ellis on 01/09/2026."] },
  { id: "abbr-14 pt. before a capital", text: "Discussed with pt. Agreed the plan.", expect: ["Discussed with pt.", "Agreed the plan."] },
  { id: "abbr-15 unit before a capital", text: "Gym 2x/wk. Sleeping well.", expect: ["Gym 2x/wk.", "Sleeping well."] },
  { id: "abbr-16 a.m. at the end", text: "Seen at 9 a.m. He was early.", expect: ["Seen at 9 a.m.", "He was early."] },
  { id: "abbr-17 a.m. inside", text: "Seen at 9 a.m. on Monday.", expect: ["Seen at 9 a.m. on Monday."] },
  { id: "abbr-18 cf.", text: "Exercise was advised (cf. the plan of 01/09/2026).", expect: ["Exercise was advised (cf. the plan of 01/09/2026)."] },
  { id: "abbr-19 NB.", text: "NB. The pain is worse at night.", expect: ["NB. The pain is worse at night."] },
  { id: "abbr-20 title before a line break", text: "Seen by Dr.\nEllery on 01/09/2026.", expect: ["Seen by Dr.\nEllery on 01/09/2026."] },
  { id: "abbr-21 initial before a surname", text: "Claimant: Mr. O. Testcase.", expect: ["Claimant: Mr. O. Testcase."] },
  { id: "abbr-22 incl. esp.", text: "Activities incl. gardening, esp. kneeling, were painful.", expect: ["Activities incl. gardening, esp. kneeling, were painful."] },
  { id: "abbr-23 e.g. then a capital", text: "Advised a home programme, e.g. Bridges and clams.", expect: ["Advised a home programme, e.g. Bridges and clams."] },
  { id: "abbr-24 e.g. with a comma", text: "Pain on loading, e.g., squats.", expect: ["Pain on loading, e.g., squats."] },
  { id: "abbr-25 title in brackets", text: "The GP (Dr. Shah) was informed. He agreed.", expect: ["The GP (Dr. Shah) was informed.", "He agreed."] },
  { id: "abbr-26 fig.", text: "See fig. 2 for the range. It improved.", expect: ["See fig. 2 for the range.", "It improved."] },
  { id: "abbr-27 Mx.", text: "Mx. Morgan booked the session.", expect: ["Mx. Morgan booked the session."] },
  { id: "abbr-28 word ending in a title's letters", text: "Seen by Sarah Reid, MSc. He was discharged.", expect: ["Seen by Sarah Reid, MSc.", "He was discharged."] },
  { id: "abbr-29 a unit letter before a capital", text: "CCFT: holds 24 mmHg x 10 s. FRT 34° L, 38° R. Palpation: TTP reduced.", expect: ["CCFT: holds 24 mmHg x 10 s.", "FRT 34° L, 38° R.", "Palpation: TTP reduced."] },
  { id: "abbr-30 sides are not initials", text: "Pain worse on the L. Rotation full.", expect: ["Pain worse on the L.", "Rotation full."] },
]);

/* ------------------------------------------------------------------------------------------------
 * Ellipses, question and exclamation marks
 * ----------------------------------------------------------------------------------------------*/

runTable("ellipses and marks", [
  { id: "ell-01", text: "He paused... Then he went on.", expect: ["He paused...", "Then he went on."] },
  { id: "ell-02", text: "The pain was... manageable.", expect: ["The pain was... manageable."] },
  { id: "ell-03 ellipsis character", text: "Pain eased… He returned to the gym.", expect: ["Pain eased…", "He returned to the gym."] },
  { id: "ell-04 leading ellipsis", text: "…at rest. He reported less pain.", expect: ["…at rest.", "He reported less pain."] },
  { id: "ell-05 ellipsis before a figure", text: "Pain eased... 3/10 by discharge.", expect: ["Pain eased... 3/10 by discharge."] },
  { id: "ell-06 an ellipsis between spaces marks left-out words", text: "QuickDASH 52.3 ... PSFS 2.7 to 5.3. He improved.", expect: ["QuickDASH 52.3 ... PSFS 2.7 to 5.3.", "He improved."] },
  { id: "q-mark-01", text: "Any red flags? None were found.", expect: ["Any red flags?", "None were found."] },
  { id: "q-mark-02 query sign", text: "Seen for ?fracture of the wrist. X-ray clear.", expect: ["Seen for ?fracture of the wrist.", "X-ray clear."] },
  { id: "q-mark-03 prose before lower case", text: "Pain? yes, on stairs.", expect: ["Pain? yes, on stairs."] },
  { id: "q-mark-04", text: "He was delighted! He returned to football.", expect: ["He was delighted!", "He returned to football."] },
  { id: "q-mark-05 mixed", text: "Really?! He said so.", expect: ["Really?!", "He said so."] },
]);

/* ------------------------------------------------------------------------------------------------
 * Quotes and brackets
 * ----------------------------------------------------------------------------------------------*/

runTable("quotes and brackets", [
  { id: "q-01 inside straight quotes", text: 'He said "pain eased. Walking better" and left.', expect: ['He said "pain eased. Walking better" and left.'] },
  { id: "q-02 stop inside the quote", text: 'Tom Ellis recorded "Pain eased." He then discharged him.', expect: ['Tom Ellis recorded "Pain eased."', "He then discharged him."] },
  { id: "q-03 inside brackets", text: "She noted (see the note of 01/09/2026. Rest was advised.) a change.", expect: ["She noted (see the note of 01/09/2026. Rest was advised.) a change."] },
  { id: "q-04 after brackets", text: "Pain eased (see note). He returned to work.", expect: ["Pain eased (see note).", "He returned to work."] },
  { id: "q-05 apostrophes", text: "The patients' notes were read. Tom’s note said ‘fine’. He agreed.", expect: ["The patients' notes were read.", "Tom’s note said ‘fine’.", "He agreed."] },
  { id: "q-06 feet and inches", text: "Height 5'10\". Weight 70kg.", expect: ["Height 5'10\".", "Weight 70kg."] },
  { id: "q-07 unmatched quote protects nothing", text: 'He wrote "pain eased. Walking better.', expect: ['He wrote "pain eased.', "Walking better."] },
  {
    id: "q-08 curly quotes",
    text: "Priya Shah recorded “no pain on stairs. Full squat.” on 01/09/2026.",
    expect: ["Priya Shah recorded “no pain on stairs. Full squat.” on 01/09/2026."],
  },
  { id: "q-09 single quotes", text: "The ‘own words’ rule applied. He agreed.", expect: ["The ‘own words’ rule applied.", "He agreed."] },
  { id: "q-10 bracketed sentence", text: "(Seen by Tom Ellis.) He reported less pain.", expect: ["(Seen by Tom Ellis.)", "He reported less pain."] },
  { id: "q-11 square brackets", text: "[Note 2. Not signed.] Seen later.", expect: ["[Note 2. Not signed.]", "Seen later."] },
  { id: "q-12 a quote never spans a line break", text: 'He said "pain eased.\nWalking better." He left.', expect: ['He said "pain eased.', 'Walking better."', "He left."] },
  { id: "q-13 straight single quotes", text: "She called it 'a twinge. Nothing more' at the time.", expect: ["She called it 'a twinge. Nothing more' at the time."] },
  { id: "q-14 sentence opening with a quote", text: 'Pain eased. "It is much better," he said.', expect: ["Pain eased.", '"It is much better," he said.'] },
  { id: "q-15 a framed quotation", text: "Tom Ellis recorded on 16/09/2026: “should settle within 4–6 weeks.” No change since.", expect: ["Tom Ellis recorded on 16/09/2026: “should settle within 4–6 weeks.”", "No change since."] },
  { id: "q-16 nested brackets", text: "Range (flexion (active) 120°. Extension full.) improved.", expect: ["Range (flexion (active) 120°. Extension full.) improved."] },
  { id: "q-17 a figure after a closed bracket goes on", text: "(Rest advised.) 3 sessions were booked.", expect: ["(Rest advised.) 3 sessions were booked."] },
  { id: "q-18 a capital after a closed quote", text: "She wrote “rest.” Tom Ellis agreed.", expect: ["She wrote “rest.”", "Tom Ellis agreed."] },
]);

/* ------------------------------------------------------------------------------------------------
 * Line breaks and white space
 * ----------------------------------------------------------------------------------------------*/

runTable("line breaks", [
  { id: "nl-01 wrapped prose", text: "He reported\npain at rest.", expect: ["He reported\npain at rest."] },
  { id: "nl-02 blank line", text: "Pain eased\n\nhe returned to work", expect: ["Pain eased", "he returned to work"] },
  { id: "nl-03 heading line", text: "Assessment:\nfull range, no pain.", expect: ["Assessment:", "full range, no pain."] },
  { id: "nl-04 line ending with a stop", text: "Pain eased.\nthen he walked further.", expect: ["Pain eased.", "then he walked further."] },
  { id: "nl-05 line starting with a capital", text: "Neck pain\nBack pain", expect: ["Neck pain", "Back pain"] },
  { id: "nl-06 e.g. before a line break", text: "Pain on loading, e.g.\nsquats and lunges.", expect: ["Pain on loading, e.g.\nsquats and lunges."] },
  { id: "nl-07 CRLF", text: "Pain eased.\r\nHe returned to work.", expect: ["Pain eased.", "He returned to work."] },
  { id: "nl-08 surrounding white space", text: "  Pain eased.   He rested.  ", expect: ["Pain eased.", "He rested."] },
  { id: "nl-09 non-breaking space", text: "Pain eased.\u00A0He rested.", expect: ["Pain eased.", "He rested."] },
  { id: "nl-10 no full stop", text: "Pain eased", expect: ["Pain eased"] },
  { id: "nl-11 empty", text: "", expect: [] },
  { id: "nl-12 white space only", text: " \n\t ", expect: [] },
]);

/* ------------------------------------------------------------------------------------------------
 * The notes policy
 * ----------------------------------------------------------------------------------------------*/

runTable("notes policy", [
  { id: "notes-01 plan", policy: "notes", text: "pain 3/10 at rest. prev back injury 2019, settled. gym 2x/wk.", expect: ["pain 3/10 at rest.", "prev back injury 2019, settled.", "gym 2x/wk."] },
  { id: "notes-02 inline abbreviation", policy: "notes", text: "rom full. power 5/5. e.g. squats ok.", expect: ["rom full.", "power 5/5.", "e.g. squats ok."] },
  { id: "notes-03 N-1", policy: "notes", text: "PSFS 6.5 today. prev back injury, settled.", expect: ["PSFS 6.5 today.", "prev back injury, settled."] },
  { id: "notes-04 lines", policy: "notes", text: "PMH: nil.\nPlan: HEP.", expect: ["PMH: nil.", "Plan: HEP."] },
  { id: "notes-05 titles and no.", policy: "notes", text: "seen by dr. reid. approx. 6 sessions. no. of sessions 4.", expect: ["seen by dr. reid.", "approx. 6 sessions.", "no. of sessions 4."] },
  { id: "notes-06 note abbreviations", policy: "notes", text: "pt. reports less pain. 2x/wk. sleeping ok.", expect: ["pt. reports less pain.", "2x/wk.", "sleeping ok."] },
  { id: "notes-07 every line break", policy: "notes", text: "Pain eased\nwalks daily", expect: ["Pain eased", "walks daily"] },
  { id: "notes-08 question marks", policy: "notes", text: "any pain? yes. sleeping ok!", expect: ["any pain?", "yes.", "sleeping ok!"] },
  { id: "notes-09 a unit before lower case", policy: "notes", text: "Sitting tolerance 20 min. walks 2 miles.", expect: ["Sitting tolerance 20 min.", "walks 2 miles."] },
  { id: "notes-10 decimals and dates", policy: "notes", text: "vas 6.5/10. seen 08.09.2026. odi 60.5%. next 15/09/2026.", expect: ["vas 6.5/10.", "seen 08.09.2026.", "odi 60.5%.", "next 15/09/2026."] },
  { id: "notes-11 anatomy abbreviation", policy: "notes", text: "pain ant. knee on stairs. settled.", expect: ["pain ant. knee on stairs.", "settled."] },
  { id: "notes-12 ellipsis goes on", policy: "notes", text: "pain... better today.", expect: ["pain... better today."] },
  { id: "notes-13 lower-case letter marker", policy: "notes", text: "a. neck b. back", expect: ["a. neck b. back"] },
  { id: "notes-14 quotes still protect", policy: "notes", text: 'pt said "much better. back at gym". settled.', expect: ['pt said "much better. back at gym".', "settled."] },
  { id: "notes-15 sides and seconds", policy: "notes", text: "CCFT: holds 24 mmHg x 10 s. FRT 34° L, 38° R. Palpation: TTP reduced.", expect: ["CCFT: holds 24 mmHg x 10 s.", "FRT 34° L, 38° R.", "Palpation: TTP reduced."] },
  { id: "notes-16 approx. before a figure", policy: "notes", text: "Alcohol approx. 6 units per week. Swims 2x/wk.", expect: ["Alcohol approx. 6 units per week.", "Swims 2x/wk."] },
  { id: "notes-17 decimals in outcome lists", policy: "notes", text: "Outcome measures: NPRS 4/10, QuickDASH 29.5 (38.6 on 15/09/2026, 52.3 on 01/09/2026), PSFS 5.3.", expect: ["Outcome measures: NPRS 4/10, QuickDASH 29.5 (38.6 on 15/09/2026, 52.3 on 01/09/2026), PSFS 5.3."] },
  { id: "notes-18 query sign", policy: "notes", text: "GP letter 26/08/2026: ?rotator cuff strain R shoulder, refer physio.", expect: ["GP letter 26/08/2026: ?rotator cuff strain R shoulder, refer physio."] },
]);

/* ------------------------------------------------------------------------------------------------
 * Safety-corpus seed texts (bh-quality base-work TS-01..TS-06)
 * ----------------------------------------------------------------------------------------------*/

runTable("seed", [
  {
    id: "TS-05",
    text: "On 08/09/2026 Tom Ellis, physiotherapist, recorded an assessment of low back pain. He recorded Oswestry Disability Index 46%.",
    expect: ["On 08/09/2026 Tom Ellis, physiotherapist, recorded an assessment of low back pain.", "He recorded Oswestry Disability Index 46%."],
  },
  {
    id: "TS-06",
    text: "On 20/10/2026 Priya Shah, physiotherapist, assessed the sprain as resolving well, and recorded that Mr Ashworth was not yet back at football.",
    expect: ["On 20/10/2026 Priya Shah, physiotherapist, assessed the sprain as resolving well, and recorded that Mr Ashworth was not yet back at football."],
  },
  {
    id: "TS-03 boxes",
    text: "Objective markers – Initial assessment: flexion 120°, abduction 95°, painful arc.",
    expect: ["Objective markers – Initial assessment: flexion 120°, abduction 95°, painful arc."],
  },
  { id: "TS-04 boxes", text: "Headaches 3–4 times a week", expect: ["Headaches 3–4 times a week"] },
]);

/* ------------------------------------------------------------------------------------------------
 * Drop-in parity with the naive splitter where it was right, and the cases where it was wrong
 * ----------------------------------------------------------------------------------------------*/

const naive = (text: string) => (text.match(/[^.!?]+(?:[.!?]+|$)/g) ?? []).map((x) => x.trim()).filter(Boolean);

test("sentences parity: on plain text the tokenizer gives what the old /[^.!?]+/ splitter gave", () => {
  for (const text of [
    "Walks daily. Smoker 10/day. Works nights.",
    "Lifting injury at work on 12/03/2026. Central LBP, NPRS 7/10 at worst. Sitting tolerance 20 min. Off work since 13/03/2026.",
    "Non-smoker; drinks alcohol at weekends.",
    "Lumbar AROM full and pain-free. ODI 18%. In my opinion he is fit for a phased return to normal duties over 2 weeks.",
    "Took 3 days off work after the accident, then back on normal duties with breaks from the desk.",
    "Any red flags? None were found! He was discharged.",
  ]) {
    assert.deepEqual(sentenceTexts(text), naive(text), text);
  }
});

test("sentences parity: the old splitter cut these; the tokenizer does not", () => {
  for (const text of [
    "She recorded a Patient-Specific Functional Scale score of 8.0, a mild ache on the inner side of the knee after cutting drills.",
    "QuickDASH 52.3 to 29.5 and Patient-Specific Functional Scale 2.7 to 5.3 since 01/09/2026.",
    "Mr. Ellery was assessed by Dr. Reid.",
    "Advised approx. 6 sessions, e.g. neck and shoulder work, from 08.09.2026.",
  ]) {
    assert.ok(naive(text).length > 1, `the old splitter cut "${text}"`);
    assert.deepEqual(sentenceTexts(text), [text]);
  }
});

/* ------------------------------------------------------------------------------------------------
 * Generated texts: k sentences in, k sentences out
 * ----------------------------------------------------------------------------------------------*/

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fragments that must never end a sentence. */
const TRICKY = [
  "a score of 8.0, a mild ache",
  "QuickDASH 52.3 to 29.5",
  "VAS 6.5/10",
  "Mr. Ellery",
  "Dr. Reid",
  "e.g. neck",
  "approx. 6 sessions",
  "on 08.09.2026",
  "on 01/09/2026",
  "3–5 sessions",
  "an ODI of 60.5%",
  "a 1.5cm swelling",
  "claim no. 4471",
  "T. Ellis",
  "i.e. at rest",
  "(see note 2. Rest advised)",
  "“pain eased. Walking better”",
  "8 Sept. 2026",
  "flexion 95.5° to 120.0°",
  "Exercises: 1. Bridges 2. Clams",
  "etc. and slopes",
  "approx. 0.5 hours",
];
const PLAIN = ["at rest", "on stairs", "after work", "at the review", "with breaks", "since the injury", "by discharge"];
const STARTS = ["He reported", "She recorded", "Pain was noted", "Tom Ellis recorded", "Priya Shah assessed", "Owen Testcase described", "Sleep improved", "2 sessions showed"];
const ENDS = ["today", "at rest", "on the left", "10/10", "46%", "by 22/09/2026", "over 4 weeks"];
/** Lower-case fragments that must never end a note sentence ("etc. and" may: in notes "etc." is an ordinary word). */
const NOTE_TRICKY = TRICKY.filter((t) => !/^[A-Z]/.test(t) && t.indexOf("etc.") < 0);
const NOTE_STARTS = ["prev back injury", "gym", "rom full", "pain", "sleeping ok", "walks daily", "seen by dr. reid"];

function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)];
}

test("sentences generated: 400 prose texts of 1–5 sentences built from tricky fragments split back exactly", () => {
  const rand = prng(20261026);
  for (let run = 0; run < 400; run++) {
    const k = 1 + Math.floor(rand() * 5);
    const sentences: string[] = [];
    for (let s = 0; s < k; s++) {
      const parts = [pick(rand, STARTS)];
      const n = 1 + Math.floor(rand() * 3);
      for (let p = 0; p < n; p++) parts.push(rand() < 0.7 ? pick(rand, TRICKY) : pick(rand, PLAIN));
      parts.push(pick(rand, ENDS));
      sentences.push(`${parts.join(rand() < 0.5 ? " " : ", ")}${rand() < 0.85 ? "." : rand() < 0.5 ? "?" : "!"}`);
    }
    const text = sentences.join(rand() < 0.8 ? " " : "  ");
    const spans = splitSentences(text);
    assert.deepEqual(
      spans.map((x) => x.text),
      sentences,
      `seed run ${run}`,
    );
    assertWellFormed(text, spans, "prose", `generated ${run}`);
  }
});

test("sentences generated: 300 bullet and numbered lists give one span per item, with its marker", () => {
  const rand = prng(1092026);
  const styles: Array<(k: number) => string> = [() => "-", () => "•", () => "*", () => "–", (k) => `${k + 1}.`, (k) => `${k + 1})`, (k) => `(${String.fromCharCode(97 + k)})`, (k) => `${String.fromCharCode(97 + k)})`];
  for (let run = 0; run < 300; run++) {
    const style = pick(rand, styles);
    const k = 2 + Math.floor(rand() * 4);
    const items: string[] = [];
    for (let j = 0; j < k; j++) {
      const body = [rand() < 0.5 ? pick(rand, TRICKY) : pick(rand, PLAIN), pick(rand, ENDS)].join(" ");
      items.push(`${style(j)} ${rand() < 0.5 ? body : `${body}.`}`);
    }
    const heading = rand() < 0.5 ? "Plan:\n" : "";
    const text = heading + items.join("\n");
    const spans = splitSentences(text);
    assert.deepEqual(
      spans.map((x) => x.text),
      heading ? ["Plan:", ...items] : items,
      `list run ${run}`,
    );
    spans.slice(heading ? 1 : 0).forEach((s, j) => assert.equal(s.marker, style(j), `list run ${run} item ${j} marker`));
    assertWellFormed(text, spans, "prose", `list ${run}`);
  }
});

test("sentences generated: 300 lower-case note texts split per sentence under notes, and stay whole under prose", () => {
  const rand = prng(8092026);
  for (let run = 0; run < 300; run++) {
    const k = 2 + Math.floor(rand() * 4);
    const sentences: string[] = [];
    for (let s = 0; s < k; s++) {
      const parts = [pick(rand, NOTE_STARTS)];
      if (rand() < 0.6) parts.push(pick(rand, NOTE_TRICKY));
      parts.push(pick(rand, ENDS));
      sentences.push(`${parts.join(" ")}.`);
    }
    const text = sentences.join(" ");
    assert.deepEqual(sentenceTexts(text, "notes"), sentences, `notes run ${run}`);
    assertWellFormed(text, splitSentences(text, "notes"), "notes", `notes ${run}`);
    // Under prose a lower-case start never begins a sentence, except after a figure ("…46%. 2 sessions…" never occurs here).
    assert.equal(sentenceTexts(text, "prose").length, 1, `prose run ${run}: ${text}`);
  }
});

/* ------------------------------------------------------------------------------------------------
 * Span helpers
 * ----------------------------------------------------------------------------------------------*/

test("sentences sentenceAt / isSentenceStart / expandToSentences", () => {
  const text = "Walks daily. Smoker 10/day. Dr. Reid advised rest.";
  assert.equal(sentenceAt(text, 0)?.text, "Walks daily.");
  assert.equal(sentenceAt(text, text.indexOf("10/day"))?.text, "Smoker 10/day.");
  assert.equal(sentenceAt(text, text.indexOf(" Smoker")), undefined, "white space between sentences is in none");
  assert.equal(sentenceAt(text, text.length), undefined);

  assert.equal(isSentenceStart(text, 0), true);
  assert.equal(isSentenceStart(text, text.indexOf("Smoker")), true);
  assert.equal(isSentenceStart(text, text.indexOf(" Smoker")), true, "white space before a sentence start is skipped");
  assert.equal(isSentenceStart(text, text.indexOf("daily")), false);
  assert.equal(isSentenceStart(text, text.indexOf("Reid")), false, "after a title is not a sentence start");
  assert.equal(isSentenceStart("- bridges\n- clams", 2), true, "a list item's words start a sentence");

  const m = /Smoker/.exec(text)!;
  const range = expandToSentences(text, m.index, m.index + m[0].length)!;
  assert.equal(text.slice(range.start, range.end), "Smoker 10/day.");
  const across = expandToSentences(text, text.indexOf("daily"), text.indexOf("10/day"))!;
  assert.equal(text.slice(across.start, across.end), "Walks daily. Smoker 10/day.");
  const point = expandToSentences(text, text.indexOf("Reid"), text.indexOf("Reid"))!;
  assert.equal(text.slice(point.start, point.end), "Dr. Reid advised rest.", "an empty range picks the sentence it sits in");
  assert.equal(expandToSentences("   ", 0, 2), undefined);
});

test("sentences mapSentences keeps every separator", () => {
  const text = "Pain eased.\n\nHe returned to work.  He was discharged.\n- bridges";
  assert.equal(mapSentences(text, (s) => s.text), text);
  assert.equal(mapSentences(text, (s) => `[${s.index}]`), "[0]\n\n[1]  [2]\n[3]");
  assert.equal(mapSentences("", (s) => s.text), "");
});

/* ------------------------------------------------------------------------------------------------
 * removeSentences
 * ----------------------------------------------------------------------------------------------*/

test("sentences removeSentences rejoins with the stronger separator and reports the removed spans", () => {
  const text = "Pain eased. He rested. He returned to work.";
  const middle = removeSentences(text, [1]);
  assert.equal(middle.after, "Pain eased. He returned to work.");
  assert.deepEqual(middle.removedSpans, [{ start: 12, end: 22, text: "He rested." }]);
  assert.equal(removeSentences(text, [0]).after, "He rested. He returned to work.");
  assert.equal(removeSentences(text, [2]).after, "Pain eased. He rested.");
  assert.equal(removeSentences(text, [0, 1, 2]).after, "");
  assert.equal(removeSentences(text, (s) => /rested/.test(s.text)).after, "Pain eased. He returned to work.");
  assert.equal(removeSentences(text, [0, 2]).after, "He rested.");

  const none = removeSentences(text, []);
  assert.equal(none.after, text);
  assert.deepEqual(none.removedSpans, []);

  const paras = "Pain eased.\n\nHe returned to work. He was discharged.";
  assert.equal(removeSentences(paras, [1]).after, "Pain eased.\n\nHe was discharged.", "the paragraph break is kept");
  assert.equal(removeSentences(paras, [0]).after, "He returned to work. He was discharged.");
  assert.equal(removeSentences("Pain eased. He rested.\nHe returned.", [1]).after, "Pain eased.\nHe returned.", "a line break wins over a space");

  const list = "Plan:\n- bridges\n- clams\n- side planks";
  assert.equal(removeSentences(list, (s) => s.text === "- clams").after, "Plan:\n- bridges\n- side planks");

  assert.equal(removeSentences("  Pain eased. He rested.  ", [1]).after, "  Pain eased.  ", "the text's own leading and trailing space is kept");
  assert.equal(removeSentences("Mr. Ellery rested. 8.0, a mild ache, was noted. He went home.", [1]).after, "Mr. Ellery rested. He went home.");
});

test("sentences removeSentences under the notes policy removes only the note sentence (scope, N-1)", () => {
  const text = "PSFS 6.5 for stairs. prev back injury 2019, settled. gym 2x/wk.";
  const { after, removedSpans } = removeSentences(text, (s) => /back injury/.test(s.text), "notes");
  assert.equal(after, "PSFS 6.5 for stairs. gym 2x/wk.");
  assert.deepEqual(figureChanges(text, after, { removed: removedSpans }), { lost: [], gained: [] });
  assert.ok(after.indexOf("6.5") >= 0, "the in-scope figure is kept whole, never cut to 'PSFS 6.'");
});

/* ------------------------------------------------------------------------------------------------
 * Figures
 * ----------------------------------------------------------------------------------------------*/

test("sentences figuresOf: figures and dates as written", () => {
  const rows: Array<[string, string[]]> = [
    ["a score of 8.0, a mild ache", ["8.0"]],
    ["QuickDASH 52.3 to 29.5", ["52.3", "29.5"]],
    ["VAS 6.5/10 at worst", ["6.5/10"]],
    ["NPRS 7 / 10", ["7/10"]],
    ["ODI 60.5% and 46 %", ["60.5%", "46%"]],
    ["a 1.5cm swelling", ["1.5"]],
    ["on 08/09/2026 and 08.09.2026 and 8-9-26", ["08/09/2026", "08.09.2026", "8-9-26"]],
    ["last seen 2026-10-01", ["2026-10-01"]],
    ["at 14:30", ["14:30"]],
    ["3–5 sessions", ["3", "5"]],
    ["flexion 120°", ["120°"]],
    ["1,250 steps", ["1,250"]],
    ["gym 2x/wk", ["2"]],
    ["£85.50", ["85.50"]],
    ["no figures here", []],
  ];
  for (const [text, expected] of rows) assert.deepEqual(figuresOf(text), expected, text);
});

test("sentences figureChanges compares figures as multisets", () => {
  const before = "QuickDASH 52.3 to 29.5. PSFS 2.7 to 5.3. Seen on 01/09/2026.";
  assert.deepEqual(figureChanges(before, before), { lost: [], gained: [] });
  assert.deepEqual(figureChanges(before, "QuickDASH 52.3 to 29.5. Seen on 01/09/2026.", { removed: ["PSFS 2.7 to 5.3."] }), { lost: [], gained: [] });
  assert.deepEqual(figureChanges(before, "QuickDASH 52.3 to 29.5. Seen on 01/09/2026."), { lost: ["2.7", "5.3"], gained: [] });
  assert.deepEqual(figureChanges("A score of 8.0, a mild ache.", "A score of 8."), { lost: ["8.0"], gained: ["8"] });
  assert.deepEqual(figureChanges("Pain 3/10.", "Pain 3/10. Pain 3/10."), { lost: [], gained: ["3/10"] }, "a duplicated figure counts");
  const prefixed = "Priya Shah's assessment (01/09/2026): grade I-II sprain of the right MCL.";
  assert.deepEqual(figureChanges("Grade I-II sprain of the right MCL.", prefixed), { lost: [], gained: ["01/09/2026"] });
  assert.deepEqual(figureChanges("Grade I-II sprain of the right MCL.", prefixed, { added: ["Priya Shah's assessment (01/09/2026): "] }), { lost: [], gained: [] });
});

/* ------------------------------------------------------------------------------------------------
 * Sentence starts and keys
 * ----------------------------------------------------------------------------------------------*/

test("sentences sentenceStartProblem", () => {
  const rows: Array<[string, string | undefined]> = [
    ["0, a mild ache on the inner side of the knee.", "digit"],
    [", a mild ache.", "comma"],
    ["a mild ache.", "lower_case"],
    ["; then he rested.", "punctuation"],
    ["– a mild ache.", "punctuation"],
    [") and rested.", "punctuation"],
    ["…at rest.", "punctuation"],
    ['"pain eased," he said.', "lower_case"],
    ["He recorded Oswestry Disability Index 46%.", undefined],
    ["(He recorded full range.)", undefined],
    ["“Pain eased,” he said.", undefined],
    ["", undefined],
  ];
  for (const [text, expected] of rows) assert.equal(sentenceStartProblem(text), expected, text);
  const [item, bad] = splitSentences("- neck pain\n- , back pain");
  assert.equal(sentenceStartProblem(item), undefined, "a list item may start in lower case");
  assert.equal(sentenceStartProblem(bad), "comma", "but not with a comma");
  assert.equal(sentenceStartProblem(splitSentences("1. 3 sessions")[0]), undefined, "a numbered item may start with a figure");
});

test("sentences sentenceKey", () => {
  assert.equal(sentenceKey("  Tom’s note said “fine” –  3–5 sessions…  "), "Tom's note said \"fine\" - 3-5 sessions...");
  assert.equal(sentenceKey("Pain eased.\n He rested."), "Pain eased. He rested.");
  assert.notEqual(sentenceKey("He rested."), sentenceKey("he rested."), "case is kept");
  assert.notEqual(sentenceKey("Score 8.0."), sentenceKey("Score 8."), "figures are kept");
  assert.equal(sentenceKey("Cafe\u0301"), sentenceKey("Café"), "Unicode NFC");
});

/* ------------------------------------------------------------------------------------------------
 * checkSafeEdit: the one-click engine's text rules (WD 6)
 * ----------------------------------------------------------------------------------------------*/

const kinds = (problems: readonly SafeEditProblem[]) => problems.map((p) => p.kind).sort();

test("sentences checkSafeEdit: a whole-sentence removal is safe", () => {
  const before = "Tom Ellis assessed the knee on 01/09/2026. The notes are written by the treating physiotherapist. He recorded full range.";
  const { after, removedSpans } = removeSentences(before, [1]);
  assert.deepEqual(checkSafeEdit({ before, after, removedSpans }), []);
  assert.deepEqual(checkSafeEdit({ before, after: before }), [], "no edit is safe");
});

test("sentences checkSafeEdit: B3-2 – cutting '8.0' leaves a fragment and changes a figure", () => {
  const before = "She recorded a Patient-Specific Functional Scale score of 8.0, a mild ache on the inner side of the knee after cutting drills.";
  const cut = before.indexOf("0, a mild");
  const fragment = checkSafeEdit({ before, after: before.slice(cut), removedSpans: [{ start: 0, end: cut, text: before.slice(0, cut) }] });
  assert.deepEqual(kinds(fragment), ["bad_start", "figures_changed", "partial_sentence"]);
  assert.deepEqual(
    fragment.find((p) => p.kind === "bad_start"),
    { kind: "bad_start", sentence: before.slice(cut), problem: "digit" },
  );
  assert.deepEqual(
    fragment.find((p) => p.kind === "figures_changed"),
    { kind: "figures_changed", lost: ["8.0"], gained: ["0"] },
  );

  const tail = checkSafeEdit({ before, after: before.slice(0, cut), removedSpans: [{ start: cut, end: before.length, text: before.slice(cut) }] });
  assert.deepEqual(kinds(tail), ["figures_changed", "partial_sentence"], "'…score of 8.' changes 8.0 to 8");
});

test("sentences checkSafeEdit: R-regression-3 – numbers changed by a rewrite are caught", () => {
  const before = "QuickDASH 52.3 to 29.5 and Patient-Specific Functional Scale 2.7 to 5.3 since 01/09/2026.";
  const after = "QuickDASH 52.3 to 29. And Patient-Specific Functional Scale 2.7 to 5.";
  const problems = checkSafeEdit({ before, after });
  assert.deepEqual(problems.find((p) => p.kind === "figures_changed"), { kind: "figures_changed", lost: ["29.5", "5.3", "01/09/2026"], gained: ["29", "5"] });
});

test("sentences checkSafeEdit: TS-05 – removing the sentence that names the clinician orphans 'He recorded…'", () => {
  const before = "On 08/09/2026 Tom Ellis, physiotherapist, recorded an assessment of low back pain. He recorded Oswestry Disability Index 46%.";
  const first = removeSentences(before, [0]);
  assert.deepEqual(checkSafeEdit({ before, ...first }), [{ kind: "orphaned_pronoun", sentence: "He recorded Oswestry Disability Index 46%." }]);
  const second = removeSentences(before, [1]);
  assert.deepEqual(checkSafeEdit({ before, ...second }), [], "negative twin: removing the second sentence is fine");
});

test("sentences checkSafeEdit: orphan rule follows the naming sentence, not the neighbour", () => {
  const before = "Tom Ellis assessed the knee. He recorded full range. He advised a home programme.";
  assert.deepEqual(checkSafeEdit({ before, ...removeSentences(before, [1]) }), [], "the naming sentence is still there");
  assert.deepEqual(kinds(checkSafeEdit({ before, ...removeSentences(before, [0]) })), ["orphaned_pronoun", "orphaned_pronoun"]);

  assert.deepEqual(
    kinds(checkSafeEdit({ before: "Tom Ellis recorded full range on 01/09/2026.", after: "He recorded full range on 01/09/2026." })),
    ["orphaned_pronoun"],
    "a rewrite that opens with a pronoun where the text named the clinician",
  );
  assert.deepEqual(
    checkSafeEdit({ before: "He recorded full range. He advised rest.", after: "He recorded full range." , removedSpans: [{ start: 24, end: 40, text: "He advised rest." }] }),
    [],
    "a paragraph that only ever used the pronoun (named in an earlier paragraph) is not orphaned by an edit",
  );
  const two = "Tom Ellis assessed the knee. Priya Shah reviewed the scan. She recorded a grade II tear.";
  assert.deepEqual(
    checkSafeEdit({ before: two, ...removeSentences(two, [1]) }),
    [{ kind: "orphaned_pronoun", sentence: "She recorded a grade II tear." }],
    "removing Priya Shah's sentence would hand her finding to Tom Ellis",
  );
  const noName = "Tom Ellis assessed the knee on 01/09/2026. The notes are written by the treating physiotherapist. He recorded full range.";
  assert.deepEqual(checkSafeEdit({ before: noName, ...removeSentences(noName, [1]) }), [], "a sentence that names nobody is not the subject");
  assert.deepEqual(
    checkSafeEdit({ before: "Pain eased. He went home.", after: "Pain eased. His knee felt better." }),
    [],
    "a new pronoun sentence after the same antecedent is fine",
  );
});

test("sentences checkSafeEdit: an attribution prefix may add its date only when declared", () => {
  const before = "Assessment: grade I-II sprain of the right MCL, possible medial meniscus irritation.";
  const prefix = "Priya Shah's assessment (01/09/2026): ";
  const after = `${prefix}grade I-II sprain of the right MCL, possible medial meniscus irritation.`;
  assert.deepEqual(checkSafeEdit({ before, after, added: [prefix] }), []);
  assert.deepEqual(kinds(checkSafeEdit({ before, after })), ["figures_changed"]);
});

test("sentences checkSafeEdit: only starts the edit created count", () => {
  const before = "Pain eased. 2 sessions were missed. He rested.";
  assert.deepEqual(checkSafeEdit({ before, ...removeSentences(before, [2]) }), [], "a figure-led sentence that was already there is kept");
  assert.deepEqual(kinds(checkSafeEdit({ before: "Pain eased, and he rested.", after: "Pain eased. and he rested." })), ["bad_start"]);
  assert.deepEqual(kinds(checkSafeEdit({ before: "Pain eased, and he rested.", after: "Pain eased. , and he rested." })), ["bad_start"]);
});

test("sentences checkSafeEdit: a removed span must be whole sentences (white space around it allowed)", () => {
  const before = "Pain eased. He rested. He returned to work.";
  const s = before.indexOf("He rested.");
  const whole = { start: s - 1, end: s + "He rested. ".length, text: before.slice(s - 1, s + "He rested. ".length) };
  assert.deepEqual(checkSafeEdit({ before, after: "Pain eased. He returned to work.", removedSpans: [whole] }), []);
  const two = { start: 0, end: s + "He rested.".length, text: before.slice(0, s + "He rested.".length) };
  assert.deepEqual(checkSafeEdit({ before, after: "He returned to work.", removedSpans: [two] }), [], "a run of whole sentences is fine");
  const part = { start: s, end: s + 2, text: "He" };
  assert.deepEqual(kinds(checkSafeEdit({ before, after: "Pain eased.  rested. He returned to work.", removedSpans: [part] })), ["bad_start", "partial_sentence"]);
});

test("sentences checkSafeEdit: the notes policy option is used for the split", () => {
  const before = "pain 3/10 at rest. prev back injury 2019, settled. gym 2x/wk.";
  const { after, removedSpans } = removeSentences(before, [1], "notes");
  assert.deepEqual(checkSafeEdit({ before, after, removedSpans, policy: "notes" }), []);
  assert.deepEqual(kinds(checkSafeEdit({ before, after, removedSpans })), ["partial_sentence"], "under prose the note is one sentence");
});
