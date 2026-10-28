/**
 * Display helpers of the records screens (pure, browser-safe): times in Europe/London, "Today 11:00" /
 * "Tue 27/10 14:30", the name as written on screen ("Emily Turner"), the patient number ("HR-10482" style is the
 * design's mock – the clinic system's numbers are plain, so "No. 10482").
 */
import { formatUkDate } from "@/modules/pms/core/text";

const LONDON = "Europe/London";

export interface LondonParts {
  date: string;
  time: string;
  weekday: string;
}

/** An ISO instant as London date (YYYY-MM-DD), 24-hour time and short weekday. */
export function londonParts(iso: string): LondonParts {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}`, weekday: get("weekday") };
}

/** "Today 11:00", or "Tue 27/10 14:30" (this year), or "Tue 27/10/2025 14:30". */
export function whenLabel(iso: string, today: string, options: { withYear?: boolean } = {}): string {
  const p = londonParts(iso);
  if (p.date === today && !options.withYear) return `Today ${p.time}`;
  const date = formatUkDate(p.date);
  const short = options.withYear || p.date.slice(0, 4) !== today.slice(0, 4) ? date : date.slice(0, 5);
  return `${p.weekday} ${short} ${p.time}`;
}

/** "Today", or "Tue 27/10" for a date (YYYY-MM-DD). */
export function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" }).format(new Date(`${date}T12:00:00Z`));
  const uk = formatUkDate(date);
  return `${weekday} ${date.slice(0, 4) === today.slice(0, 4) ? uk.slice(0, 5) : uk}`;
}

/** 24-hour London time of an ISO instant ("11:40"). */
export function timeLabel(iso: string): string {
  return londonParts(iso).time;
}

/** The name as shown in lists and the header: first (or preferred) and last name. */
export function personName(p: { firstName: string; lastName: string; preferredName?: string | null }): string {
  return `${p.preferredName || p.firstName} ${p.lastName}`.trim();
}

/** "No. 10482" */
export function patientNumberLabel(n: number): string {
  return `Patient no. ${n}`;
}
