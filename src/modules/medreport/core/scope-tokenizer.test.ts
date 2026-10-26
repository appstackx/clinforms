/**
 * bh2 WD design 5 (N-1): scope minimisation uses the shared tokenizer's "notes" policy – a figure is kept with its
 * whole sentence or the whole sentence goes, never cut ("PSFS 6.5" never becomes "PSFS 6."), and terse lower-case clinic
 * notes still lose only the out-of-scope sentence. Fictional data only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { figuresOf, splitSentences } from "./text/sentences";
import { SCOPE_STRIP_HOOK, removeSentencesWithTerms } from "./scope";
import { withHookDisabled } from "./validation/hooks";

test("N-1: the figure is kept or the whole sentence is dropped – never 'PSFS 6.'", () => {
  assert.equal(removeSentencesWithTerms("PSFS 6.5, limited by an old back injury in 2019.", ["back injury"]), "");
  assert.equal(removeSentencesWithTerms("PSFS 6.5 for walking. Old back injury in 2019, settled.", ["back injury"]), "PSFS 6.5 for walking.");
  assert.equal(removeSentencesWithTerms("ODI 48.5% today. Previous neck surgery in 2015.", ["neck surgery"]), "ODI 48.5% today.");
});

test("lower-case notes: only the out-of-scope sentence goes; in-scope figures stay whole", () => {
  assert.equal(removeSentencesWithTerms("pain 3/10 at rest. prev back injury 2019, settled. gym 2x/wk.", ["back injury"]), "pain 3/10 at rest. gym 2x/wk.");
  assert.equal(removeSentencesWithTerms("psfs 6.5 today. prev back injury 2019. walks 2.5 km.", ["back injury"]), "psfs 6.5 today. walks 2.5 km.");
  assert.equal(removeSentencesWithTerms("Line one.\nSmoker, 10 a day.\nLine three 4.5 kg.", ["smoker"]), "Line one.\nLine three 4.5 kg.", "lines left empty are dropped");
});

test("property: whatever is kept is a run of whole sentences of the input, with their figures", () => {
  const texts = [
    "QuickDASH 52.3, then 29.5 since 01/09/2026. Previous back injury in 2019. PSFS 8.0 (2.7 at the first session).",
    "approx. 3 wks of pain, e.g. on stairs. smoker 10/day. NPRS 6.5/10.",
    "Mr. Testcase reported 2.5 km walks. PMH: mild asthma. He works 37.5 hours a week.",
  ];
  for (const text of texts) {
    const out = removeSentencesWithTerms(text, ["back injury", "smoker", "PMH"]);
    const kept = splitSentences(text, "notes").map((s) => s.text);
    for (const s of splitSentences(out, "notes")) assert.ok(kept.includes(s.text), `${s.text} is a whole sentence of ${text}`);
    for (const fig of figuresOf(out)) assert.ok(figuresOf(text).includes(fig), `${fig} unchanged`);
  }
});

test("the scope-strip hook gates the minimisation (ledger seam)", async () => {
  await withHookDisabled(SCOPE_STRIP_HOOK, async () => assert.equal(removeSentencesWithTerms("prev back injury 2019.", ["back injury"]), "prev back injury 2019."));
});
