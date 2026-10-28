/**
 * When appointment messages go out (pure). All wall-clock times are UK time (Europe/London, with the clock
 * changes); instants are ISO-8601 UTC strings.
 *
 * - Booking confirmations and "moved"/"cancelled"/"late_cancelled" notices are due at once (texts wait for the end
 *   of the quiet hours, default 20:00–08:00 – emails do not). The "did not attend" follow-up is due an hour after
 *   the start (DNA_FOLLOW_UP_MINUTES), or at once when marked later; it is not sent more than a day after.
 * - Reminders follow the clinic's rules: "N hours before" or "N days before at HH:MM". A text that would fall in
 *   the quiet hours moves to the end of them, or – when that is too close to the appointment – to just before
 *   they began.
 * - A reminder is not planned when its time has already passed at booking (the confirmation covers it) or when it
 *   would land less than MIN_REMINDER_LEAD_MINUTES before the start. At sending time a reminder still due less
 *   than SEND_CUTOFF_MINUTES before the start is skipped as too late; nothing is sent once the appointment began.
 */
import type { AppointmentMessageKind, CommsSettings, MessageChannel, ReminderRule } from "./types";

export const LONDON = "Europe/London";
export const MIN_REMINDER_LEAD_MINUTES = 60;
export const SEND_CUTOFF_MINUTES = 30;
export const DNA_FOLLOW_UP_MINUTES = 60;
export const DNA_FOLLOW_UP_LIMIT_HOURS = 24;
const MINUTE = 60_000;

