/**
 * The online booking slot engine (pure). Which start times a patient may pick:
 *
 *   online booking hours of the practitioner at the site (weekly, UK local time, optional date range)
 *   ∩ the diary's working hours when the diary provides them (null = no restriction)
 *   − busy time (appointments and blocked time, each including its buffer)
 *   − anything sooner than the minimum notice or later than the booking horizon.
 *
 * A slot is [start, start + duration) and keeps the practitioner busy until start + duration + buffer. The
 * appointment itself must fit inside the hours; the buffer may run past them (tidy-up time). Times are stepped
 * from the start of each hours row (09:00, 09:15 … for a 15-minute step). The hour the clocks go forward has no
 * slots. The server recomputes the slots on every booking and refuses a start time that is not one of them, and
 * the database refuses an overlapping booking whatever this code says (trigger on pms_online_bookings).
 */
import { addDays, daysBetween, londonParts, londonToUtcMs, weekdayOf } from "./time";

export interface HoursRule {
  practitionerId: string;
  siteId: string;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number;
  /** Minutes after local midnight. */
  startMinute: number;
  endMinute: number;
  /** "YYYY-MM-DD" or null (open-ended). */
  validFrom: string | null;
  validTo: string | null;
}

export interface BusyInterval {
  practitionerId: string;
  startMs: number;
  /** Includes the buffer after the appointment. */
  endMs: number;
}

export interface WorkingWindow {
  practitionerId: string;
  startMs: number;
  endMs: number;
}

export interface SlotQuery {
  rules: readonly HoursRule[];
  busy: readonly BusyInterval[];
  /** The diary's working windows; null or undefined = the online hours alone decide. */
  working?: readonly WorkingWindow[] | null;
  siteId: string;
  /** Candidates in the order the clinic lists them (the first free one wins for "any practitioner"). */
  practitionerIds: readonly string[];
  durationMinutes: number;
  bufferMinutes: number;
  stepMinutes: number;
  /** First UK calendar day to look at. */
  fromDate: string;
  /** Number of days from fromDate (1–14). */
  days: number;
  nowMs: number;
  minNoticeMinutes: number;
  /** The last bookable day is today (UK) + maxDaysAhead. */
  maxDaysAhead: number;
}

export interface Slot {
  practitionerId: string;
  siteId: string;
  /** UK calendar date and local minute of the start. */
  date: string;
  minute: number;
  startsAt: string;
  endsAt: string;
  /** End of the time the practitioner is kept busy (end + buffer). */
  blocksUntil: string;
}

export const MAX_SLOT_DAYS = 14;

/** Half-open intervals [a1, a2) and [b1, b2) share time. */
export function overlaps(a1: number, a2: number, b1: number, b2: number): boolean {
  return a1 < b2 && b1 < a2;
}

function ruleApplies(rule: HoursRule, date: string, weekday: number): boolean {
  if (rule.weekday !== weekday) return false;
  if (rule.validFrom && date < rule.validFrom) return false;
  if (rule.validTo && date > rule.validTo) return false;
  return true;
}

