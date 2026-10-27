/**
 * Printed duration bands ("0-3 MONTHS", "4–6 months", "Over 12 months", "Less than 6 weeks") and the arithmetic of
 * which band contains a recorded duration ("should settle within 4–6 weeks" → "0-3 MONTHS") – bh2 WD design 4
 * (R-safety-7, B2-10, B3-10(c)).
 *
 * What this module is for, and what it is not:
 * - It only does arithmetic on two pieces of text it is given: a QUOTED expectation from a cited clinician note and the
 *   form's printed options. It never searches gap text, option text or a drafted paragraph for "a duration" (the
 *   R-safety-7 bug: "attended 7 sessions over 6 weeks" became a one-click "0-3 MONTHS").
 * - Its result is information shown to the clinician in the gap ("Sarah Reid recorded “should settle within 4–6
 *   weeks” (16/09/2026), which is within the printed “0-3 MONTHS”"). Code never ticks a band and never offers one as a
 *   one-click answer: the band is the clinician's opinion.
 *
 * Pure; browser and server.
 * Owner: WD (drafting and text edits) – docs/bh2-ownership.json.
 */

/** A span of time in days: [min, max] (max Infinity for "over …"). */
export interface DayRange {
  min: number;
  max: number;
}

const UNIT_DAYS: ReadonlyArray<[RegExp, number]> = [
  [/^(?:days?|d)$/i, 1],
  [/^(?:weeks?|wks?|w)$/i, 7],
  [/^(?:months?|mths?|mos?|m)$/i, 30.4375],
  [/^(?:years?|yrs?|y)$/i, 365.25],
];

function unitDays(unit: string): number | null {
  for (const [re, days] of UNIT_DAYS) if (re.test(unit.trim())) return days;
  return null;
}

const WORD_NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

function num(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (/^\d+(?:\.\d+)?$/.test(t)) return Number(t);
  return WORD_NUMBERS[t] ?? null;
}

const N = "(\\d+(?:\\.\\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
const DASH = "\\s*(?:-|–|—|to)\\s*";
const UNIT = "(days?|weeks?|wks?|months?|mths?|years?|yrs?)";

/**
 * A printed band as a day range: "0-3 MONTHS" → [0, 91], "4-6 months" → [122, 183] (a band "4-6" starts after 3, so
 * its lower edge is 4 months minus nothing – bands are compared on whole units), "Over 12 months" / "12 months +" /
 * "More than 12 months" → [365, ∞), "Less than 6 weeks" / "Under 6 weeks" / "Up to 6 weeks" → [0, 42]. Null when the
 * option is not a duration band.
 */
export function parseBand(option: string): DayRange | null {
  const t = option.replace(/\s+/g, " ").trim();
  let m: RegExpExecArray | null;
  if ((m = new RegExp(`^${N}${DASH}${N}\\s*${UNIT}\\.?$`, "i").exec(t))) {
    const a = num(m[1]);
    const b = num(m[2]);
    const d = unitDays(m[3]);
    if (a === null || b === null || d === null || b < a) return null;
    return { min: a * d, max: b * d };
  }
  if ((m = new RegExp(`^(?:over|more than|greater than|longer than|>)\\s*${N}\\s*${UNIT}\\.?$`, "i").exec(t)) || (m = new RegExp(`^${N}\\s*${UNIT}\\s*(?:\\+|or more|and over|plus)\\.?$`, "i").exec(t))) {
    const a = num(m[1]);
    const d = unitDays(m[2]);
    if (a === null || d === null) return null;
    return { min: a * d, max: Infinity };
  }
  if ((m = new RegExp(`^(?:under|less than|fewer than|up to|within|<)\\s*${N}\\s*${UNIT}\\.?$`, "i").exec(t))) {
    const a = num(m[1]);
    const d = unitDays(m[2]);
    if (a === null || d === null) return null;
    return { min: 0, max: a * d };
  }
  return null;
}

/** Every option of a printed list is a duration band (so the box asks for a time band). */
export function isDurationBandList(options: readonly string[] | undefined): boolean {
  return Boolean(options && options.length >= 2 && options.every((o) => parseBand(o) !== null));
}

/**
 * The duration a quoted expectation states: "within 4–6 weeks" → [28, 42], "about 6 weeks" → [42, 42], "within 6
 * weeks" → [0, 42], "2 to 3 months" → [61, 91]. Only the FIRST duration of the quote counts, and only when the quote
 * holds exactly one (two durations – "7 sessions over 6 weeks, review in 4 weeks" – are not one expectation). Null
 * otherwise.
 */
export function quotedDuration(quote: string): DayRange | null {
  const t = quote.replace(/\s+/g, " ");
  const re = new RegExp(`(?:\\b(within|under|less than|up to|over|more than)\\s+)?\\b${N}(?:${DASH}${N})?\\s*${UNIT}\\b`, "gi");
  const found: DayRange[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const a = num(m[2]);
    const b = m[3] !== undefined ? num(m[3]) : null;
    const d = unitDays(m[4]);
    if (a === null || d === null) continue;
    const lead = (m[1] ?? "").toLowerCase();
    if (b !== null) {
      if (b < a) continue;
      found.push({ min: a * d, max: b * d });
    } else if (lead === "within" || lead === "under" || lead === "less than" || lead === "up to") found.push({ min: 0, max: a * d });
    else if (lead === "over" || lead === "more than") found.push({ min: a * d, max: Infinity });
    else found.push({ min: a * d, max: a * d });
  }
  return found.length === 1 ? found[0] : null;
}

/**
 * The printed band that wholly contains a recorded duration ("4–6 weeks" is within "0-3 MONTHS"; "2–4 months" lies
 * across 0-3 / 4-6 months, so it is in no band). Null when no band, or more than one, contains it – never a guess.
 */
export function bandContaining(duration: DayRange, options: readonly string[]): string | null {
  const hits = options.filter((o) => {
    const band = parseBand(o);
    return band !== null && duration.min >= band.min && duration.max <= band.max;
  });
  return hits.length === 1 ? hits[0] : null;
}
