/**
 * The figures the reports show, computed from facts (pure, browser-safe, tested in reporting.test.ts).
 *
 * Definitions (shown to clinics on each report – copy.ts):
 * - Attendance: "due" appointments = attended + did not attend + late cancellations (appointments cancelled in
 *   good time freed their slot and are left out). DNA rate = DNA / due; late-cancellation rate = late / due.
 *   Past appointments still marked "booked" are "not recorded" and left out of the rates (shown separately).
 * - Utilisation = booked minutes / available minutes. Booked = every appointment that held its slot (upcoming,
 *   not recorded, attended, DNA, late cancellation). Available: a site's or room's opening hours less closures
 *   (a site counts each of its rooms), a practitioner's working time from the diary's rota. None = no rate.
 * - New patients: first attended appointment ever falls in the period; returning: attended in the period and
 *   seen before. By cases: a patient whose first case opened in the period is new, else returning.
 * - Revenue: invoiced (issued, not void) and credited in the period by issue date; received by payment date.
 * - Outstanding: invoice total − paid − credited, aged from the due date (or the issue date).
 */
import { authorisationView, type AuthorisationLike, type AuthorisationView } from "../core/authorisations";
import type { PayerType } from "../core/types";
import type { AppointmentFact, AppointmentOutcome, AvailabilityFact, DebtFact, RevenueFact, RevenueKind } from "./facts";
import { addDays, dayNumber, eachDay, isoWeekday, weekStart, type ReportPeriod } from "./periods";
import { timeToMinutes } from "./schemas";

/* ------------------------------------------------------------------------------------------------
 * Small helpers
 * ----------------------------------------------------------------------------------------------*/

/** A share (0–1), or null when there is nothing to divide by. */
export function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

/** 0.0625 → "6.3%"; null → "–" (no data). */
export function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  return `${(value * 100).toFixed(1)}%`;
}