/** Every bookable slot, earliest first (then in the clinic's practitioner order). */
export function computeSlots(q: SlotQuery): Slot[] {
  const days = Math.max(0, Math.min(MAX_SLOT_DAYS, Math.floor(q.days)));
  const duration = q.durationMinutes * 60_000;
  const buffer = Math.max(0, q.bufferMinutes) * 60_000;
  const step = Math.max(5, Math.floor(q.stepMinutes));
  if (days === 0 || q.durationMinutes <= 0 || q.practitionerIds.length === 0) return [];
  const today = londonParts(q.nowMs).date;
  const lastDay = addDays(today, Math.max(0, q.maxDaysAhead));
  const earliest = q.nowMs + Math.max(0, q.minNoticeMinutes) * 60_000;
  const order = new Map(q.practitionerIds.map((id, i) => [id, i]));
  const busyBy = new Map<string, BusyInterval[]>();
  for (const b of q.busy) {
    if (!order.has(b.practitionerId)) continue;
    const list = busyBy.get(b.practitionerId) ?? [];
    list.push(b);
    busyBy.set(b.practitionerId, list);
  }
  const workingBy = q.working ? new Map<string, WorkingWindow[]>() : null;
  if (q.working && workingBy) {
    for (const w of q.working) {
      const list = workingBy.get(w.practitionerId) ?? [];
      list.push(w);
      workingBy.set(w.practitionerId, list);
    }
  }
  const out: Slot[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < days; i++) {
    const date = addDays(q.fromDate, i);
    if (date < today || date > lastDay) continue;
    const weekday = weekdayOf(date);
    for (const rule of q.rules) {
      if (rule.siteId !== q.siteId || !order.has(rule.practitionerId) || !ruleApplies(rule, date, weekday)) continue;
      for (let minute = rule.startMinute; minute + q.durationMinutes <= rule.endMinute; minute += step) {
        if (minute > 1439) break;
        const start = londonToUtcMs(date, minute);
        if (start === null || start < earliest) continue;
        const end = start + duration;
        const blocks = end + buffer;
        // An appointment that runs over a clock change keeps its real length (UTC arithmetic).
        const busy = busyBy.get(rule.practitionerId) ?? [];
        if (busy.some((b) => overlaps(start, blocks, b.startMs, b.endMs))) continue;
        if (workingBy) {
          const windows = workingBy.get(rule.practitionerId) ?? [];
          if (!windows.some((w) => w.startMs <= start && end <= w.endMs)) continue;
        }
        const key = `${rule.practitionerId}|${start}`;
        if (seen.has(key)) continue; // two overlapping hours rows of one practitioner
        seen.add(key);
        out.push({
          practitionerId: rule.practitionerId,
          siteId: rule.siteId,
          date,
          minute,
          startsAt: new Date(start).toISOString(),
          endsAt: new Date(end).toISOString(),
          blocksUntil: new Date(blocks).toISOString(),
        });
      }
    }
  }
  return out.sort((a, b) => (a.startsAt === b.startsAt ? (order.get(a.practitionerId) ?? 0) - (order.get(b.practitionerId) ?? 0) : a.startsAt < b.startsAt ? -1 : 1));
}

/** The slot for a start time and a practitioner ("any" = the first free practitioner at that time). */
export function pickSlot(slots: readonly Slot[], startsAt: string, practitionerId: string | "any"): Slot | null {
  return slots.find((s) => s.startsAt === startsAt && (practitionerId === "any" || s.practitionerId === practitionerId)) ?? null;
}

/** Slots grouped by UK date, one entry per start time (for "any practitioner": the first free practitioner). */
export function slotsByDay(slots: readonly Slot[], options: { uniqueTimes?: boolean } = {}): { date: string; slots: Slot[] }[] {
  const days = new Map<string, Slot[]>();
  for (const s of slots) {
    const list = days.get(s.date) ?? [];
    if (options.uniqueTimes && list.some((x) => x.startsAt === s.startsAt)) continue;
    list.push(s);
    days.set(s.date, list);
  }
  return Array.from(days.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, list]) => ({ date, slots: list }));
}

/** The first day to show: never before today (UK) and never after the horizon. */
export function clampStartDate(requested: string | null | undefined, today: string, maxDaysAhead: number): string {
  if (!requested || !/^\d{4}-\d{2}-\d{2}$/.test(requested) || requested < today) return today;
  const last = addDays(today, maxDaysAhead);
  return daysBetween(requested, last) < 0 ? last : requested;
}

/** Earliest slot per practitioner (for "next available" hints). */
export function firstSlotPerPractitioner(slots: readonly Slot[]): Map<string, Slot> {
  const out = new Map<string, Slot>();
  for (const s of slots) if (!out.has(s.practitionerId)) out.set(s.practitionerId, s);
  return out;
}

/** Two hours rows of the same practitioner on the same weekday that overlap in time and in dates. */
export function hoursClash(a: Omit<HoursRule, "siteId">, b: Omit<HoursRule, "siteId">): boolean {
  if (a.practitionerId !== b.practitionerId || a.weekday !== b.weekday) return false;
  if (!overlaps(a.startMinute, a.endMinute, b.startMinute, b.endMinute)) return false;
  const aFrom = a.validFrom ?? "0000-01-01";
  const aTo = a.validTo ?? "9999-12-31";
  const bFrom = b.validFrom ?? "0000-01-01";
  const bTo = b.validTo ?? "9999-12-31";
  return aFrom <= bTo && bFrom <= aTo;
}
