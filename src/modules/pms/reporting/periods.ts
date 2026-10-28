/**
 * Report periods and UK calendar arithmetic (pure, browser-safe). Dates are "YYYY-MM-DD" UK calendar dates;
 * instants are ISO-8601 UTC strings. A period is inclusive of both ends; weeks start on Monday (UK); quarters
 * are calendar quarters. The longest period a report covers is MAX_PERIOD_DAYS.
 */
import { isIsoDate } from "../core/text";

export const PERIOD_PRESETS = [
  "this_week",
  "last_6_weeks",
  "last_week",
  "this_month",
  "last_month",
  "last_30_days",
  "this_quarter",
  "last_quarter",
  "last_12_months",
  "this_year",
  "custom",
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_LABELS: Readonly<Record<PeriodPreset, string>> = {
  this_week: "This week",
  last_6_weeks: "Last 6 weeks",
  last_week: "Last week",
  this_month: "This month",
  last_month: "Last month",
  last_30_days: "Last 30 days",
  this_quarter: "This quarter",
  last_quarter: "Last quarter",
  last_12_months: "Last 12 months",
  this_year: "This year",
  custom: "Choose dates",
};

export const DEFAULT_PRESET: PeriodPreset = "last_6_weeks";

/** The period chips of the report filter bar (design round 2c); "custom" opens the date fields. */
export const REPORT_PERIOD_CHIPS: readonly PeriodPreset[] = ["this_week", "last_6_weeks", "this_quarter", "custom"];
/** A report never covers more than this many days (one year and a day: a leap year plus a margin). */
export const MAX_PERIOD_DAYS = 367;

export interface ReportPeriod {
  preset: PeriodPreset;
  from: string;
  to: string;
  /** Number of days, both ends included. */
  days: number;
}

export function isPeriodPreset(value: unknown): value is PeriodPreset {
  return typeof value === "string" && (PERIOD_PRESETS as readonly string[]).includes(value);
}

/** Day number since 1970-01-01 of a calendar date. */
export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function fromDayNumber(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return fromDayNumber(dayNumber(iso) + days);
}

/** Days from `from` to `to`, both included (0 when `to` is before `from`). */
export function daysInclusive(from: string, to: string): number {
  return Math.max(0, dayNumber(to) - dayNumber(from) + 1);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(iso: string): number {
  const dow = new Date(dayNumber(iso) * 86_400_000).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** Every date of a period, in order (callers keep periods within MAX_PERIOD_DAYS). */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const end = dayNumber(to);
  for (let n = dayNumber(from); n <= end; n++) out.push(fromDayNumber(n));
  return out;
}

/** "YYYY-MM" of a date. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** The months a period touches, in order ("YYYY-MM"). */
export function monthsOf(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** The Monday of the week a date is in (UK weeks start on Monday). */
export function weekStart(iso: string): string {
  return addDays(iso, 1 - isoWeekday(iso));
}

/** The weeks (their Mondays) a period touches, in order. */
export function weeksOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let w = weekStart(from); w <= to; w = addDays(w, 7)) out.push(w);
  return out;
}

/** "2026-09-21" → "w/c 21/09/2026" (long) or "21/09" (short, chart labels). */
export function weekLabel(monday: string, short = false): string {
  const [y, m, d] = monday.split("-");
  return short ? `${d}/${m}` : `w/c ${d}/${m}/${y}`;
}

/** "2026-10" → "Oct 2026". */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[(m - 1 + 12) % 12]} ${y}`;
}

function firstOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function lastOfMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return fromDayNumber(Math.floor(Date.UTC(y, m, 0) / 86_400_000));
}

function shiftMonths(iso: string, months: number): string {
  const [y, m] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

function quarterStart(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
}

export type PeriodResult = { ok: true; period: ReportPeriod } | { ok: false; error: string };

/**
 * The period of a preset on `today` (UK). "custom" needs `from` and `to`. Periods may end in the future (this
 * month includes the days still to come: the diary already holds bookings for them).
 */
export function resolvePeriod(preset: PeriodPreset, today: string, custom: { from?: string | null; to?: string | null } = {}): PeriodResult {
  let from: string;
  let to: string;
  switch (preset) {
    case "this_week":
      from = addDays(today, 1 - isoWeekday(today));
      to = addDays(from, 6);
      break;
    case "last_6_weeks":
      from = addDays(today, 1 - isoWeekday(today) - 35);
      to = addDays(today, 7 - isoWeekday(today));
      break;
    case "last_week":
      from = addDays(today, 1 - isoWeekday(today) - 7);
      to = addDays(from, 6);
      break;
    case "this_month":
      from = firstOfMonth(today);
      to = lastOfMonth(today);
      break;
    case "last_month":
      from = shiftMonths(today, -1);
      to = lastOfMonth(from);
      break;
    case "last_30_days":
      from = addDays(today, -29);
      to = today;
      break;
    case "this_quarter":
      from = quarterStart(today);
      to = lastOfMonth(shiftMonths(from, 2));
      break;
    case "last_quarter":
      from = shiftMonths(quarterStart(today), -3);
      to = lastOfMonth(shiftMonths(from, 2));
      break;
    case "last_12_months":
      from = shiftMonths(today, -11);
      to = lastOfMonth(today);
      break;
    case "this_year":
      from = `${today.slice(0, 4)}-01-01`;
      to = `${today.slice(0, 4)}-12-31`;
      break;
    case "custom": {
      if (!custom.from || !isIsoDate(custom.from) || !custom.to || !isIsoDate(custom.to)) return { ok: false, error: "Enter a start and an end date." };
      from = custom.from;
      to = custom.to;
      if (to < from) return { ok: false, error: "The end date is before the start date." };
      break;
    }
    default:
      return { ok: false, error: "Choose a period." };
  }
  const days = daysInclusive(from, to);
  if (days > MAX_PERIOD_DAYS) return { ok: false, error: "Choose a period of at most a year." };
  return { ok: true, period: { preset, from, to, days } };
}

/* ------------------------------------------------------------------------------------------------
 * UK time (Europe/London)
 * ----------------------------------------------------------------------------------------------*/

const LONDON_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function londonParts(ms: number): { date: string; minutes: number; offsetMinutes: number } {
  const parts = LONDON_PARTS.formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const y = get("year");
  const mo = get("month");
  const d = get("day");
  const h = get("hour");
  const mi = get("minute");
  const s = get("second");
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const offsetMinutes = Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
  return { date: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`, minutes: h * 60 + mi, offsetMinutes };
}

/** The UK calendar date of an instant ("2026-10-24T23:30:00Z" → "2026-10-25" in summer time). */
export function ukDateOf(instant: string): string {
  const ms = Date.parse(instant);
  return Number.isNaN(ms) ? "" : londonParts(ms).date;
}

/** Minutes after UK midnight of an instant (0–1439). */
export function ukMinutesOf(instant: string): number {
  const ms = Date.parse(instant);
  return Number.isNaN(ms) ? 0 : londonParts(ms).minutes;
}

/**
 * The instant (ms) of UK midnight at the start of a date. Clocks change at 01:00 UTC, so the offset at 00:00 UTC
 * of the same date is the offset at local midnight.
 */
export function ukMidnightMs(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  return guess - londonParts(guess).offsetMinutes * 60_000;
}

/** The instants a period covers: [start of `from`, start of the day after `to`) as ISO strings. */
export function periodInstants(period: Pick<ReportPeriod, "from" | "to">): { start: string; end: string } {
  return { start: new Date(ukMidnightMs(period.from)).toISOString(), end: new Date(ukMidnightMs(addDays(period.to, 1))).toISOString() };
}
