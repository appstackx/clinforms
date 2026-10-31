/**
 * Free slots: the working windows of the rota minus everything that occupies the practitioner or the window's
 * room and the slots held for waiting patients. Used by "next free slot" in the diary and, through the same function, by online booking (portal module).
 */
import { OCCUPYING_STATUSES, freeSlots, slotSuits, spansOverlap, type BusySpan, type FreeSlot, type WaitingPreferences } from "../../../../modules/pms/diary/rules";
import { addDays, londonRange } from "../../../../modules/pms/diary/time";
import { RepoInputError, assertTenantId, nowIso, type DbContext } from "../context";
import { listOccupiedSpans } from "./appointments";
import { APPOINTMENTS, heldSlots } from "./shared";
import { availabilityWindows } from "./availability";
import { loadServiceRef } from "./shared";

export interface FreeSlotSearch {
  /** First UK date to look at ("YYYY-MM-DD"). */
  fromDate: string;
  /** Days to look at (1–28, default 14). */
  days?: number;
  siteId?: string;
  /** Only windows at these sites (a member limited to some sites). */
  siteIds?: readonly string[];
  /** Only these practitioners (default: everyone with a rota at the site). */
  practitionerIds?: readonly string[];
  /** The appointment type (its length) – or durationMinutes. */
  serviceId?: string;
  durationMinutes?: number;
  /** Only windows marked for online booking. */
  onlineOnly?: boolean;
  /** Default 15. */
  stepMinutes?: number;
  /** Default: now (no slot in the past). */
  notBefore?: string;
  /** Default 20, at most 200. */
  limit?: number;
  /** Only slots that suit a waiting patient's preferred days, time of day and dates. */
  preferences?: WaitingPreferences;
  /** Leave out times this patient already has an appointment (at any site). */
  patientId?: string;
}

export async function findFreeSlots(ctx: DbContext, tenantId: string, q: FreeSlotSearch): Promise<FreeSlot[]> {
  assertTenantId(tenantId);
  const days = Math.min(28, Math.max(1, Math.floor(q.days ?? 14)));
  const duration = q.durationMinutes ?? (q.serviceId ? (await loadServiceRef(ctx, tenantId, q.serviceId)).durationMinutes : null);
  if (!duration) throw new RepoInputError("Choose an appointment type or a length.");
  const dates = Array.from({ length: days }, (_, i) => addDays(q.fromDate, i));
  let windows = await availabilityWindows(ctx, tenantId, dates, { siteId: q.siteId, practitionerIds: q.practitionerIds });
  if (q.onlineOnly) windows = windows.filter((w) => w.onlineBookable);
  if (q.siteIds) {
    const allowed = new Set(q.siteIds);
    windows = windows.filter((w) => allowed.has(w.siteId));
  }
  const prefs = q.preferences;
  if (prefs) windows = windows.filter((w) => slotSuits({ date: w.date, startMinute: w.startMinute }, { ...prefs, preferredTime: "any" }));
  if (windows.length === 0) return [];
  const practitionerIds = Array.from(new Set(windows.map((w) => w.practitionerId)));
  const roomIds = Array.from(new Set(windows.map((w) => w.roomId).filter((r): r is string => r !== null)));
  const range = londonRange(dates[0], dates.length);
  const limit = Math.min(200, q.limit ?? 20);
  let patientBusy: { startsAt: string; endsAt: string }[] = [];
  if (q.patientId) {
    patientBusy = await ctx.db
      .selectFrom(APPOINTMENTS)
      .select(["starts_at as startsAt", "ends_at as endsAt"])
      .where("tenant_id", "=", tenantId)
      .where("patient_id", "=", q.patientId)
      .where("status", "in", OCCUPYING_STATUSES as unknown as string[])
      .where("starts_at", "<", range.to)
      .where("ends_at", ">", range.from)
      .limit(500)
      .execute();
  }
  const filtered = prefs || patientBusy.length > 0;
  const wanted = filtered ? 500 : limit;
  // Slots held for a waiting patient (an open offer, until it is answered or its hold ends) are not free – except
  // to the patient they are held for. Read by practitioners and by rooms separately (D1: 100 parameters).
  const held: BusySpan[] = [];
  const holdQueries: { practitionerIds: string[]; roomIds: string[] }[] = [];
  for (let i = 0; i < practitionerIds.length; i += 80) holdQueries.push({ practitionerIds: practitionerIds.slice(i, i + 80), roomIds: [] });
  for (let i = 0; i < roomIds.length; i += 80) holdQueries.push({ practitionerIds: [], roomIds: roomIds.slice(i, i + 80) });
  for (const hq of holdQueries) {
    for (const h of await heldSlots(ctx, tenantId, { from: range.from, to: range.to, ...hq, exceptPatientId: q.patientId ?? null })) {
      held.push({ practitionerId: h.practitionerId, roomId: h.roomId, startsAt: h.startsAt, endsAt: h.endsAt });
    }
  }
  // The time the practitioners and rooms are taken (any site: a practitioner booked elsewhere is busy), a week of
  // the range at a time: the busy columns only, every item of the week (no cap per day – a busy day still offers
  // its free time). Later weeks are read only while the earliest slots are not yet found (slots come date by
  // date, so a later week can never offer an earlier slot).
  const slots: FreeSlot[] = [];
  const windowDates = Array.from(new Set(windows.map((w) => w.date))).sort();
  for (let i = 0; i < windowDates.length && slots.length < wanted; ) {
    const weekStart = windowDates[i];
    const weekEnd = addDays(weekStart, 7);
    const week = windows.filter((w) => w.date >= weekStart && w.date < weekEnd);
    while (i < windowDates.length && windowDates[i] < weekEnd) i++;
    const span = londonRange(weekStart, 7);
    const read = await listOccupiedSpans(ctx, tenantId, { from: span.from, to: span.to, practitionerIds, roomIds });
    // Past the read's cap (never on a real clinic), only the dates read in full are offered.
    const usable = read.complete ? week : week.filter((w) => read.readUntil !== null && Date.parse(londonRange(w.date, 1).to) <= Date.parse(read.readUntil));
    const busy: BusySpan[] = [...held, ...read.spans.map((b) => ({ practitionerId: b.practitionerId, roomId: b.roomId, startsAt: b.startsAt, endsAt: b.endsAt }))];
    slots.push(...freeSlots({ windows: usable, busy, durationMinutes: duration, stepMinutes: q.stepMinutes, notBefore: q.notBefore ?? nowIso(ctx), limit: wanted - slots.length }));
    if (!read.complete) break;
  }
  if (!filtered) return slots;
  return slots.filter((s) => (!prefs || slotSuits(s, prefs)) && !patientBusy.some((b) => spansOverlap(s, b))).slice(0, limit);
}