export interface LondonParts {
  date: string;
  time: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** The UK calendar date and wall-clock time of an instant. */
export function londonParts(instant: string | Date | number): LondonParts {
  const d = instant instanceof Date ? instant : new Date(instant);
  const get = (parts: Intl.DateTimeFormatPart[], type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const parts = PARTS.formatToParts(d);
  const year = get(parts, "year");
  const month = get(parts, "month");
  const day = get(parts, "day");
  const hour = get(parts, "hour") % 24;
  const minute = get(parts, "minute");
  const pad = (n: number) => String(n).padStart(2, "0");
  return { year, month, day, hour, minute, date: `${year}-${pad(month)}-${pad(day)}`, time: `${pad(hour)}:${pad(minute)}` };
}

function londonOffsetMinutes(utcMs: number): number {
  const p = londonParts(utcMs);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((wall - Math.floor(utcMs / MINUTE) * MINUTE) / MINUTE);
}

/**
 * A UK wall-clock time on a UK date → the UTC instant. A time in the spring gap (01:00–02:00 on the day the clocks
 * go forward) comes out an hour later; an autumn time that happens twice resolves to one of them.
 */
export function londonToUtcIso(date: string, time: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let utc = wall - londonOffsetMinutes(wall) * MINUTE;
  utc = wall - londonOffsetMinutes(utc) * MINUTE;
  return new Date(utc).toISOString();
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Whether "HH:MM" falls in the quiet period [start, end) (which may run past midnight). Equal = none. */
export function isQuietTime(time: string, quietStart: string, quietEnd: string): boolean {
  if (quietStart === quietEnd) return false;
  if (quietStart < quietEnd) return time >= quietStart && time < quietEnd;
  return time >= quietStart || time < quietEnd;
}

/**
 * A text that is not planned (a waiting-list offer) written at `nowIso`: null when it may go now, else the UTC instant
 * the quiet hours end (UK time) – it is held until then.
 */
export function quietHoursEndAt(nowIso: string, quietStart: string, quietEnd: string): string | null {
  if (quietStart === quietEnd) return null;
  const p = londonParts(nowIso);
  if (!isQuietTime(p.time, quietStart, quietEnd)) return null;
  return londonToUtcIso(p.time < quietEnd ? p.date : addDays(p.date, 1), quietEnd);
}

/** Moves a text's due time out of the quiet hours (see the file comment). */
export function outOfQuietHours(dueIso: string, startsAtIso: string, quietStart: string, quietEnd: string): string {
  if (quietStart === quietEnd) return dueIso;
  const p = londonParts(dueIso);
  if (!isQuietTime(p.time, quietStart, quietEnd)) return dueIso;
  const endDate = p.time < quietEnd ? p.date : addDays(p.date, 1);
  const forward = londonToUtcIso(endDate, quietEnd);
  if (Date.parse(forward) <= Date.parse(startsAtIso) - MIN_REMINDER_LEAD_MINUTES * MINUTE) return forward;
  const startDate = quietStart <= p.time ? p.date : addDays(p.date, -1);
  return new Date(Date.parse(londonToUtcIso(startDate, quietStart)) - 15 * MINUTE).toISOString();
}

/** When a rule's reminder is due for an appointment (before quiet-hours adjustment). */
export function reminderDueAt(startsAtIso: string, rule: Pick<ReminderRule, "timing" | "hoursBefore" | "daysBefore" | "sendAt">): string | null {
  const start = Date.parse(startsAtIso);
  if (Number.isNaN(start)) return null;
  if (rule.timing === "hours_before") {
    if (!rule.hoursBefore) return null;
    return new Date(start - rule.hoursBefore * 60 * MINUTE).toISOString();
  }
  if (!rule.daysBefore || !rule.sendAt) return null;
  return londonToUtcIso(addDays(londonParts(start).date, -rule.daysBefore), rule.sendAt);
}

export interface PlannedMessage {
  kind: AppointmentMessageKind;
  channel: MessageChannel;
  ruleId: string | null;
  dueAt: string;
  /** Unique per appointment: kind, channel, rule and the start time it was planned for. */
  dedupeKey: string;
  /** A text moved out of the quiet hours ("Held – quiet hours" on the outbox). */
  held: boolean;
}

export interface PlanInput {
  appointment: { startsAt: string; serviceId?: string | null; active: boolean };
  notify: "none" | "confirmation" | "moved" | "cancelled" | "late_cancelled" | "dna";
  settings: Pick<CommsSettings, "confirmationsSms" | "confirmationsEmail" | "changeNotices" | "dnaFollowUp" | "quietStart" | "quietEnd">;
  /** The clinic's reminder rules (inactive ones are ignored). */
  rules: readonly Pick<ReminderRule, "id" | "channel" | "timing" | "hoursBefore" | "daysBefore" | "sendAt" | "serviceIds" | "active">[];
  now: string;
}

export function dedupeKey(kind: AppointmentMessageKind, channel: MessageChannel, ruleId: string | null, startsAtIso: string): string {
  return `${kind}:${channel}:${ruleId ?? "-"}:${new Date(startsAtIso).toISOString()}`;
}

/** The messages an appointment should have, as of `now`. */
export function planAppointmentMessages(input: PlanInput): PlannedMessage[] {
  const { appointment, notify, settings, now } = input;
  const startsAt = new Date(appointment.startsAt).toISOString();
  const nowMs = Date.parse(now);
  const start = Date.parse(startsAt);
  if (Number.isNaN(start)) return [];
  const out: PlannedMessage[] = [];
  const noticeChannels: MessageChannel[] = [];
  if (settings.confirmationsSms) noticeChannels.push("sms");
  if (settings.confirmationsEmail) noticeChannels.push("email");
  if (!appointment.active && notify === "dna") {
    if (!settings.dnaFollowUp || nowMs > start + DNA_FOLLOW_UP_LIMIT_HOURS * 60 * MINUTE) return [];
    const base = new Date(Math.max(nowMs, start + DNA_FOLLOW_UP_MINUTES * MINUTE)).toISOString();
    for (const channel of noticeChannels) {
      const due = channel === "sms" ? outOfQuietHours(base, new Date(start + DNA_FOLLOW_UP_LIMIT_HOURS * 60 * MINUTE).toISOString(), settings.quietStart, settings.quietEnd) : base;
      out.push({ kind: "dna", channel, ruleId: null, dueAt: due, dedupeKey: dedupeKey("dna", channel, null, startsAt), held: due !== base });
    }
    return out;
  }
  if (start <= nowMs) return [];
  const immediate = (kind: AppointmentMessageKind) => {
    for (const channel of noticeChannels) {
      const at = new Date(nowMs).toISOString();
      const due = channel === "sms" ? outOfQuietHours(at, startsAt, settings.quietStart, settings.quietEnd) : at;
      if (Date.parse(due) >= start) continue;
      out.push({ kind, channel, ruleId: null, dueAt: due, dedupeKey: dedupeKey(kind, channel, null, startsAt), held: due !== at });
    }
  };
  if (!appointment.active) {
    if ((notify === "cancelled" || notify === "late_cancelled") && settings.changeNotices) immediate(notify);
    return out;
  }
  if (notify === "confirmation") immediate("confirmation");
  if (notify === "moved" && settings.changeNotices) immediate("moved");
  for (const rule of input.rules) {
    if (!rule.active) continue;
    if (rule.serviceIds && rule.serviceIds.length > 0 && (!appointment.serviceId || !rule.serviceIds.includes(appointment.serviceId))) continue;
    const wanted = reminderDueAt(startsAt, rule);
    if (!wanted) continue;
    const due = rule.channel === "sms" ? outOfQuietHours(wanted, startsAt, settings.quietStart, settings.quietEnd) : wanted;
    const dueMs = Date.parse(due);
    if (dueMs <= nowMs) continue;
    if (dueMs > start - MIN_REMINDER_LEAD_MINUTES * MINUTE) continue;
    out.push({ kind: "reminder", channel: rule.channel, ruleId: rule.id, dueAt: due, dedupeKey: dedupeKey("reminder", rule.channel, rule.id, startsAt), held: due !== wanted });
  }
  return out;
}

/** Whether a planned message may still go out at `now` (else it is skipped as too late). */
export function stillWorthSending(kind: AppointmentMessageKind, startsAtIso: string, nowIso: string): boolean {
  const start = Date.parse(startsAtIso);
  const now = Date.parse(nowIso);
  if (kind === "dna") return now <= start + DNA_FOLLOW_UP_LIMIT_HOURS * 60 * MINUTE;
  if (now >= start) return false;
  if (kind === "reminder") return now <= start - SEND_CUTOFF_MINUTES * MINUTE;
  return true;
}

const DATE_LONG = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, weekday: "long", day: "numeric", month: "long" });
const DATE_FULL = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, day: "numeric", month: "long", year: "numeric" });

