/**
 * Reading the values of an import file: dates, times, money, yes/no, sex, statuses. Pure.
 *
 * UK first: a date like 03/04/2026 is 3 April (day first). Exports from clinic software differ in small ways
 * (2-digit years, month names, a time after the date, "£" and thousands separators), so each reader accepts the
 * common forms and returns null for anything it cannot read for certain – the check step then shows the row.
 */
import { isIsoDate, normalisePostcode } from "../core/text";

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function iso(y: number, m: number, d: number): string | null {
  const s = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isIsoDate(s) ? s : null;
}

/** Two-digit years: 00–(pivot) → 20xx, otherwise 19xx. The pivot is this year's two digits (a date of birth is never in the future). */
function fullYear(yy: number, pivot: number): number {
  return yy <= pivot ? 2000 + yy : 1900 + yy;
}

/**
 * A calendar date → "YYYY-MM-DD", or null. Accepts DD/MM/YYYY (also with "-" or "." and 2-digit years),
 * YYYY-MM-DD, "3 Apr 2026", "03-Apr-2026", and any of these followed by a time ("03/04/2026 09:30").
 * `pivotYear` (two digits) decides 2-digit years; default 30.
 */
export function readDate(raw: string | null | undefined, options: { pivotYear?: number } = {}): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return null;
  const pivot = options.pivotYear ?? 30;
  // ISO, optionally with a time (2026-04-03T09:30:00 or 2026-04-03 09:30).
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  // Day first: 03/04/2026, 3-4-26, 03.04.2026 (+ time).
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?: .*)?$/.exec(text);
  if (m) {
    const y = m[3].length === 2 ? fullYear(Number(m[3]), pivot) : Number(m[3]);
    return iso(y, Number(m[2]), Number(m[1]));
  }
  // Month names: 3 Apr 2026, 03-Apr-2026, 3 April 26 (+ time).
  m = /^(\d{1,2})[ -]([A-Za-z]{3,9})[ -](\d{2}|\d{4})(?: .*)?$/.exec(text);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (!month) return null;
    const y = m[3].length === 2 ? fullYear(Number(m[3]), pivot) : Number(m[3]);
    return iso(y, month, Number(m[1]));
  }
  return null;
}

/** A time of day → "HH:MM" (24 h), or null: "09:30", "9:30", "0930", "9.30am", "2:15 PM", or the time after a date. */
export function readTime(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let text = raw.trim().toLowerCase();
  if (!text) return null;
  // "03/04/2026 09:30" or "2026-04-03T09:30:00": the part after the date.
  const after = /^(?:\d{4}-\d{1,2}-\d{1,2}[t ]|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4} )(.+)$/.exec(text);
  if (after) text = after[1].trim();
  const m = /^(\d{1,2})(?:[:.](\d{2}))?(?::\d{2}(?:\.\d+)?)?\s*(am|pm|a\.m\.|p\.m\.)?$/.exec(text) ?? /^(\d{2})(\d{2})$/.exec(text);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  const ampm = m[3]?.replace(/\./g, "");
  if (ampm) {
    if (h < 1 || h > 12) return null;
    if (ampm === "pm" && h !== 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
  } else if (m[2] === undefined && !/^\d{4}$/.test(text)) {
    // A bare number ("9") is not a time.
    return null;
  }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Minutes between two "HH:MM" times on the same day (null when the end is not after the start). */
export function minutesBetween(start: string, end: string): number | null {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const d = eh * 60 + em - (sh * 60 + sm);
  return d > 0 ? d : null;
}

/**
 * Money → whole pence, or null: "55", "55.00", "£1,234.50", "-12.50", "(12.50)" (negative), "GBP 40". Never
 * guesses: "12.5.0", "abc" and more than two decimals are null.
 */
export function readMoneyPence(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  let text = raw.trim().replace(/\s+/g, "");
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/^(gbp|£)/i, "").replace(/(gbp)$/i, "");
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  }
  text = text.replace(/^£/, "");
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ""] = text.replace(/,/g, "").split(".");
  const pence = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(pence) || pence > 100_000_000) return null;
  return negative ? -pence : pence;
}

/** Yes/no → boolean, or null: Y/N, Yes/No, True/False, 1/0, On/Off, Agreed, Opted in/out. */
export function readYesNo(raw: string | null | undefined): boolean | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (["y", "yes", "true", "t", "1", "on", "agreed", "opted in", "opt in", "x", "✓"].includes(t)) return true;
  if (["n", "no", "false", "f", "0", "off", "declined", "opted out", "opt out"].includes(t)) return false;
  return null;
}

export type ImportSex = "female" | "male" | "other" | "unknown";

/** Sex / gender as recorded → the record's values, or null when it cannot be read. Blank → null. */
export function readSex(raw: string | null | undefined): ImportSex | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (["f", "female", "woman", "w"].includes(t)) return "female";
  if (["m", "male", "man"].includes(t)) return "male";
  if (["o", "other", "non-binary", "nonbinary", "x", "indeterminate"].includes(t)) return "other";
  if (["u", "unknown", "not known", "not stated", "not recorded", "prefer not to say"].includes(t)) return "unknown";
  return null;
}

/** A UK postcode normalised ("mk39zz" → "MK3 9ZZ"), or null. */
export function readPostcode(raw: string | null | undefined): string | null {
  return normalisePostcode(typeof raw === "string" ? raw.trim() : null);
}

/** An email address, lower case, or null when it is not one. */
export function readEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  return t.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : null;
}

/** A whole number in a range, or null. */
export function readInt(raw: string | null | undefined, min: number, max: number): number | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

/** Collapses spaces; "" → null. */
export function readText(raw: string | null | undefined, max: number): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.slice(0, max);
}

/** Free text where line breaks matter (notes, alerts): trims, keeps line breaks, "" → null. */
export function readLongText(raw: string | null | undefined, max: number): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!t) return null;
  return t.slice(0, max);
}

/** "Mrs Megan Hart" → { title: "Mrs", rest: "Megan Hart" } (only the usual UK titles are taken off). */
export function splitTitle(raw: string): { title: string | null; rest: string } {
  const m = /^(mr|mrs|ms|miss|mx|dr|prof|professor|rev|sir|dame|master)\.?\s+(.+)$/i.exec(raw.trim());
  if (!m) return { title: null, rest: raw.trim() };
  const t = m[1].toLowerCase();
  const title = t === "professor" ? "Prof" : t.charAt(0).toUpperCase() + t.slice(1);
  return { title, rest: m[2].trim() };
}

/**
 * A full name in one column → first and last name: "Hart, Megan" (last name first) or "Megan Hart" / "Megan
 * Jane Hart" (the last word is the last name). Null when there is only one word.
 */
export function splitFullName(raw: string | null | undefined): { title: string | null; firstName: string; lastName: string } | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.includes(",")) {
    const [last, ...restParts] = text.split(",");
    const { title, rest } = splitTitle(restParts.join(",").trim());
    if (!last.trim() || !rest) return null;
    return { title, firstName: rest, lastName: last.trim() };
  }
  const { title, rest } = splitTitle(text);
  const words = rest.split(" ");
  if (words.length < 2) return null;
  return { title, firstName: words.slice(0, -1).join(" "), lastName: words[words.length - 1] };
}

/** Normalised key for matching names and labels: lower case, letters and digits only, single spaces. */
export function matchKey(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
