/**
 * The diary's rules: statuses and what may follow what, clashes (practitioner, room, patient), recurring bookings,
 * rotas (when a practitioner works where), free slots and the day grid's layout. Pure – browser-safe; the
 * repositories (src/server/repos/pms/diary) and the screens (src/components/pms/diary) share it.
 *
 * Clash rule (also enforced by the database – migration 0110): two diary items clash when they overlap in time
 * (half-open: 09:00–09:30 and 09:30–10:00 do not) and share a practitioner or a room, and both still occupy the
 * diary. Cancelled and late-cancelled items free their slot; attended and did-not-attend items keep it (history).
 */
import { addDays, isIsoDay, isoWeekday, londonDate, londonParts, londonToUtc, minutesBetween, weeksBetween } from "./time";

export const APPOINTMENT_STATUSES = ["booked", "arrived", "attended", "dna", "late_cancelled", "cancelled"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Statuses that keep their slot (the database's clash triggers use the same list). */
export const OCCUPYING_STATUSES = ["booked", "arrived", "attended", "dna"] as const satisfies readonly AppointmentStatus[];

export function occupiesDiary(status: string): boolean {
  return (OCCUPYING_STATUSES as readonly string[]).includes(status);
}

export function isCancelledStatus(status: string): boolean {
  return status === "cancelled" || status === "late_cancelled";
}

/** An appointment (a patient with a practitioner) or blocked time (leave, a meeting, a room out of use). */
export const DIARY_ITEM_KINDS = ["appointment", "block"] as const;
export type DiaryItemKind = (typeof DIARY_ITEM_KINDS)[number];

export const BLOCK_KINDS = ["leave", "meeting", "training", "admin", "closed", "other"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export const CANCEL_REASONS = ["patient", "clinic", "practitioner_unavailable", "illness", "weather", "other"] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

/** Where a booking came from: reception, the online booking pages, a data import. */
export const APPOINTMENT_SOURCES = ["staff", "online", "import"] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

export const WAITING_PRIORITIES = ["urgent", "soon", "routine"] as const;
export type WaitingPriority = (typeof WAITING_PRIORITIES)[number];

export const WAITING_STATUSES = ["waiting", "offered", "booked", "removed"] as const;
export type WaitingStatus = (typeof WAITING_STATUSES)[number];

export const TIMES_OF_DAY = ["any", "morning", "afternoon", "evening"] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

/** Longest diary item (a block of leave for a whole day). The database checks it; clash checks rely on it. */
export const MAX_ITEM_MINUTES = 1440;
/** Longest appointment. */
export const MAX_APPOINTMENT_MINUTES = 480;
export const MAX_SERIES_OCCURRENCES = 52;
export const MAX_SERIES_INTERVAL_WEEKS = 8;
/** A cancellation less than this many hours before the start is a late cancellation (the clinic may charge a fee). */
export const LATE_CANCELLATION_HOURS = 24;

/* ------------------------------------------------------------------------------------------------
 * Status changes
 * ----------------------------------------------------------------------------------------------*/

const APPOINTMENT_NEXT: Readonly<Record<AppointmentStatus, readonly AppointmentStatus[]>> = {
  booked: ["arrived", "attended", "dna", "cancelled", "late_cancelled"],
  // "booked" from arrived / attended / did not attend = undo a mistaken click.
  arrived: ["booked", "attended", "dna", "cancelled", "late_cancelled"],
  attended: ["arrived", "booked"],
  dna: ["booked", "attended"],
  // Reinstating needs the slot to be free (the clash check runs again).
  late_cancelled: ["booked", "cancelled"],
  cancelled: ["booked", "late_cancelled"],
};

const BLOCK_NEXT: Readonly<Record<AppointmentStatus, readonly AppointmentStatus[]>> = {
  booked: ["cancelled"],
  arrived: [],
  attended: [],
  dna: [],
  late_cancelled: [],
  cancelled: ["booked"],
};

export function canChangeStatus(kind: DiaryItemKind, from: AppointmentStatus, to: AppointmentStatus): boolean {
  if (from === to) return false;
  return (kind === "block" ? BLOCK_NEXT : APPOINTMENT_NEXT)[from].includes(to);
}

export function nextStatuses(kind: DiaryItemKind, from: AppointmentStatus): readonly AppointmentStatus[] {
  return (kind === "block" ? BLOCK_NEXT : APPOINTMENT_NEXT)[from];
}

/** Only items that have not happened yet move (attended / did not attend are history; cancelled ones are reinstated first). */
export function canMove(status: AppointmentStatus): boolean {
  return status === "booked" || status === "arrived";
}

/** Whether cancelling at `at` is late (less than `hours` before the start, or after it). */
export function isLateCancellation(startsAt: string, at: string, hours: number = LATE_CANCELLATION_HOURS): boolean {
  return Date.parse(startsAt) - Date.parse(at) < hours * 3_600_000;
}

/* ------------------------------------------------------------------------------------------------
 * Clashes
 * ----------------------------------------------------------------------------------------------*/

export interface TimeSpan {
  startsAt: string;
  endsAt: string;
}

/** Half-open overlap: [a.start, a.end) ∩ [b.start, b.end) ≠ ∅. */
export function spansOverlap(a: TimeSpan, b: TimeSpan): boolean {
  return Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(a.endsAt) > Date.parse(b.startsAt);
}

export interface ClashCandidate extends TimeSpan {
  /** The item being moved (it never clashes with itself). */
  id?: string | null;
  practitionerId: string | null;
  roomId: string | null;
  /** Checked for appointments: one patient cannot be in two places at once. */
  patientId?: string | null;
}

export interface DiaryItemLike extends ClashCandidate {
  id: string;
  kind: DiaryItemKind;
  status: string;
}

export type ClashResource = "practitioner" | "room" | "patient";

export interface DiaryClash {
  resource: ClashResource;
  /** The item in the way. */
  withId: string;
  withKind: DiaryItemKind;
  startsAt: string;
  endsAt: string;
}

/** Every way `candidate` clashes with the existing items (practitioner, room, the same patient). */
export function findClashes(candidate: ClashCandidate, existing: readonly DiaryItemLike[]): DiaryClash[] {
  const out: DiaryClash[] = [];
  for (const item of existing) {
    if (candidate.id && item.id === candidate.id) continue;
    if (!occupiesDiary(item.status) || !spansOverlap(candidate, item)) continue;
    const base = { withId: item.id, withKind: item.kind, startsAt: item.startsAt, endsAt: item.endsAt };
    if (candidate.practitionerId && item.practitionerId === candidate.practitionerId) out.push({ resource: "practitioner", ...base });
    if (candidate.roomId && item.roomId === candidate.roomId) out.push({ resource: "room", ...base });
    if (candidate.patientId && item.kind === "appointment" && item.patientId === candidate.patientId) out.push({ resource: "patient", ...base });
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Recurring bookings
 * ----------------------------------------------------------------------------------------------*/

/** The dates of a recurring booking: `occurrences` dates, `intervalWeeks` apart, starting on `first`. */
export function recurringDates(first: string, intervalWeeks: number, occurrences: number): string[] {
  if (!isIsoDay(first)) return [];
  const n = Math.max(1, Math.min(MAX_SERIES_OCCURRENCES, Math.floor(occurrences)));
  const step = Math.max(1, Math.min(MAX_SERIES_INTERVAL_WEEKS, Math.floor(intervalWeeks))) * 7;
  return Array.from({ length: n }, (_, i) => addDays(first, i * step));
}

/* ------------------------------------------------------------------------------------------------
 * Rotas (availability)
 * ----------------------------------------------------------------------------------------------*/

export interface RotaRule {
  id?: string;
  practitionerId: string;
  siteId: string;
  roomId: string | null;
  /** ISO weekday 1–7. */
  weekday: number;
  /** Local minutes after midnight. */
  startMinute: number;
  endMinute: number;
  /** 1 = every week, 2 = every other week (counted from the week of validFrom) … */
  everyWeeks: number;
  validFrom: string;
  validTo: string | null;
  active: boolean;
  onlineBookable?: boolean;
}

export interface RotaWindow {
  ruleId: string | null;
  practitionerId: string;
  siteId: string;
  roomId: string | null;
  date: string;
  startMinute: number;
  endMinute: number;
  onlineBookable: boolean;
}

export function ruleAppliesOn(rule: RotaRule, date: string): boolean {
  if (!rule.active || !isIsoDay(date)) return false;
  if (isoWeekday(date) !== rule.weekday) return false;
  if (date < rule.validFrom || (rule.validTo !== null && date > rule.validTo)) return false;
  const weeks = weeksBetween(rule.validFrom, date);
  return weeks >= 0 && weeks % Math.max(1, rule.everyWeeks) === 0;
}

/** The working windows on a date (by practitioner, then start). */
export function windowsOn(date: string, rules: readonly RotaRule[]): RotaWindow[] {
  return rules
    .filter((r) => ruleAppliesOn(r, date))
    .map((r) => ({
      ruleId: r.id ?? null,
      practitionerId: r.practitionerId,
      siteId: r.siteId,
      roomId: r.roomId,
      date,
      startMinute: r.startMinute,
      endMinute: r.endMinute,
      onlineBookable: r.onlineBookable ?? true,
    }))
    .sort((a, b) => (a.practitionerId === b.practitionerId ? a.startMinute - b.startMinute : a.practitionerId < b.practitionerId ? -1 : 1));
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Whether two rota rules of ONE practitioner can ever be in force at the same time: same weekday, overlapping
 * hours, overlapping date ranges and a week in which both repeat.
 */
export function rulesOverlap(a: RotaRule, b: RotaRule): boolean {
  if (!a.active || !b.active || a.weekday !== b.weekday) return false;
  if (!(a.startMinute < b.endMinute && b.startMinute < a.endMinute)) return false;
  const from = a.validFrom > b.validFrom ? a.validFrom : b.validFrom;
  const to = a.validTo === null ? b.validTo : b.validTo === null ? a.validTo : a.validTo < b.validTo ? a.validTo : b.validTo;
  if (to !== null && from > to) return false;
  // Look at the first lcm(everyWeeks) weeks from the later start: if both never fall in the same week there, never.
  const lcm = (a.everyWeeks * b.everyWeeks) / gcd(a.everyWeeks, b.everyWeeks);
  const firstDay = addDays(from, (a.weekday - isoWeekday(from) + 7) % 7);
  for (let w = 0; w < lcm; w++) {
    const date = addDays(firstDay, w * 7);
    if (to !== null && date > to) return false;
    if (ruleAppliesOn(a, date) && ruleAppliesOn(b, date)) return true;
  }
  return false;
}

/** Whether a booking (local minutes on `date`) sits inside one of the practitioner's working windows. */
export function withinWorkingHours(windows: readonly RotaWindow[], practitionerId: string, date: string, startMinute: number, endMinute: number): boolean {
  return windows.some((w) => w.practitionerId === practitionerId && w.date === date && w.startMinute <= startMinute && endMinute <= w.endMinute);
}

/* ------------------------------------------------------------------------------------------------
 * Free slots
 * ----------------------------------------------------------------------------------------------*/

export interface BusySpan extends TimeSpan {
  practitionerId: string | null;
  roomId: string | null;
}

export interface FreeSlot {
  date: string;
  startMinute: number;
  startsAt: string;
  endsAt: string;
  practitionerId: string;
  siteId: string;
  roomId: string | null;
}

export interface FreeSlotQuery {
  windows: readonly RotaWindow[];
  /** Occupying items (appointments and blocks) of the practitioners and rooms concerned. */
  busy: readonly BusySpan[];
  durationMinutes: number;
  /** Default 15. */
  stepMinutes?: number;
  /** No slot starting before this instant (e.g. now). */
  notBefore?: string;
  /** Default 50. */
  limit?: number;
}

/** Free slots inside the working windows, earliest first, at `stepMinutes` boundaries. */
export function freeSlots(q: FreeSlotQuery): FreeSlot[] {
  const step = Math.max(5, Math.floor(q.stepMinutes ?? 15));
  const limit = Math.max(1, Math.min(500, Math.floor(q.limit ?? 50)));
  const duration = Math.floor(q.durationMinutes);
  if (!(duration > 0)) return [];
  const notBefore = q.notBefore ? Date.parse(q.notBefore) : -Infinity;
  const out: FreeSlot[] = [];
  const windows = q.windows.slice().sort((a, b) => (a.date === b.date ? a.startMinute - b.startMinute : a.date < b.date ? -1 : 1));
  for (const w of windows) {
    const first = Math.ceil(w.startMinute / step) * step;
    for (let m = first; m + duration <= w.endMinute; m += step) {
      const start = londonToUtc(w.date, m);
      if (!start.ok) continue;
      if (Date.parse(start.iso) < notBefore) continue;
      const end = new Date(Date.parse(start.iso) + duration * 60_000).toISOString();
      const span = { startsAt: start.iso, endsAt: end };
      const blocked = q.busy.some(
        (b) => spansOverlap(span, b) && ((b.practitionerId !== null && b.practitionerId === w.practitionerId) || (w.roomId !== null && b.roomId === w.roomId)),
      );
      if (blocked) continue;
      out.push({ date: w.date, startMinute: m, startsAt: start.iso, endsAt: end, practitionerId: w.practitionerId, siteId: w.siteId, roomId: w.roomId });
    }
  }
  out.sort((a, b) => (a.startsAt === b.startsAt ? (a.practitionerId < b.practitionerId ? -1 : 1) : a.startsAt < b.startsAt ? -1 : 1));
  return out.slice(0, limit);
}

/* ------------------------------------------------------------------------------------------------
 * Day grid layout
 * ----------------------------------------------------------------------------------------------*/

export interface LayoutItem extends TimeSpan {
  id: string;
}

export interface LayoutBox {
  id: string;
  /** Minutes from the grid's first minute. */
  top: number;
  /** Minutes (at least 10 so short items stay clickable). */
  height: number;
  /** Side-by-side position when items overlap in one column (cancelled ones shown next to their replacement). */
  lane: number;
  lanes: number;
}

/** Local minutes of an item on `date` (clamped to the day). */
export function localSpan(item: TimeSpan, date: string): { start: number; end: number } {
  const startDate = londonDate(item.startsAt);
  const endDate = londonDate(item.endsAt);
  const start = startDate < date ? 0 : startDate > date ? 1440 : londonParts(item.startsAt).minute;
  let end: number;
  if (endDate > date) end = 1440;
  else if (endDate < date) end = 0;
  // Starts and ends on this day: start + duration (on the days the clocks change, a 30-minute appointment across
  // 01:00 is still drawn 30 minutes long).
  else end = startDate === date ? start + Math.max(0, minutesBetween(item.startsAt, item.endsAt)) : londonParts(item.endsAt).minute;
  return { start, end: Math.max(start, Math.min(1440, end)) };
}

/** Boxes for one column of the day grid (items on `date`), with lanes for overlapping items. */
export function layoutColumn(items: readonly LayoutItem[], date: string, gridStart: number, gridEnd: number): LayoutBox[] {
  const spans = items
    .map((item) => ({ item, ...localSpan(item, date) }))
    .filter((s) => s.end > gridStart && s.start < gridEnd)
    .sort((a, b) => a.start - b.start || b.end - a.end || (a.item.id < b.item.id ? -1 : 1));
  const boxes: LayoutBox[] = [];
  let cluster: { box: LayoutBox; end: number }[] = [];
  let clusterEnd = -1;
  const closeCluster = () => {
    const lanes = cluster.reduce((n, c) => Math.max(n, c.box.lane + 1), 1);
    for (const c of cluster) c.box.lanes = lanes;
    cluster = [];
  };
  for (const s of spans) {
    if (s.start >= clusterEnd) closeCluster();
    const taken = new Set(cluster.filter((c) => c.end > s.start).map((c) => c.box.lane));
    let lane = 0;
    while (taken.has(lane)) lane++;
    const top = Math.max(s.start, gridStart) - gridStart;
    const bottom = Math.min(s.end, gridEnd) - gridStart;
    const box: LayoutBox = { id: s.item.id, top, height: Math.max(10, bottom - top), lane, lanes: 1 };
    boxes.push(box);
    cluster.push({ box, end: s.end });
    clusterEnd = Math.max(clusterEnd, s.end);
  }
  closeCluster();
  return boxes;
}

/** The hours the grid shows: the working windows and items of the day, at least `min`, whole hours. */
export function gridHours(windows: readonly { startMinute: number; endMinute: number }[], items: readonly { start: number; end: number }[], min = { start: 8 * 60, end: 18 * 60 }): { start: number; end: number } {
  let start = min.start;
  let end = min.end;
  for (const w of windows) {
    start = Math.min(start, w.startMinute);
    end = Math.max(end, w.endMinute);
  }
  for (const i of items) {
    start = Math.min(start, i.start);
    end = Math.max(end, i.end);
  }
  return { start: Math.max(0, Math.floor(start / 60) * 60), end: Math.min(1440, Math.ceil(end / 60) * 60) };
}

/** Morning before 12:00, afternoon 12:00–17:00, evening from 17:00. */
export function timeOfDay(minute: number): Exclude<TimeOfDay, "any"> {
  return minute < 720 ? "morning" : minute < 1020 ? "afternoon" : "evening";
}
