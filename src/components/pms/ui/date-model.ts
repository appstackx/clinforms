/**
 * Pure date and time rules behind the kit's date picker and time picker (design brief round 2, Part A): UK dates
 * (DD/MM/YYYY on screen, ISO YYYY-MM-DD in values), Monday-first months, min/max limits, 24-hour time steps.
 * Calendar dates only – no time zones (a date is a day on the clinic's wall calendar).
 */

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
export const WEEKDAY_SHORT = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;
export const WEEKDAY_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number) => String(n).padStart(2, "0");

function partsOf(iso: string): [number, number, number] | null {
  const m = ISO.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return [y, mo, d];
}

export function isIsoDate(iso: string): boolean {
  return partsOf(iso) !== null;
}

export function isoOf(year: number, month: number, day: number): string {
  const t = new Date(Date.UTC(year, month - 1, day));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** "2026-10-27" → "27/10/2026" ("" for anything else). */
export function formatUkDate(iso: string): string {
  const p = partsOf(iso);
  return p ? `${pad(p[2])}/${pad(p[1])}/${p[0]}` : "";
}

/** "Tuesday 27 October 2026" – what a screen reader hears for a day button. */
export function longUkDate(iso: string): string {
  const p = partsOf(iso);
  if (!p) return "";
  return `${WEEKDAY_LONG[weekdayOf(iso) - 1]} ${p[2]} ${MONTH_NAMES[p[1] - 1]} ${p[0]}`;
}

/**
 * What a person typed → ISO, or null. Accepts 27/10/2026, 27-10-2026, 27.10.2026, 27 10 2026 and 1/2/2026; a two-digit
 * year is not guessed (a date of birth can be either century).
 */
export function parseUkDate(text: string): string | null {
  const m = /^\s*(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{4})\s*$/.exec(text);
  if (!m) return null;
  const iso = `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  return isIsoDate(iso) ? iso : null;
}

export function addDays(iso: string, n: number): string {
  const p = partsOf(iso);
  if (!p) return iso;
  return isoOf(p[0], p[1], p[2] + n);
}

/** Same day n months later, clamped to the month's last day (31/01 + 1 month → 28/02 or 29/02). */
export function addMonths(iso: string, n: number): string {
  const p = partsOf(iso);
  if (!p) return iso;
  const first = new Date(Date.UTC(p[0], p[1] - 1 + n, 1));
  const y = first.getUTCFullYear();
  const mo = first.getUTCMonth() + 1;
  return isoOf(y, mo, Math.min(p[2], daysInMonth(y, mo)));
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function weekdayOf(iso: string): number {
  const p = partsOf(iso);
  if (!p) return 1;
  return ((new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() + 6) % 7) + 1;
}

export function monthOf(iso: string): { year: number; month: number } {
  const p = partsOf(iso);
  return p ? { year: p[0], month: p[1] } : { year: 1970, month: 1 };
}

/**
 * The month as Monday-first weeks: each cell an ISO date, with `inMonth` false for the leading/trailing days of the
 * neighbouring months (shown faded so the grid is always whole weeks).
 */
export function monthGrid(year: number, month: number): { iso: string; inMonth: boolean }[][] {
  const first = isoOf(year, month, 1);
  const start = addDays(first, -(weekdayOf(first) - 1));
  const last = isoOf(year, month, daysInMonth(year, month));
  const end = addDays(last, 7 - weekdayOf(last));
  const weeks: { iso: string; inMonth: boolean }[][] = [];
  for (let d = start; d <= end; d = addDays(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => {
      const iso = addDays(d, i);
      return { iso, inMonth: monthOf(iso).month === month };
    }));
  }
  return weeks;
}

/** Inside [min, max] (either may be absent). ISO strings compare correctly as text. */
export function inRange(iso: string, min?: string, max?: string): boolean {
  return (!min || iso >= min) && (!max || iso <= max);
}

export function clampDate(iso: string, min?: string, max?: string): string {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

/**
 * Where a key moves the calendar's focused day (WAI-ARIA date picker dialog): arrows ±1 day / ±1 week, Home/End the
 * week's Monday/Sunday, PageUp/PageDown ±1 month (with Shift ±1 year). Null for any other key.
 */
export function moveFocus(iso: string, key: string, shift = false): string | null {
  switch (key) {
    case "ArrowLeft":
      return addDays(iso, -1);
    case "ArrowRight":
      return addDays(iso, 1);
    case "ArrowUp":
      return addDays(iso, -7);
    case "ArrowDown":
      return addDays(iso, 7);
    case "Home":
      return addDays(iso, -(weekdayOf(iso) - 1));
    case "End":
      return addDays(iso, 7 - weekdayOf(iso));
    case "PageUp":
      return addMonths(iso, shift ? -12 : -1);
    case "PageDown":
      return addMonths(iso, shift ? 12 : 1);
    default:
      return null;
  }
}

/** "HH:MM" → minutes after midnight, or null. */
export function minutesOfTime(text: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function timeOfMinutes(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** 24-hour times from `from` to `to` (inclusive) every `step` minutes – the time picker's options. */
export function timeSlots(step: 5 | 10 | 15 | 30 | 60, from = "00:00", to = "23:55"): string[] {
  const a = minutesOfTime(from) ?? 0;
  const b = minutesOfTime(to) ?? 24 * 60 - 1;
  const first = Math.ceil(a / step) * step;
  const out: string[] = [];
  for (let m = first; m <= b; m += step) out.push(timeOfMinutes(m));
  return out;
}
