/**
 * Small text rules shared by the forms, the repositories and search: UK postcodes and phone numbers, search
 * keys, dates. Pure (browser-safe).
 */

/** UK postcode (outward + inward code), any case, one optional space: "MK3 9ZZ", "sw1a1aa", "RV1 2XX". */
export const UK_POSTCODE_PATTERN = /^(GIR ?0AA|[A-PR-UWYZ][0-9][0-9A-HJKPSTUW]? ?[0-9][ABD-HJLNP-UW-Z]{2}|[A-PR-UWYZ][A-HK-Y][0-9][0-9ABEHMNPRVWXY]? ?[0-9][ABD-HJLNP-UW-Z]{2})$/i;

/** "mk39zz" → "MK3 9ZZ" (or null when it is not a UK postcode). */
export function normalisePostcode(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, "").toUpperCase();
  if (!UK_POSTCODE_PATTERN.test(compact)) return null;
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

/** Digits of a phone number with +44 / 0044 turned into a leading 0 ("+44 7700 900123" → "07700900123"). */
export function phoneDigits(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  let digits = value.replace(/[^0-9+]/g, "");
  if (digits.startsWith("+44")) digits = `0${digits.slice(3)}`;
  else if (digits.startsWith("0044")) digits = `0${digits.slice(4)}`;
  return digits.replace(/\+/g, "");
}

/**
 * A plausible phone number: UK numbers have 10 or 11 digits starting with 0; international numbers start with
 * "+" (other than +44) and have 8–15 digits. Characters allowed: digits, spaces, "+", "(", ")", "-".
 */
export function isPlausiblePhone(value: string): boolean {
  if (!/^[+0-9 ()-]{6,24}$/.test(value.trim())) return false;
  const trimmed = value.trim();
  if (trimmed.startsWith("+") && !trimmed.startsWith("+44")) {
    const n = trimmed.replace(/[^0-9]/g, "").length;
    return n >= 8 && n <= 15;
  }
  const digits = phoneDigits(trimmed);
  return /^0\d{9,10}$/.test(digits);
}

/** Lower case, accents removed, punctuation to spaces, single spaces: the search key for names. */
export function searchKey(...parts: (string | null | undefined)[]): string {
  return parts
    .filter((p): p is string => typeof p === "string" && p.trim() !== "")
    .join(" ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9@.' -]+/g, " ")
    .replace(/['.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** ISO calendar date "YYYY-MM-DD" that exists (2026-02-30 is refused). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Today's date in the UK ("YYYY-MM-DD", Europe/London). */
export function ukToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Whole years between two ISO dates (age on a date). */
export function yearsBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  let years = ty - fy;
  if (tm < fm || (tm === fm && td < fd)) years -= 1;
  return years;
}

/** Adds whole years to an ISO date (29 Feb → 28 Feb in a non-leap year). */
export function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = y + years;
  const lastDay = new Date(Date.UTC(target, m, 0)).getUTCDate();
  return `${String(target).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

/** DD/MM/YYYY for display (UK). */
export function formatUkDate(iso: string | null | undefined): string {
  if (!iso || !isIsoDate(iso)) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Pence → "£1,234.50". */
export function formatPence(pence: number | null | undefined): string {
  if (typeof pence !== "number" || !Number.isFinite(pence)) return "";
  const sign = pence < 0 ? "-" : "";
  const abs = Math.abs(Math.round(pence));
  const pounds = Math.floor(abs / 100).toLocaleString("en-GB");
  return `${sign}£${pounds}.${String(abs % 100).padStart(2, "0")}`;
}
