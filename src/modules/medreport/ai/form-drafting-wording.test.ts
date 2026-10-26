/**
 * bh2 WD design 1 and 3: the pinned token-level substitutions at assembly (property tests: idempotent; every figure,
 * date, negation and clinician name kept) and drafting meta-wording held back, never dropped (R-regression-1, B2-9).
 * Fictional data only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { figuresOf } from "../core/text/sentences";
import { withHookDisabled } from "../core/validation/hooks";
import { PLAIN_WORDING_HOOK, explicitRecorderSubject, hasMetaWording, holdBackMeta, noneMissed, pinnedWording, yesNoInWordsCase } from "./form-drafting-wording";

/** Drafted sentences of the shapes the verification runs saw (fictional patients, own wording). */
const S_SPLIT = [
  "On 15/07/2026 I recorded that Mr Ellery took 3 days off work after the accident and then returned to normal duties.",
  "I recorded that the symptoms were consistent with lifting, and noted mild stiffness when sitting.",
  "She recorded a Numeric Pain Rating Scale score of 1/10 and a Patient-Specific Functional Scale score of 8.0, a mild ache on the inner side of the knee after drills.",
  "Her QuickDASH improved from 52.3 to 29.5 and her Patient-Specific Functional Scale from 2.7 to 5.3 since 01/09/2026.",
  "No neurological deficit was noted. No red flags were reported.",
  "Yes – On 13/10/2026 Tom Ellis, physiotherapist, recorded that further treatment was needed.",
  "Yes – Priya Shah recorded that the knee was improving.",
  "None – 0 sessions missed",
  "Mr. Testcase reported approx. 3 weeks of pain, e.g. on stairs and kneeling. He walks 2.5 km daily.",
  "On 06/05/2026 Tom Ellis, physiotherapist, recorded that in his opinion he is fit for a phased return over 2 weeks.",
  "I recorded that he was working amended duties, and also noted that he was not lifting more than 15 kg.",
];

const NAMES = ["Tom Ellis", "Sarah Reid", "Priya Shah", "Mr Ellery", "Mr Testcase"];
const NEGATIONS = /\b(?:no|not|never|none|nil|without)\b/gi;

test("the pinned substitutions are idempotent and keep every figure, date, negation and clinician name", () => {
  for (const text of S_SPLIT) {
    const once = pinnedWording(text);
    assert.equal(pinnedWording(once), once, `idempotent: ${text}`);
    if (text.startsWith("None – 0")) {
      assert.equal(once, "None");
      continue;
    }
    assert.deepEqual(figuresOf(once), figuresOf(text), `figures kept: ${text}`);
    assert.equal((once.match(NEGATIONS) ?? []).length, (text.match(NEGATIONS) ?? []).length, `negations kept: ${text}`);
    for (const name of NAMES) assert.equal(once.includes(name), text.includes(name), `${name} kept: ${text}`);
  }
});

test("B3-4: 'On <date> I recorded that <past event>' is never reduced to a bare statement dated to the note", () => {
  const text = "On 15/07/2026 I recorded that Mr Ellery took 3 days off work after the accident.";
  assert.equal(pinnedWording(text), text);
});

test("B2-6: the subject two recording verbs share is written once more – nothing else changes", () => {
  assert.equal(
    explicitRecorderSubject("I recorded that the symptoms were consistent with lifting, and noted mild stiffness when sitting."),
    "I recorded that the symptoms were consistent with lifting, and I noted mild stiffness when sitting.",
  );
  assert.equal(explicitRecorderSubject("Tom Ellis recorded that the pain eased, and noted full movement."), "Tom Ellis recorded that the pain eased, and noted full movement.", "a named recorder is left as written");
  assert.equal(explicitRecorderSubject("He described the pain, and I noted mild anxiety."), "He described the pain, and I noted mild anxiety.");
});

test("B3-23: lower case after 'Yes – ' for an ordinary opener; a name keeps its capital; 'None – 0 sessions missed' is 'None'", () => {
  assert.equal(yesNoInWordsCase("Yes – On 13/10/2026 Tom Ellis recorded it."), "Yes – on 13/10/2026 Tom Ellis recorded it.");
  assert.equal(yesNoInWordsCase("Yes – Priya Shah recorded it."), "Yes – Priya Shah recorded it.");
  assert.equal(yesNoInWordsCase("No – The knee was not swollen."), "No – the knee was not swollen.");
  assert.equal(noneMissed("None – 0 sessions missed"), "None");
  assert.equal(noneMissed("None – 1 session missed (unwell)"), "None – 1 session missed (unwell)");
});

