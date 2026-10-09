/**
 * Date helpers (pure, timezone-safe for calendar dates). Data uses ISO `YYYY-MM-DD`;
 * everything shown to people uses UK `DD/MM/YYYY`.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `2026-03-21` → `21/03/2026`. Also accepts a full ISO date-time (uses its UTC date). Returns "" for empty input. */
export function formatUkDate(iso: string | undefined | null): string {
  if (!iso) return "";
  const datePart = iso.length >= 10 ? iso.slice(0, 10) : iso;
  const m = ISO_DATE.exec(datePart);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** `2026-03-21` → `21/03` (citation chips). */
export function formatUkDayMonth(iso: string | undefined | null): string {
  const full = formatUkDate(iso);
  return full.length === 10 ? full.slice(0, 5) : full;
}

/** ISO date-time → `06/10/2026 14:05` in Europe/London. */
export function formatUkDateTime(isoDateTime: string | undefined | null): string {
  if (!isoDateTime) return "";
  const d = new Date(isoDateTime);
  if (Number.isNaN(d.getTime())) return isoDateTime;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

/** `21/03/2026` → `2026-03-21`; returns null if the input is not a valid UK date. */
export function parseUkDate(uk: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(uk.trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return isValidIsoDate(iso) ? iso : null;
}

export function isValidIsoDate(iso: string): boolean {
  const m = ISO_DATE.exec(iso);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Today's calendar date in Europe/London as `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Current timestamp as an ISO 8601 string. */
export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

/** Whole years between `dobIso` and `onIso` (both `YYYY-MM-DD`). */
export function ageOn(dobIso: string, onIso: string): number {
  const [by, bm, bd] = dobIso.slice(0, 10).split("-").map(Number);
  const [oy, om, od] = onIso.slice(0, 10).split("-").map(Number);
  let age = oy - by;
  if (om < bm || (om === bm && od < bd)) age -= 1;
  return age;
}

/** Days from `fromIso` to `toIso` (calendar dates, may be negative). */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Sort comparator for ISO dates with optional `HH:mm` times (ascending). */
export function compareIsoDateTime(
  a: { date: string; time?: string },
  b: { date: string; time?: string },
): number {
  const ka = `${a.date}T${a.time ?? "00:00"}`;
  const kb = `${b.date}T${b.time ?? "00:00"}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}
