/**
 * UK clock rules for online booking. Every clinic in the clinic system is in Great Britain, so the diary, the
 * booking page and the patient portal all work in Europe/London local time (GMT in winter, BST in summer), while
 * the database stores instants as ISO-8601 UTC strings. Pure (Intl only) – browser-safe and unit-tested around the
 * clock changes (last Sunday of March: 01:00 → 02:00 does not exist; last Sunday of October: 01:00–02:00 happens
 * twice).
 */

export const UK_TIME_ZONE = "Europe/London";

const PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: UK_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export interface LondonParts {
  /** "YYYY-MM-DD" (UK calendar date). */
  date: string;
  /** Minutes after local midnight (0–1439). */
  minute: number;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number;
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a calendar date. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** UK local date, time of day and weekday of an instant. */
export function londonParts(ms: number): LondonParts {
  const parts = PARTS.formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  return { date, minute: Number(get("hour")) * 60 + Number(get("minute")), weekday: weekdayOf(date) };
}

/**
 * The instant of a UK local date and time of day, or null when that time does not exist (the hour the clocks go
 * forward). An hour that happens twice (clocks go back) gives its first occurrence (BST).
 */
export function londonToUtcMs(date: string, minute: number): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(minute) || minute < 0 || minute > 1439) return null;
  const [y, m, d] = date.split("-").map(Number);
  const asUtc = Date.UTC(y, m - 1, d, 0, minute);
  // Great Britain is UTC+1 (BST) or UTC+0 (GMT). Try the earlier instant first.
  for (const offset of [60, 0]) {
    const t = asUtc - offset * 60_000;
    const p = londonParts(t);
    if (p.date === date && p.minute === minute) return t;
  }
  return null;
}

/** Adds whole days to a calendar date ("2026-10-31" + 1 → "2026-11-01"). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (calendar dates). */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** The Monday of the week holding `date`. */
export function mondayOf(date: string): string {
  return addDays(date, 1 - weekdayOf(date));
}

/** 570 → "09:30". */
export function minutesToHhmm(minute: number): string {
  const m = Math.max(0, Math.min(1440, Math.round(minute)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "09:30" → 570; "24:00" → 1440 (an end of day); anything else → null. */
export function hhmmToMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-4]):([0-5]\d)$/.exec(String(value).trim());
  if (!match) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return minute > 1440 ? null : minute;
}

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** 1 → "Monday". */
export function weekdayName(weekday: number): string {
  return WEEKDAY_NAMES[(weekday - 1 + 7) % 7] ?? "";
}

/** "2026-10-26" → "Monday 26 October 2026" (or "Mon 26 Oct" when short). */
export function formatDateLong(date: string, options: { short?: boolean; withYear?: boolean } = {}): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const [y, m, d] = date.split("-").map(Number);
  const weekday = weekdayName(weekdayOf(date));
  const month = MONTH_NAMES[m - 1] ?? "";
  const withYear = options.withYear ?? !options.short;
  if (options.short) return `${weekday.slice(0, 3)} ${d} ${month.slice(0, 3)}${withYear ? ` ${y}` : ""}`;
  return `${weekday} ${d} ${month}${withYear ? ` ${y}` : ""}`;
}

/** An instant as UK local "09:30". */
export function formatUkTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  return minutesToHhmm(londonParts(ms).minute);
}

/** An instant as "Monday 26 October 2026 at 09:30" (UK local). */
export function formatUkDateTime(iso: string, options: { short?: boolean } = {}): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const p = londonParts(ms);
  return `${formatDateLong(p.date, { short: options.short, withYear: !options.short })} at ${minutesToHhmm(p.minute)}`;
}

/** ISO-8601 UTC instant with milliseconds ("2026-10-26T09:30:00.000Z"), as the database stores it. */
export function isIsoInstant(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value));
}
