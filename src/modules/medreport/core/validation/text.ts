/**
 * Text helpers for the validators: normalisation for phrase matching, and extraction of the figures
 * (dates, durations, numbers, spinal levels) a paragraph states, so they can be looked up in the
 * sources it cites.
 *
 * Pure and deterministic; no lookbehind regexes (the project compiles without a `target`).
 *
 * Owner: ai agent.
 */
import { isValidIsoDate } from "../dates";

/* ------------------------------------------------------------------------------------------------
 * Number words and months
 * ----------------------------------------------------------------------------------------------*/

const SMALL_NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
};

const TENS = "twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety";
const ONES = "one|two|three|four|five|six|seven|eight|nine";
/** Longest alternatives first so "seventeen" is never read as "seven". */
const NUMBER_WORD_SOURCE =
  `(?:(?:${TENS})(?:[- ](?:${ONES}))?|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|` +
  `hundred|zero|one|two|three|four|five|six|seven|eight|nine|ten)`;

/** A number written in digits or words. */
const NUM_SOURCE = `(\\d+(?:\\.\\d+)?|${NUMBER_WORD_SOURCE})`;

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};
const MONTH_SOURCE =
  "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)";

/** "six" → 6, "twenty-five" → 25, "42" → 42, "1.5" → 1.5; NaN when not a number. */
export function parseNumberToken(token: string): number {
  const t = token.trim().toLowerCase();
  if (/^\d+(?:\.\d+)?$/.test(t)) return Number(t);
  if (t === "twice") return 2;
  const parts = t.split(/[- ]/).filter(Boolean);
  let total = 0;
  for (const p of parts) {
    const v = SMALL_NUMBER_WORDS[p];
    if (v === undefined) return Number.NaN;
    total += v;
  }
  return parts.length ? total : Number.NaN;
}

function numberKey(n: number): string {
  return String(Number(n.toFixed(4)));
}

/* ------------------------------------------------------------------------------------------------
 * Normalisation for phrase matching
 * ----------------------------------------------------------------------------------------------*/

const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bwks\b/g, "weeks"],
  [/\bwk\b/g, "week"],
  [/\bmths\b/g, "months"],
  [/\bmth\b/g, "month"],
  [/\byrs\b/g, "years"],
  [/\byr\b/g, "year"],
  [/\bhrs\b/g, "hours"],
  [/\bhr\b/g, "hour"],
  [/\bmins\b/g, "minutes"],
  [/\bapprox\.?(?=\s|$)/g, "approximately"],
];

const NUMBER_WORD_RE = new RegExp(`\\b${NUMBER_WORD_SOURCE}\\b`, "g");

/**
 * Lower-case, unify quotes and dashes, expand common note abbreviations (wks → weeks), write number
 * words as digits and collapse whitespace. Used on BOTH sides of a phrase comparison.
 */
export function normaliseForMatch(text: string): string {
  let s = (text ?? "").toLowerCase();
  s = s.replace(/[‘’‛′]/g, "'").replace(/[“”″]/g, '"');
  s = s.replace(/[‐-―−]/g, "-");
  for (const [re, to] of ABBREVIATIONS) s = s.replace(re, to);
  s = s.replace(NUMBER_WORD_RE, (m) => {
    const n = parseNumberToken(m);
    return Number.isNaN(n) ? m : numberKey(n);
  });
  return s.replace(/\s+/g, " ").trim();
}

/** Escape a literal for use inside a RegExp. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ------------------------------------------------------------------------------------------------
 * Figure extraction
 * ----------------------------------------------------------------------------------------------*/

export type FigureKind = "date" | "month_year" | "day_month" | "year" | "duration" | "number" | "level";

export interface Figure {
  kind: FigureKind;
  /** Comparison key, e.g. "2026-03-12", "2027-03", "03-12", "2015", "6:week", "42", "C3". */
  key: string;
  /** The text as written in the paragraph (evidence for the flag and for highlighting). */
  raw: string;
  /** Offset of `raw` in the text. */
  index: number;
}

/** Dates, month-years, day-months, years and day/week/month/year durations block signing. */
export function isDateLikeFigure(kind: FigureKind): boolean {
  return kind !== "number" && kind !== "level";
}

