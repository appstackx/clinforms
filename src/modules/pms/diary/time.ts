/**
 * Diary time: every clinic in the system works in UK time (Europe/London, GMT in winter, BST in summer). The
 * database stores instants (ISO-8601 UTC "2026-10-24T09:00:00.000Z"); screens and forms use the wall clock
 * ("YYYY-MM-DD" + minutes after midnight). This file converts between the two, including the two days a year the
 * clocks change:
 *
 *   - spring (last Sunday of March): 01:00–01:59 does not exist – londonToUtc() answers { ok: false, reason: "gap" };
 *   - autumn (last Sunday of October): 01:00–01:59 happens twice – londonToUtc() takes the FIRST one (BST).
 *
 * A London day is 23, 24 or 25 hours long, so day ranges are computed from local midnights (londonDayRange), never
 * as "+24 h". Pure (Intl only) – browser-safe.
 */

export const DIARY_TIME_ZONE = "Europe/London";

const PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: DIARY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** The wall clock in London at an instant. */
export interface LondonParts {
  /** "YYYY-MM-DD" */
  date: string;
  /** Minutes after local midnight, 0–1439. */
  minute: number;
  /** ISO weekday: Monday 1 … Sunday 7. */
  weekday: number;
}

function toDate(at: Date | number | string): Date {
  return at instanceof Date ? at : new Date(at);
}

export function londonParts(at: Date | number | string): LondonParts {
  const parts = PARTS.formatToParts(toDate(at));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = Number(get("hour")) % 24;
  return { date, minute: hour * 60 + Number(get("minute")), weekday: isoWeekday(date) };
}

/** London calendar date of an instant ("YYYY-MM-DD"). */
export function londonDate(at: Date | number | string): string {
  return londonParts(at).date;
}

export type LocalTimeResult = { ok: true; iso: string } | { ok: false; reason: "gap" };

/**
 * The instant of a London wall-clock time. `minute` may be 1440 (= midnight at the end of the day) or more (rolls
 * into the next day). On the autumn change the first (BST) occurrence wins; in the spring gap there is no instant.
 */
export function londonToUtc(date: string, minute: number): LocalTimeResult {
  if (!isIsoDay(date) || !Number.isInteger(minute) || minute < 0 || minute > 2 * 1440) return { ok: false, reason: "gap" };
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, minute);
  const target = new Date(wall).toISOString();
  const targetDate = target.slice(0, 10);
  const targetMinute = Number(target.slice(11, 13)) * 60 + Number(target.slice(14, 16));
  // London is UTC+1 (BST) or UTC+0 (GMT). Try BST first so the earlier instant wins in the repeated autumn hour.
  for (const offsetMinutes of [60, 0]) {
    const t = wall - offsetMinutes * MINUTE_MS;
    const p = londonParts(t);
    if (p.date === targetDate && p.minute === targetMinute) return { ok: true, iso: new Date(t).toISOString() };
  }
  return { ok: false, reason: "gap" };
}

/** Like londonToUtc() but throws (for values already validated, e.g. a local midnight). */
export function londonToUtcOrThrow(date: string, minute: number): string {
  const r = londonToUtc(date, minute);
  if (!r.ok) throw new Error(`${date} ${formatHhmm(minute)} does not exist in UK time.`);
  return r.iso;
}

/** [from, to) of a London calendar day as UTC instants (23, 24 or 25 hours). */
export function londonDayRange(date: string): { from: string; to: string } {
  return { from: londonToUtcOrThrow(date, 0), to: londonToUtcOrThrow(addDays(date, 1), 0) };
}

/** [from, to) of several London days: `days` days from `date`. */
export function londonRange(date: string, days: number): { from: string; to: string } {
  return { from: londonToUtcOrThrow(date, 0), to: londonToUtcOrThrow(addDays(date, Math.max(1, days)), 0) };
}

/* ------------------------------------------------------------------------------------------------
 * Calendar dates ("YYYY-MM-DD")
 * ----------------------------------------------------------------------------------------------*/

export function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function fromDayNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fromDayNumber(dayNumber(date) + days);
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}

/** ISO weekday of a date: Monday 1 … Sunday 7. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}

/** The Monday of the week holding `date`. */
export function mondayOf(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

/** Whole weeks between the Mondays of two dates (b − a). */
export function weeksBetween(a: string, b: string): number {
  return Math.round(daysBetween(mondayOf(a), mondayOf(b)) / 7);
}

/** The dates of the week (Monday first) holding `date`. */
export function weekDates(date: string): string[] {
  const monday = mondayOf(date);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/* ------------------------------------------------------------------------------------------------
 * Times of day
 * ----------------------------------------------------------------------------------------------*/

/** "09:30" → 570; null for anything that is not a 24-hour HH:MM time. */
export function parseHhmm(value: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 570 → "09:30" (1440 → "24:00"). */
export function formatHhmm(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "09:30" in London for an instant. */
export function formatLondonTime(at: Date | number | string): string {
  return formatHhmm(londonParts(at).minute);
}

/** Minutes between two instants (b − a). */
export function minutesBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / MINUTE_MS);
}

/** An instant plus whole minutes. */
export function addMinutesIso(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * MINUTE_MS).toISOString();
}

/** A canonical ISO-8601 UTC timestamp with milliseconds (what the database stores and compares as text on SQLite). */
export function isCanonicalIso(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && new Date(value).toISOString() === value;
}

/* ------------------------------------------------------------------------------------------------
 * Display
 * ----------------------------------------------------------------------------------------------*/

// Display strings are built from fixed name tables, not Intl: the server and the browser can carry different
// locale data, and the diary is rendered on both (a mismatch would break hydration).
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** "Saturday 24 October 2026" */
export function formatDayHeading(date: string): string {
  if (!isIsoDay(date)) return "";
  const [y, m, d] = date.split("-").map(Number);
  return `${weekdayName(isoWeekday(date))} ${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

/** "Sat 24/10" (the design's DD/MM short day; M10 rules – was "Sat 24 Oct") */
export function formatDayShort(date: string): string {
  if (!isIsoDay(date)) return "";
  const [, mm, dd] = date.split("-");
  return `${weekdayName(isoWeekday(date)).slice(0, 3)} ${dd}/${mm}`;
}

export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** 1 → "Monday" */
export function weekdayName(weekday: number): string {
  return WEEKDAY_NAMES[weekday - 1] ?? "";
}
