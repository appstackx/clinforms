/**
 * The diary's rules: statuses and what may follow what, clashes (practitioner, room, patient), recurring bookings,
 * rotas (when a practitioner works where), free slots and the day grid's layout. Pure – browser-safe; the
 * repositories (src/server/repos/pms/diary) and the screens (src/components/pms/diary) share it.
 *
 * Clash rule (also enforced by the database – migration 0110): two diary items clash when they overlap in time
 * (half-open: 09:00–09:30 and 09:30–10:00 do not) and share a practitioner or a room, and both still occupy the
 * diary. Cancelled and late-cancelled items free their slot; attended and did-not-attend items keep it (history).
 *
 * Double-booking (Khuram's decision A, 28/10/2026): a PRACTITIONER may be double-booked – two appointments at once –
 * by a member holding "diary.override", explicitly per booking or move ("Book anyway (double-booking is logged)"),
 * audited with the clashing appointment; both appointments then show a clash marker. Blocked time (leave, a meeting)
 * is never booked over. ROOMS stay strict: never two items in one room at once, with or without the override.
 *
 * Statuses (Khuram's decision B, 28/10/2026): booked → arrived → in_treatment → attended; "Start treatment" sets
 * in_treatment, undo goes back to arrived. On screen "attended" reads "Completed" (copy.ts). The database stores
 * in_treatment as status 'arrived' with treatment_started_at set (migration 0117 – SQLite/D1 cannot widen a CHECK
 * without rebuilding the table, which D1 refuses while other tables point at it); the repositories map it both
 * ways (storedStatus / statusOfRow), so every reader outside the diary that reads the raw column sees "arrived" –
 * exactly how billing and reports must treat it (not billable until attended).
 */
import { addDays, isIsoDay, isoWeekday, londonDate, londonParts, londonToUtc, minutesBetween, weeksBetween } from "./time";

