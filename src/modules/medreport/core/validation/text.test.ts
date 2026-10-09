import { test } from "node:test";
import assert from "node:assert/strict";
import { addToFigureIndex, emptyFigureIndex, extractFigures, figureInIndex, normaliseForMatch, parseNumberToken } from "./text";

const keys = (text: string) => extractFigures(text).map((f) => `${f.kind}:${f.key}`);

test("text: dates in every UK form are read as ISO dates", () => {
  assert.deepEqual(keys("Seen on 18/03/2026 and 1.4.26."), ["date:2026-03-18", "date:2026-04-01"]);
  assert.deepEqual(keys("on 12 March 2026, the 12th of March 2026 and March 12, 2026"), [
    "date:2026-03-12",
    "date:2026-03-12",
    "date:2026-03-12",
  ]);
  assert.deepEqual(keys("by March 2027"), ["month_year:2027-03"]);
  assert.deepEqual(keys("on 15 April"), ["day_month:04-15"]);
  assert.deepEqual(keys("arthroscopy in 2015"), ["year:2015"]);
  assert.deepEqual(keys("2026-07-07"), ["date:2026-07-07"]);
  // An impossible date is still a date figure (and will never match a source).
  assert.deepEqual(keys("31/02/2026"), ["date:invalid:2026-02-31"]);
});

test("text: durations (incl. ranges, words and clinical shorthand) carry their unit", () => {
  assert.deepEqual(keys("within six weeks"), ["duration:6:week"]);
  assert.deepEqual(keys("in about 6–7 wks"), ["duration:6:week", "duration:7:week"]);
  assert.deepEqual(keys("two to three months"), ["duration:2:month", "duration:3:month"]);
  assert.deepEqual(keys("review at 6/52"), ["duration:6:week"]);
  assert.deepEqual(keys("a 34-year-old"), ["duration:34:year"]);
  assert.deepEqual(keys("111 days (15 weeks 6 days)"), ["duration:111:day", "duration:15:week", "duration:6:day"]);
});

test("text: numbers, levels and what is ignored", () => {
  assert.deepEqual(keys("NPRS 7/10, ODI 42%, flexion 30°, HEP 2x/day, 0.5 kg"), [
    "number:7",
    "number:10",
    "number:42",
    "number:30",
    "number:2",
    "number:0.5",
  ]);
  assert.deepEqual(keys("TTP C2–C5 and L4/5, L4–S1"), ["level:C2", "level:C5", "level:L4", "level:L5", "level:L4", "level:S1"]);
  // Record IDs, reference codes, HCPC numbers, clock times and ordinals are not figures.
  assert.deepEqual(keys("N-003, FACT-outcomes-NDI, PH-DEMO-01, HP/RTA/2291 at 09:00, the 2nd session"), []);
  // Spelled-out numbers, but not idioms.
  assert.deepEqual(keys("one headache, twenty-five metres, twice daily"), ["number:1", "number:25", "number:2"]);
  assert.deepEqual(keys("no one else; one of the exercises; one another"), []);
  assert.equal(parseNumberToken("seventeen"), 17);
  assert.equal(parseNumberToken("forty-two"), 42);
  assert.ok(Number.isNaN(parseNumberToken("lots")));
});

test("text: a source date also supports its month-year, day-month and year", () => {
  const idx = addToFigureIndex(emptyFigureIndex(), "Seen 18/03/2026. Review in 6 wks. NPRS 7/10.");
  const ok = (text: string) => extractFigures(text).every((f) => figureInIndex(f, idx));
  assert.ok(ok("in March 2026"));
  assert.ok(ok("on 18 March"));
  assert.ok(ok("in 2026"));
  assert.ok(ok("review in six weeks"));
  assert.ok(ok("seven out of 10"));
  assert.ok(!ok("in March 2027"));
  assert.ok(!ok("review in 8 weeks"));
  assert.ok(!ok("review in 6 months"));
  assert.ok(!ok("6 days")); // same number, different unit
});

test("text: normaliseForMatch unifies case, dashes, quotes, abbreviations and number words", () => {
  assert.equal(normaliseForMatch("Within  SIX wks – it’s"), "within 6 weeks - it's");
  assert.equal(normaliseForMatch("over Two Weeks"), "over 2 weeks");
});