test("the plain-wording hook gates the substitutions (ledger seam)", async () => {
  const text = "I recorded that the pain eased, and noted full movement.";
  assert.notEqual(pinnedWording(text), text);
  await withHookDisabled(PLAIN_WORDING_HOOK, async () => assert.equal(pinnedWording(text), text));
});

test("R-regression-1: 'recorded opinion' is ordinary wording, never meta – the paragraph is kept whole", () => {
  for (const text of [
    "Tom Ellis's recorded opinion on 06/05/2026 was a phased return to normal duties over 2 weeks.",
    "Given the recorded opinion of a phased return, which period applies?",
    "The recorded opinions differ between the two notes.",
    "He was waiting for an MRI scan.",
    "Actual range of movement was 80% of normal.",
  ]) {
    assert.equal(hasMetaWording(text), false, text);
    assert.deepEqual(holdBackMeta(text), { text, heldBack: [] });
  }
});

test("meta-wording: the smallest whole piece is held back and returned; the rest stays", () => {
  const cases: Array<[string, string, string]> = [
    ["Lumbar movement was full and pain-free at discharge. These are recorded-opinion questions.", "Lumbar movement was full and pain-free at discharge.", "These are recorded-opinion questions."],
    ["Lumbar movement was full and pain-free at discharge. (recorded opinion only)", "Lumbar movement was full and pain-free at discharge.", "(recorded opinion only)"],
    ["(recorded opinion only) He will recover fully within 6 weeks.", "He will recover fully within 6 weeks.", "(recorded opinion only)"],
    ["Given the recorded opinion only, He will recover fully within 6 weeks.", "He will recover fully within 6 weeks.", "Given the recorded opinion only,"],
    ["Actually, the note says this. He was discharged.", "He was discharged.", "Actually, the note says this."],
    ["Pain eased at discharge. Let me check the note again.", "Pain eased at discharge.", "Let me check the note again."],
  ];
  for (const [input, kept, held] of cases) {
    const out = holdBackMeta(input);
    assert.equal(out.text, kept, input);
    assert.ok(out.heldBack.some((h) => h.includes(held)), `${input} → held ${JSON.stringify(out.heldBack)}`);
  }
});

test("a self-correction takes its broken lower-case run with it, never the whole sentence before it", () => {
  const out = holdBackMeta("Lumbar movement was full and pain-free at discharge. so there is no 4th... wait, the 4th attended session is 13/10/2026");
  assert.equal(out.text, "Lumbar movement was full and pain-free at discharge.");
  assert.equal(out.heldBack.length, 1);
  assert.match(out.heldBack[0], /^so there is no 4th\.\.\. wait, the 4th attended session is 13\/10\/2026$/);
});

test("the token-level helpers assembly keeps are idempotent and keep figures, negations and names", async () => {
  const { describeSourceIds, expandNoteShorthand, notesNamedByAuthor } = await import("../core/voice");
  const notes = [
    { id: "N-001", date: "2026-03-18", author: { name: "Sarah Reid", hcpc: "PH-DEMO-01" } },
    { id: "N-002", date: "2026-05-06", author: { name: "Tom Ellis", hcpc: "PH-DEMO-02" } },
  ];
  const ids = /\bN-\d{3}\b/g;
  for (const text of [...S_SPLIT, "Walks 2x/wk, lifts >15 kg; NPRS 6.5/10 at rest; no pain at night.", "In N-002 Tom Ellis recorded full range; no swelling (N-001)."]) {
    const shorthand = expandNoteShorthand(text);
    assert.equal(expandNoteShorthand(shorthand), shorthand, `expandNoteShorthand idempotent: ${text}`);
    assert.deepEqual(figuresOf(shorthand), figuresOf(text), `figures kept: ${text}`);
    assert.equal((shorthand.match(NEGATIONS) ?? []).length, (text.match(NEGATIONS) ?? []).length, `negations kept: ${text}`);
    const described = describeSourceIds(text, { notes, facts: [] });
    assert.equal(describeSourceIds(described, { notes, facts: [] }), described, `describeSourceIds idempotent: ${text}`);
    for (const fig of figuresOf(text.replace(ids, ""))) assert.ok(figuresOf(described).includes(fig), `${fig} kept: ${text}`);
    for (const name of NAMES) assert.equal(described.includes(name), text.includes(name), `${name} kept: ${text}`);
    const named = notesNamedByAuthor(text, notes);
    assert.equal(notesNamedByAuthor(named, notes), named, `notesNamedByAuthor idempotent: ${text}`);
  }
});