export const APPOINTMENT_STATUSES = ["booked", "arrived", "in_treatment", "attended", "dna", "late_cancelled", "cancelled"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** What the status column holds (in_treatment is stored as "arrived" + treatment_started_at – see the top). */
export type StoredAppointmentStatus = Exclude<AppointmentStatus, "in_treatment">;

/** Stored statuses that keep their slot (the database's clash triggers use the same list). */
export const OCCUPYING_STATUSES = ["booked", "arrived", "attended", "dna"] as const satisfies readonly StoredAppointmentStatus[];

export function occupiesDiary(status: string): boolean {
  return status === "in_treatment" || (OCCUPYING_STATUSES as readonly string[]).includes(status);
}

/** The status column's value for a status. */
export function storedStatus(status: AppointmentStatus): StoredAppointmentStatus {
  return status === "in_treatment" ? "arrived" : status;
}

/** A row's status: the column, plus "in treatment" when an arrived appointment's treatment has started. */
export function statusOfRow(status: string, treatmentStartedAt: string | null | undefined): AppointmentStatus {
  return status === "arrived" && treatmentStartedAt ? "in_treatment" : (status as AppointmentStatus);
}

/**
 * Statuses an invoice may charge for (billing's visit source): attended, did not attend, late cancellation. Booked,
 * arrived and in treatment are NOT billable – the visit is not over until it is attended ("Completed").
 */
export const CHARGEABLE_STATUSES = ["attended", "dna", "late_cancelled"] as const satisfies readonly AppointmentStatus[];

export function isChargeableStatus(status: string): boolean {
  return (CHARGEABLE_STATUSES as readonly string[]).includes(status);
}

/** How reports count a status: in treatment counts as arrived (seen but not yet recorded as attended). */
export function reportingStatus(status: AppointmentStatus): StoredAppointmentStatus {
  return storedStatus(status);
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

/** A slot offered to a waiting patient: open until booked (accepted), declined or withdrawn. */
export const OFFER_STATUSES = ["open", "accepted", "declined", "withdrawn"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

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
  arrived: ["booked", "in_treatment", "attended", "dna", "cancelled", "late_cancelled"],
  // Start treatment → in treatment; undo goes back to arrived; completing it is "attended".
  in_treatment: ["arrived", "attended"],
  attended: ["in_treatment", "arrived", "booked"],
  dna: ["booked", "attended"],
  // Reinstating needs the slot to be free (the clash check runs again).
  late_cancelled: ["booked", "cancelled"],
  cancelled: ["booked", "late_cancelled"],
};

const BLOCK_NEXT: Readonly<Record<AppointmentStatus, readonly AppointmentStatus[]>> = {
  booked: ["cancelled"],
  arrived: [],
  in_treatment: [],
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

/**
 * Statuses that say the patient was SEEN (arrived, in treatment, completed) are refused for an appointment that
 * starts more than SEEN_EARLY_MINUTES from now – early arrivals are normal, marking tomorrow's patient "arrived"
 * the night before is a mistake (handover §13.4 item 2). "Did not attend" is refused before the start time
 * (it would put a fee on a visit that has not happened). Undo and cancelling are never time-limited.
 */
export const SEEN_EARLY_MINUTES = 60;

export function statusAllowedAt(to: AppointmentStatus, startsAt: string, now: Date | number | string): boolean {
  const start = Date.parse(startsAt);
  const at = typeof now === "number" ? now : typeof now === "string" ? Date.parse(now) : now.getTime();
  if (to === "arrived" || to === "in_treatment" || to === "attended") return start - at <= SEEN_EARLY_MINUTES * 60_000;
  if (to === "dna") return start <= at;
  return true;
}

/** The plain refusal for statusAllowedAt (shown next to the action). */
export function futureStatusMessage(to: AppointmentStatus): string {
  return to === "dna" ? "This appointment has not started yet, so it cannot be marked as did not attend." : `This appointment starts more than ${SEEN_EARLY_MINUTES} minutes from now, so the patient cannot be marked as seen yet.`;
}

/** nextStatuses, less those the time of day does not allow yet. */
export function nextStatusesAt(kind: DiaryItemKind, from: AppointmentStatus, startsAt: string, now: Date | number | string): readonly AppointmentStatus[] {
  const next = nextStatuses(kind, from);
  // Only forward moves from booked/arrived are time-limited; an undo (back to arrived/booked) never is.
  if (kind === "block" || (from !== "booked" && from !== "arrived" && from !== "dna")) return next;
  return next.filter((to) => (to === "booked" || to === "cancelled" || to === "late_cancelled" ? true : statusAllowedAt(to, startsAt, now)));
}

/**
 * Only items that have not happened yet move (in treatment, attended and did not attend are under way or history;
 * cancelled ones are reinstated first).
 */
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

/**
 * What can be in the way of a booking: an appointment, blocked time, or a HOLD – a slot offered to a waiting
 * patient and held for them until the offer is answered or expires (M9b). A hold is never overridable.
 */
export type ClashWithKind = DiaryItemKind | "hold";

export interface DiaryItemLike extends ClashCandidate {
  id: string;
  kind: ClashWithKind;
  status: string;
}

export type ClashResource = "practitioner" | "room" | "patient";

export interface DiaryClash {
  resource: ClashResource;
  /** The item in the way. */
  withId: string;
  withKind: ClashWithKind;
  startsAt: string;
  endsAt: string;
}

/**
 * Whether a member holding "diary.override" may book over this clash: the practitioner's other APPOINTMENT
 * (double-booking, logged) or the patient's own other appointment (two practitioners seeing them together). Room
 * clashes and blocked time never are.
 */
export function isOverridableClash(c: Pick<DiaryClash, "resource" | "withKind">): boolean {
  return c.resource === "patient" || (c.resource === "practitioner" && c.withKind === "appointment");
}

/** The practitioner double-bookings among clashes (what an override would log). */
export function practitionerOverbookings<T extends Pick<DiaryClash, "resource" | "withKind" | "withId">>(clashes: readonly T[]): T[] {
  return clashes.filter((c) => c.resource === "practitioner" && c.withKind === "appointment");
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

/* ------------------------------------------------------------------------------------------------
 * Waiting list: which free slots suit an entry
 * ----------------------------------------------------------------------------------------------*/

export interface WaitingPreferences {
  /** ISO weekdays (none = any day). */
  preferredDays: readonly number[];
  preferredTime: TimeOfDay;
  earliestOn: string | null;
  latestOn: string | null;
}

/** Whether a free slot (UK date, local start minute) suits the patient's preferred days, time of day and dates. */
export function slotSuits(slot: { date: string; startMinute: number }, prefs: WaitingPreferences): boolean {
  if (prefs.earliestOn && slot.date < prefs.earliestOn) return false;
  if (prefs.latestOn && slot.date > prefs.latestOn) return false;
  if (prefs.preferredDays.length > 0 && !prefs.preferredDays.includes(isoWeekday(slot.date))) return false;
  return prefs.preferredTime === "any" || timeOfDay(slot.startMinute) === prefs.preferredTime;
}