type Unit = "day" | "week" | "month" | "year";

function unitOf(word: string): Unit | null {
  const w = word.toLowerCase();
  if (/^days?$/.test(w)) return "day";
  if (/^(?:weeks?|wks?)$/.test(w)) return "week";
  if (/^(?:months?|mths?)$/.test(w)) return "month";
  if (/^(?:years?|yrs?)$/.test(w)) return "year";
  return null;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function blank(work: string, index: number, length: number): string {
  return work.slice(0, index) + " ".repeat(length) + work.slice(index + length);
}

interface Scan {
  work: string;
  figures: Figure[];
}

/** Run `re` over the working copy, let `onMatch` record figures, and blank each match out. */
function scan(state: Scan, re: RegExp, onMatch: (m: RegExpExecArray) => Figure[] | null): void {
  const matches: RegExpExecArray[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(state.work)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    matches.push(m);
  }
  for (const match of matches) {
    const found = onMatch(match);
    if (found === null) continue;
    state.figures.push(...found);
    state.work = blank(state.work, match.index, match[0].length);
  }
}

function fullDateFigure(day: number, month: number, year: number, raw: string, index: number): Figure {
  const iso = `${year}-${pad2(month)}-${pad2(day)}`;
  return { kind: "date", key: isValidIsoDate(iso) ? iso : `invalid:${iso}`, raw, index };
}

function expandYear(y: string): number {
  return y.length === 2 ? 2000 + Number(y) : Number(y);
}

const LEVEL_TAIL_RE = /\s*[/–—-]\s*([CTLS])?(\d{1,2})/g;

/**
 * Extract every figure a text states. Order matters: dates first (they contain slashes and
 * numbers), then clock times, spinal levels, record IDs and reference codes (ignored), durations,
 * bare years, then plain numbers in digits or words.
 */
export function extractFigures(text: string): Figure[] {
  const original = text ?? "";
  const state: Scan = { work: original, figures: [] };
  const raw = (m: RegExpExecArray) => original.slice(m.index, m.index + m[0].length);

  // 1. Full dates: 12/03/2026, 12.03.26, 2026-03-12, 12 March 2026, 12th of March 2026, March 12, 2026.
  scan(state, /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4}|\d{2})\b/g, (m) => [
    fullDateFigure(Number(m[1]), Number(m[2]), expandYear(m[3]), raw(m), m.index),
  ]);
  scan(state, /\b(\d{4})-(\d{2})-(\d{2})\b/g, (m) => [
    fullDateFigure(Number(m[3]), Number(m[2]), Number(m[1]), raw(m), m.index),
  ]);
  scan(
    state,
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_SOURCE}\\.?,?\\s+(\\d{4})\\b`, "gi"),
    (m) => [fullDateFigure(Number(m[1]), MONTHS[m[2].toLowerCase()], Number(m[3]), raw(m), m.index)],
  );
  scan(
    state,
    new RegExp(`\\b${MONTH_SOURCE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi"),
    (m) => [fullDateFigure(Number(m[2]), MONTHS[m[1].toLowerCase()], Number(m[3]), raw(m), m.index)],
  );
  // Month and year: "March 2027".
  scan(state, new RegExp(`\\b${MONTH_SOURCE}\\.?,?\\s+(\\d{4})\\b`, "gi"), (m) => [
    { kind: "month_year", key: `${m[2]}-${pad2(MONTHS[m[1].toLowerCase()])}`, raw: raw(m), index: m.index },
  ]);
  // Day and month without a year: "15 April", "15th of April".
  scan(state, new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_SOURCE}\\b`, "gi"), (m) => {
    const day = Number(m[1]);
    if (day < 1 || day > 31) return null;
    return [{ kind: "day_month", key: `${pad2(MONTHS[m[2].toLowerCase()])}-${pad2(day)}`, raw: raw(m), index: m.index }];
  });

  // 2. Clock times (not checked).
  scan(state, /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g, () => []);

  // 3. Spinal levels: C2, L4/5, C2–C5, L4–S1 (case-sensitive letters).
  scan(state, /\b([CTLS])(\d{1,2})((?:\s*[/–—-]\s*[CTLS]?\d{1,2})*)(?![\dA-Za-z])/g, (m) => {
    let letter = m[1];
    const out: Figure[] = [{ kind: "level", key: `${letter}${Number(m[2])}`, raw: raw(m), index: m.index }];
    const tail = m[3] ?? "";
    LEVEL_TAIL_RE.lastIndex = 0;
    let t: RegExpExecArray | null;
    while ((t = LEVEL_TAIL_RE.exec(tail)) !== null) {
      if (t[1]) letter = t[1];
      out.push({ kind: "level", key: `${letter}${Number(t[2])}`, raw: raw(m), index: m.index });
    }
    return out;
  });

  // 4. Record IDs and reference codes (not checked): N-003, A-005, OM-NDI, FACT-…, PH-DEMO-01, HP/RTA/2291.
  scan(state, /\bFACT-[A-Za-z0-9-]+/g, () => []);
  scan(state, /\b[A-Z][A-Z0-9]*(?:[-/][A-Z0-9]+)*[-/]\d+\b/g, () => []);

  // 5. Durations in days/weeks/months/years, incl. ranges ("6–7 wks", "two to three weeks") and
  //    clinical shorthand ("6/52" weeks, "3/12" months, "5/7" days).
  scan(
    state,
    new RegExp(
      `\\b${NUM_SOURCE}(?:\\s*(?:-|\\u2013|\\u2014|to|or)\\s*${NUM_SOURCE})?\\s*-?\\s*(days?|weeks?|wks?|months?|mths?|years?|yrs?)\\b`,
      "gi",
    ),
    (m) => {
      const unit = unitOf(m[3]);
      if (!unit) return null;
      const nums = [m[1], m[2]].filter((x): x is string => Boolean(x)).map(parseNumberToken);
      if (nums.some((n) => Number.isNaN(n))) return null;
      return nums.map((n) => ({ kind: "duration" as const, key: `${numberKey(n)}:${unit}`, raw: raw(m), index: m.index }));
    },
  );
  scan(state, /\b(\d{1,2})\/(52|12|7)\b(?!\/)/g, (m) => {
    const unit: Unit = m[2] === "52" ? "week" : m[2] === "12" ? "month" : "day";
    return [{ kind: "duration", key: `${Number(m[1])}:${unit}`, raw: raw(m), index: m.index }];
  });

  // 6. Bare years: 2015.
  scan(state, /\b(19\d{2}|20\d{2})\b(?![.,]\d)/g, (m) => [{ kind: "year", key: m[1], raw: raw(m), index: m.index }]);

  // 7. Numbers in digits: 42, 7/10, 30°, 2x, 0.5, 1,000 (not after a letter, not ordinals).
  scan(state, /\d{1,3}(?:,\d{3})+(?!\d)|\d+(?:\.\d+)?/g, (m) => {
    const before = m.index > 0 ? state.work.charAt(m.index - 1) : "";
    const before2 = m.index > 1 ? state.work.charAt(m.index - 2) : "";
    if (/[A-Za-z]/.test(before)) return [];
    if (before === "-" && /[A-Za-z]/.test(before2)) return [];
    const after = state.work.slice(m.index + m[0].length, m.index + m[0].length + 3);
    if (/^(?:st|nd|rd|th)(?![a-z])/i.test(after)) return [];
    const n = Number(m[0].replace(/,/g, ""));
    if (Number.isNaN(n)) return [];
    return [{ kind: "number", key: numberKey(n), raw: raw(m), index: m.index }];
  });

  // 8. Numbers in words: "two", "twenty-five", "twice" (idioms such as "no one" are skipped).
  scan(state, new RegExp(`\\b(?:${NUMBER_WORD_SOURCE}|twice)\\b`, "gi"), (m) => {
    const word = m[0].toLowerCase();
    if (word === "one") {
      const before = state.work.slice(Math.max(0, m.index - 6), m.index).toLowerCase();
      const after = state.work.slice(m.index + 3, m.index + 12).toLowerCase();
      if (/\b(?:no|any|every|some|this|that|the|which)\s+$/.test(before)) return [];
      if (/^(?:\s+another|-off|-to-one|\s+of\b|\s+side\b|\s+or\s+other)/.test(after)) return [];
    }
    const n = parseNumberToken(word);
    if (Number.isNaN(n)) return [];
    return [{ kind: "number", key: numberKey(n), raw: raw(m), index: m.index }];
  });

  return state.figures.sort((a, b) => a.index - b.index);
}

/* ------------------------------------------------------------------------------------------------
 * Source index
 * ----------------------------------------------------------------------------------------------*/

export interface FigureIndex {
  dates: Set<string>;
  monthYears: Set<string>;
  dayMonths: Set<string>;
  years: Set<string>;
  durations: Set<string>;
  numbers: Set<string>;
  levels: Set<string>;
}

export function emptyFigureIndex(): FigureIndex {
  return {
    dates: new Set(),
    monthYears: new Set(),
    dayMonths: new Set(),
    years: new Set(),
    durations: new Set(),
    numbers: new Set(),
    levels: new Set(),
  };
}

/** Add every figure of `text` to `index` (dates also register their month-year, day-month and year). */
export function addToFigureIndex(index: FigureIndex, text: string): FigureIndex {
  for (const f of extractFigures(text)) {
    switch (f.kind) {
      case "date":
        index.dates.add(f.key);
        if (!f.key.startsWith("invalid:")) {
          index.monthYears.add(f.key.slice(0, 7));
          index.dayMonths.add(f.key.slice(5));
          index.years.add(f.key.slice(0, 4));
        }
        break;
      case "month_year":
        index.monthYears.add(f.key);
        index.years.add(f.key.slice(0, 4));
        break;
      case "day_month":
        index.dayMonths.add(f.key);
        break;
      case "year":
        index.years.add(f.key);
        index.numbers.add(f.key);
        break;
      case "duration":
        index.durations.add(f.key);
        index.numbers.add(f.key.split(":")[0]);
        break;
      case "number":
        index.numbers.add(f.key);
        break;
      case "level":
        index.levels.add(f.key);
        break;
    }
  }
  return index;
}

/**
 * Fix wave 3: a note's short dates ("SMS reminder sent 26/08", "keep appointment 17/09") stand for full dates in the
 * note's own year (or the year before, when that would put them more than six months after the note), so a drafted
 * "26/08/2026" is supported by the note of 27/08/2026. Pain scores and clinical shorthand are not dates: "7/10",
 * "3/12" (months) and "6/52" (weeks) are skipped unless written with two digits on both sides ("07/10").
 */
export function addShortDatesToIndex(index: FigureIndex, text: string, noteIsoDate: string): FigureIndex {
  const note = /^(\d{4})-(\d{2})-(\d{2})$/.exec(noteIsoDate);
  if (!note) return index;
  const year = Number(note[1]);
  const re = /(^|[^\d/.])(\d{1,2})\/(\d{1,2})(?![\d/])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const dRaw = m[2];
    const mRaw = m[3];
    const d = Number(dRaw);
    const mo = Number(mRaw);
    if (mo === 52 || mo === 7) continue;
    if ((mo === 10 || mo === 12) && !(dRaw.length === 2 && mRaw.length === 2)) continue;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    const sameYear = `${year}-${pad2(mo)}-${pad2(d)}`;
    if (!isValidIsoDate(sameYear)) continue;
    index.dates.add(sameYear);
    index.dayMonths.add(sameYear.slice(5));
    const sixMonthsAfter = new Date(Date.parse(`${noteIsoDate}T00:00:00Z`) + 183 * 86_400_000).toISOString().slice(0, 10);
    if (sameYear > sixMonthsAfter) {
      const before = `${year - 1}-${pad2(mo)}-${pad2(d)}`;
      if (isValidIsoDate(before)) index.dates.add(before);
    }
  }
  return index;
}

/** Whether a figure from a paragraph is supported by the indexed source text. */
export function figureInIndex(f: Figure, index: FigureIndex): boolean {
  switch (f.kind) {
    case "date":
      return index.dates.has(f.key);
    case "month_year":
      return index.monthYears.has(f.key);
    case "day_month":
      return index.dayMonths.has(f.key);
    case "year":
      return index.years.has(f.key);
    case "duration":
      return index.durations.has(f.key);
    case "number":
      return index.numbers.has(f.key);
    case "level":
      return index.levels.has(f.key);
  }
}