/** Hours and minutes from minutes: 95 → "1 h 35 min", 60 → "1 h", 20 → "20 min". */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest} min`;
  return rest === 0 ? `${h.toLocaleString("en-GB")} h` : `${h.toLocaleString("en-GB")} h ${rest} min`;
}

/** Width of a bar as a percentage of the largest value (0–100; small values stay visible). */
export function barPercent(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0;
  return Math.max(1, Math.min(100, (value / max) * 100));
}

/** The period of the same length just before `period` (the comparison on the dashboard). */
export function previousPeriod(period: Pick<ReportPeriod, "from" | "to" | "days">): { from: string; to: string; days: number } {
  return { from: addDays(period.from, -period.days), to: addDays(period.from, -1), days: period.days };
}

function bump<K>(map: Map<K, number>, key: K, by: number): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function groupBy<T>(items: readonly T[], key: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    const list = groups.get(k);
    if (list) list.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

/* ------------------------------------------------------------------------------------------------
 * Attendance
 * ----------------------------------------------------------------------------------------------*/

export interface AttendanceFigures {
  /** Every appointment in the period, whatever became of it. */
  total: number;
  attended: number;
  dna: number;
  lateCancel: number;
  cancelled: number;
  upcoming: number;
  unrecorded: number;
  /** attended + dna + lateCancel */
  due: number;
  dnaRate: number | null;
  lateCancelRate: number | null;
  attendedRate: number | null;
}

export function attendanceOf(facts: readonly AppointmentFact[]): AttendanceFigures {
  const counts: Record<AppointmentOutcome, number> = { upcoming: 0, unrecorded: 0, attended: 0, dna: 0, late_cancel: 0, cancelled: 0 };
  let total = 0;
  for (const f of facts) {
    const n = Math.max(0, f.appointments);
    counts[f.outcome] += n;
    total += n;
  }
  const due = counts.attended + counts.dna + counts.late_cancel;
  return {
    total,
    attended: counts.attended,
    dna: counts.dna,
    lateCancel: counts.late_cancel,
    cancelled: counts.cancelled,
    upcoming: counts.upcoming,
    unrecorded: counts.unrecorded,
    due,
    dnaRate: ratio(counts.dna, due),
    lateCancelRate: ratio(counts.late_cancel, due),
    attendedRate: ratio(counts.attended, due),
  };
}

export type AttendanceRow = AttendanceFigures & { key: string };

/** Attendance grouped by a key (practitioner, site, month…), biggest first. Facts with a null key are left out. */
export function attendanceBy(facts: readonly AppointmentFact[], key: (f: AppointmentFact) => string | null): AttendanceRow[] {
  return Array.from(groupBy(facts, key).entries())
    .map(([k, list]) => ({ key: k, ...attendanceOf(list) }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

/* ------------------------------------------------------------------------------------------------
 * Opening hours, closures and available time
 * ----------------------------------------------------------------------------------------------*/

export interface OpeningSessionLike {
  siteId: string;
  weekday: number;
  opensAt: string;
  closesAt: string;
}

export interface ClosureLike {
  /** null = every site. */
  siteId: string | null;
  startsOn: string;
  endsOn: string;
}

/** Open minutes of each weekday (index 1–7) of one site. */
export function weeklyOpenMinutes(sessions: readonly OpeningSessionLike[], siteId: string): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const s of sessions) {
    if (s.siteId !== siteId || s.weekday < 1 || s.weekday > 7) continue;
    out[s.weekday] += Math.max(0, timeToMinutes(s.closesAt) - timeToMinutes(s.opensAt));
  }
  return out;
}

export function isClosed(closures: readonly ClosureLike[], siteId: string, date: string): boolean {
  return closures.some((c) => (c.siteId === null || c.siteId === siteId) && c.startsOn <= date && date <= c.endsOn);
}

/** A site's open minutes on each day of a period (closures count as 0). */
export function openMinutesByDay(sessions: readonly OpeningSessionLike[], closures: readonly ClosureLike[], siteId: string, from: string, to: string): Map<string, number> {
  const week = weeklyOpenMinutes(sessions, siteId);
  const out = new Map<string, number>();
  for (const date of eachDay(from, to)) out.set(date, isClosed(closures, siteId, date) ? 0 : week[isoWeekday(date)]);
  return out;
}

/** A site's open minutes in a period. */
export function openMinutes(sessions: readonly OpeningSessionLike[], closures: readonly ClosureLike[], siteId: string, from: string, to: string): number {
  let total = 0;
  openMinutesByDay(sessions, closures, siteId, from, to).forEach((m) => {
    total += m;
  });
  return total;
}

/* ------------------------------------------------------------------------------------------------
 * Utilisation
 * ----------------------------------------------------------------------------------------------*/

/** Outcomes that held the slot (a DNA or a late cancellation still used the practitioner's time). */
export function heldSlot(outcome: AppointmentOutcome): boolean {
  return outcome !== "cancelled";
}

export interface UtilisationRow {
  key: string;
  /** Minutes of appointments that held their slot. */
  bookedMinutes: number;
  attendedMinutes: number;
  appointments: number;
  /** null = no available time recorded. */
  availableMinutes: number | null;
  utilisation: number | null;
}

function utilRows(booked: Map<string, number>, attended: Map<string, number>, count: Map<string, number>, available: Map<string, number | null>, keys: Iterable<string>): UtilisationRow[] {
  const all = new Set<string>(Array.from(keys).concat(Array.from(booked.keys())));
  return Array.from(all)
    .map((key) => {
      const bookedMinutes = booked.get(key) ?? 0;
      const availableMinutes = available.get(key) ?? null;
      return {
        key,
        bookedMinutes,
        attendedMinutes: attended.get(key) ?? 0,
        appointments: count.get(key) ?? 0,
        availableMinutes,
        utilisation: availableMinutes === null ? null : ratio(bookedMinutes, availableMinutes),
      };
    })
    .sort((a, b) => (b.utilisation ?? -1) - (a.utilisation ?? -1) || b.bookedMinutes - a.bookedMinutes || a.key.localeCompare(b.key));
}

function tally(facts: readonly AppointmentFact[], key: (f: AppointmentFact) => string | null) {
  const booked = new Map<string, number>();
  const attended = new Map<string, number>();
  const count = new Map<string, number>();
  for (const f of facts) {
    if (!heldSlot(f.outcome)) continue;
    const k = key(f);
    if (k === null) continue;
    bump(booked, k, Math.max(0, f.minutes));
    bump(count, k, Math.max(0, f.appointments));
    if (f.outcome === "attended") bump(attended, k, Math.max(0, f.minutes));
  }
  return { booked, attended, count };
}

export interface RoomLike {
  id: string;
  siteId: string;
}

/** By site: available = open minutes × the site's rooms (at least 1). */
export function utilisationBySite(
  facts: readonly AppointmentFact[],
  sites: readonly { id: string }[],
  rooms: readonly RoomLike[],
  sessions: readonly OpeningSessionLike[],
  closures: readonly ClosureLike[],
  period: Pick<ReportPeriod, "from" | "to">,
): UtilisationRow[] {
  const { booked, attended, count } = tally(facts, (f) => f.siteId);
  const available = new Map<string, number | null>();
  for (const s of sites) {
    const open = openMinutes(sessions, closures, s.id, period.from, period.to);
    const roomCount = Math.max(1, rooms.filter((r) => r.siteId === s.id).length);
    available.set(s.id, open > 0 ? open * roomCount : null);
  }
  return utilRows(booked, attended, count, available, sites.map((s) => s.id));
}

/** By room: available = the room's site's open minutes. */
export function utilisationByRoom(
  facts: readonly AppointmentFact[],
  rooms: readonly RoomLike[],
  sessions: readonly OpeningSessionLike[],
  closures: readonly ClosureLike[],
  period: Pick<ReportPeriod, "from" | "to">,
): UtilisationRow[] {
  const { booked, attended, count } = tally(facts, (f) => f.roomId);
  const perSite = new Map<string, number>();
  const available = new Map<string, number | null>();
  for (const r of rooms) {
    if (!perSite.has(r.siteId)) perSite.set(r.siteId, openMinutes(sessions, closures, r.siteId, period.from, period.to));
    const open = perSite.get(r.siteId) ?? 0;
    available.set(r.id, open > 0 ? open : null);
  }
  return utilRows(booked, attended, count, available, rooms.map((r) => r.id));
}

/** By practitioner: available = their working time from the diary's rota (none recorded = no rate). */
export function utilisationByPractitioner(facts: readonly AppointmentFact[], practitioners: readonly { id: string }[], availability: readonly AvailabilityFact[]): UtilisationRow[] {
  const { booked, attended, count } = tally(facts, (f) => f.practitionerId);
  const sums = new Map<string, number>();
  for (const a of availability) bump(sums, a.practitionerId, Math.max(0, a.minutes));
  const available = new Map<string, number | null>();
  for (const p of practitioners) {
    const m = sums.get(p.id) ?? 0;
    available.set(p.id, m > 0 ? m : null);
  }
  return utilRows(booked, attended, count, available, practitioners.map((p) => p.id));
}

/** One figure for the whole selection (the dashboard tile): rows without available time are left out. */
export function totalUtilisation(rows: readonly UtilisationRow[]): { bookedMinutes: number; availableMinutes: number; utilisation: number | null } {
  let booked = 0;
  let available = 0;
  for (const r of rows) {
    if (r.availableMinutes === null) continue;
    booked += r.bookedMinutes;
    available += r.availableMinutes;
  }
  return { bookedMinutes: booked, availableMinutes: available, utilisation: ratio(booked, available) };
}

/* ------------------------------------------------------------------------------------------------
 * New and returning patients
 * ----------------------------------------------------------------------------------------------*/

export interface PatientMix {
  /** Patients seen (or with a case opened) in the period. */
  patients: number;
  newPatients: number;
  returning: number;
  newShare: number | null;
}

export function patientMix(patients: number, newPatients: number): PatientMix {
  const p = Math.max(0, patients);
  const fresh = Math.min(p, Math.max(0, newPatients));
  return { patients: p, newPatients: fresh, returning: p - fresh, newShare: ratio(fresh, p) };
}

/** From each patient's first visit (or first case) date: new when it falls in the period. For adapters and tests. */
export function patientMixFromFirstDates(rows: readonly { patientId: string; firstOn: string }[], period: Pick<ReportPeriod, "from" | "to">): PatientMix {
  const first = new Map<string, string>();
  for (const r of rows) {
    const prev = first.get(r.patientId);
    if (!prev || r.firstOn < prev) first.set(r.patientId, r.firstOn);
  }
  let fresh = 0;
  first.forEach((d) => {
    if (d >= period.from && d <= period.to) fresh += 1;
  });
  return patientMix(first.size, fresh);
}

/* ------------------------------------------------------------------------------------------------
 * Revenue and debt
 * ----------------------------------------------------------------------------------------------*/

export interface RevenueFigures {
  invoicedPence: number;
  creditedPence: number;
  netPence: number;
  receivedPence: number;
  invoices: number;
}

export function revenueOf(facts: readonly RevenueFact[]): RevenueFigures {
  const sum: Record<RevenueKind, number> = { invoiced: 0, credited: 0, received: 0 };
  let invoices = 0;
  for (const f of facts) {
    sum[f.kind] += f.amountPence;
    if (f.kind === "invoiced") invoices += Math.max(0, f.count);
  }
  return { invoicedPence: sum.invoiced, creditedPence: sum.credited, netPence: sum.invoiced - sum.credited, receivedPence: sum.received, invoices };
}

export type RevenueRow = RevenueFigures & { key: string };

/** Revenue grouped by a key (month, site, practitioner, payer type), biggest net first. */
export function revenueBy(facts: readonly RevenueFact[], key: (f: RevenueFact) => string | null): RevenueRow[] {
  return Array.from(groupBy(facts, key).entries())
    .map(([k, list]) => ({ key: k, ...revenueOf(list) }))
    .sort((a, b) => b.netPence - a.netPence || a.key.localeCompare(b.key));
}

export const DEBT_BUCKETS = ["not_due", "d0_30", "d31_60", "d61_90", "d91_plus"] as const;
export type DebtBucket = (typeof DEBT_BUCKETS)[number];

/**
 * Which age bucket an amount due on `dueOn` is in on `today` (days overdue) – the same bands as billing's aged debt
 * (src/modules/pms/billing/aging.ts): due today or later = not yet due, then 1–30, 31–60, 61–90, over 90 days.
 */
export function debtBucket(dueOn: string, today: string): DebtBucket {
  const overdue = dayNumber(today) - dayNumber(dueOn);
  if (overdue <= 0) return "not_due";
  if (overdue <= 30) return "d0_30";
  if (overdue <= 60) return "d31_60";
  if (overdue <= 90) return "d61_90";
  return "d91_plus";
}

export interface DebtRow {
  /** The payer account's id; "self_pay" for patients paying themselves; "<type>:unassigned" without an account. */
  key: string;
  payerType: PayerType;
  payerReferrerId: string | null;
  invoices: number;
  outstandingPence: number;
  buckets: Record<DebtBucket, number>;
  oldestDueOn: string | null;
}

function emptyBuckets(): Record<DebtBucket, number> {
  return { not_due: 0, d0_30: 0, d31_60: 0, d61_90: 0, d91_plus: 0 };
}

export function debtKey(f: Pick<DebtFact, "payerType" | "payerReferrerId">): string {
  if (f.payerReferrerId) return f.payerReferrerId;
  return f.payerType === "self_pay" ? "self_pay" : `${f.payerType}:unassigned`;
}

/** Aged debt by payer (accounts by id, self-pay patients together), most owed first, and the total. */
export function agedDebt(facts: readonly DebtFact[], today: string): { rows: DebtRow[]; total: DebtRow } {
  const rows = new Map<string, DebtRow>();
  const total: DebtRow = { key: "total", payerType: "other", payerReferrerId: null, invoices: 0, outstandingPence: 0, buckets: emptyBuckets(), oldestDueOn: null };
  for (const f of facts) {
    if (!(f.outstandingPence > 0)) continue;
    const key = debtKey(f);
    let row = rows.get(key);
    if (!row) rows.set(key, (row = { key, payerType: f.payerType, payerReferrerId: f.payerReferrerId, invoices: 0, outstandingPence: 0, buckets: emptyBuckets(), oldestDueOn: null }));
    const bucket = debtBucket(f.dueOn, today);
    for (const r of [row, total]) {
      r.invoices += Math.max(0, f.invoices);
      r.outstandingPence += f.outstandingPence;
      r.buckets[bucket] += f.outstandingPence;
      if (!r.oldestDueOn || f.dueOn < r.oldestDueOn) r.oldestDueOn = f.dueOn;
    }
  }
  return { rows: Array.from(rows.values()).sort((a, b) => b.outstandingPence - a.outstandingPence || a.key.localeCompare(b.key)), total };
}

/** Owed more than `days` days past the due date (the dashboard's "overdue" figure). */
export function overduePence(row: Pick<DebtRow, "buckets">, over: 30 | 60 | 90 = 30): number {
  const b = row.buckets;
  if (over === 90) return b.d91_plus;
  if (over === 60) return b.d61_90 + b.d91_plus;
  return b.d31_60 + b.d61_90 + b.d91_plus;
}

/* ------------------------------------------------------------------------------------------------
 * Treatment authorisations
 * ----------------------------------------------------------------------------------------------*/

export type AuthorisationReason = "expires_soon" | "expired_recently" | "few_sessions_left" | "little_value_left" | "used_up";

export interface AuthorisationAlert<T extends AuthorisationLike> {
  authorisation: T;
  view: AuthorisationView;
  reasons: AuthorisationReason[];
}

/**
 * Authorisations that need someone's attention by `today`: expiring within `days`, expired in the last 30 days
 * while still marked active, used up, or nearly used up. Cancelled ones never appear. Soonest expiry first.
 */
export function authorisationAlerts<T extends AuthorisationLike>(list: readonly T[], today: string, days: number): AuthorisationAlert<T>[] {
  const out: AuthorisationAlert<T>[] = [];
  for (const a of list) {
    if (a.status === "cancelled") continue;
    const view = authorisationView(a, today);
    const reasons: AuthorisationReason[] = [];
    if (view.daysToExpiry !== null && view.daysToExpiry >= 0 && view.daysToExpiry <= days && view.state !== "exhausted") reasons.push("expires_soon");
    if (view.state === "expired" && view.daysToExpiry !== null && view.daysToExpiry >= -30) reasons.push("expired_recently");
    if (view.state === "exhausted") reasons.push("used_up");
    if (view.warnings.includes("few_sessions_left")) reasons.push("few_sessions_left");
    if (view.warnings.includes("little_value_left")) reasons.push("little_value_left");
    if (reasons.length) out.push({ authorisation: a, view, reasons });
  }
  return out.sort((x, y) => (x.view.daysToExpiry ?? 99_999) - (y.view.daysToExpiry ?? 99_999));
}

/* ------------------------------------------------------------------------------------------------
 * Series by week
 * ----------------------------------------------------------------------------------------------*/

/** Attendance per week (Mondays from weeksOf), with an empty row for a week without appointments. */
export function attendanceByWeek(facts: readonly AppointmentFact[], weeks: readonly string[]): AttendanceRow[] {
  const rows = attendanceBy(
    facts.filter((f) => f.date !== undefined),
    (f) => weekStart(f.date as string),
  );
  return weeks.map((w) => rows.find((r) => r.key === w) ?? { key: w, ...attendanceOf([]) });
}

/* ------------------------------------------------------------------------------------------------
 * Series by month
 * ----------------------------------------------------------------------------------------------*/

/** The months of a period in order, with 0 where there is no value. */
export function monthSeries(values: ReadonlyMap<string, number>, months: readonly string[]): { month: string; value: number }[] {
  return months.map((month) => ({ month, value: values.get(month) ?? 0 }));
}