/** "Tuesday 27 October" (UK time). */
export function formatAppointmentDate(instant: string): string {
  return DATE_LONG.format(new Date(instant)).replace(",", "");
}

const DAY_SHORT = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, weekday: "short" });

/** "Tue 27/10" (UK time) – the texts' date. */
export function formatAppointmentDay(instant: string): string {
  const p = londonParts(instant);
  return `${DAY_SHORT.format(new Date(instant))} ${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")}`;
}

/** "27/10/2026" (UK date of the instant). */
export function formatAppointmentDateShort(instant: string): string {
  const p = londonParts(instant);
  return `${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")}/${p.year}`;
}

/** "14:30" (24 h, UK time). */
export function formatAppointmentTime(instant: string): string {
  return londonParts(instant).time;
}

/** "30 minutes", "1 hour", "1 hour 15 minutes". */
export function formatDuration(startIso: string, endIso: string | null | undefined): string {
  if (!endIso) return "";
  const minutes = Math.round((Date.parse(endIso) - Date.parse(startIso)) / MINUTE);
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} hour${h === 1 ? "" : "s"}`);
  if (m) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
  return parts.join(" ");
}

/** "24 October 2026" for a calendar date "YYYY-MM-DD". */
export function formatLongDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return DATE_FULL.format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** "27/10/2026 14:30" for lists (UK time). */
export function formatUkDateTime(instant: string | null | undefined): string {
  if (!instant) return "";
  const p = londonParts(instant);
  return `${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")}/${p.year} ${p.time}`;
}
