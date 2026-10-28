/**
 * Turning form fields into the shared record's inputs (pure, used by the records module's server actions and
 * tested here): money in pounds → pence, address boxes → lines, check boxes → booleans, dates, ages.
 */
import { yearsBetween } from "../core/text";

/** "£1,234.50", "1234.5", "65" → pence; "" → null; anything else → NaN (the schema then reports it). */
export function poundsToPence(value: string | null | undefined): number | null {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  const cleaned = raw.replace(/^£/, "").replace(/,/g, "").trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(cleaned)) return Number.NaN;
  const [pounds, pence = ""] = cleaned.split(".");
  return Number(pounds) * 100 + Number(pence.padEnd(2, "0"));
}

/** Pence → "1234.50" for an input box ("" for none). */
export function penceToPounds(pence: number | null | undefined): string {
  if (typeof pence !== "number" || !Number.isFinite(pence)) return "";
  return (pence / 100).toFixed(2);
}

/** A text box with one address line per row → lines (empty rows dropped). */
export function addressLines(value: string | null | undefined): string[] | null {
  const lines = String(value ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length ? lines : null;
}

/** A whole number from a box ("" → null, junk → NaN). */
export function wholeNumber(value: string | null | undefined): number | null {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  return /^\d{1,6}$/.test(raw) ? Number(raw) : Number.NaN;
}

/** Age in whole years on `today` (null without a date of birth). */
export function ageOn(dateOfBirth: string | null | undefined, today: string): number | null {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const years = yearsBetween(dateOfBirth, today);
  return years >= 0 ? years : null;
}

/** The name shown on the record: title, first (preferred) last. */
export function displayName(p: { title?: string | null; firstName: string; lastName: string; preferredName?: string | null }): string {
  const first = p.preferredName && p.preferredName !== p.firstName ? `${p.firstName} (${p.preferredName})` : p.firstName;
  return [p.title, first, p.lastName].filter(Boolean).join(" ");
}

/** The record's id in a URL must look like one of our ids (anything else is the 404 page, no query). */
export function isPlausibleRecordId(id: unknown): id is string {
  return typeof id === "string" && /^[a-z]{2,8}_[0-9A-HJKMNP-TV-Z]{26}$/.test(id);
}
