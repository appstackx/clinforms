/**
 * Free slots: the working windows of the rota minus everything that occupies the practitioner or the window's
 * room. Used by "next free slot" in the diary and, through the same function, by online booking (portal module).
 */
import { freeSlots, type BusySpan, type FreeSlot } from "../../../../modules/pms/diary/rules";
import { addDays, londonRange } from "../../../../modules/pms/diary/time";
import { RepoInputError, assertTenantId, nowIso, type DbContext } from "../context";
import { listDiary } from "./appointments";
import { availabilityWindows } from "./availability";
import { loadServiceRef } from "./shared";

export interface FreeSlotSearch {
  /** First UK date to look at ("YYYY-MM-DD"). */
  fromDate: string;
  /** Days to look at (1–28, default 14). */
  days?: number;
  siteId?: string;
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
}

export async function findFreeSlots(ctx: DbContext, tenantId: string, q: FreeSlotSearch): Promise<FreeSlot[]> {
  assertTenantId(tenantId);
  const days = Math.min(28, Math.max(1, Math.floor(q.days ?? 14)));
  const duration = q.durationMinutes ?? (q.serviceId ? (await loadServiceRef(ctx, tenantId, q.serviceId)).durationMinutes : null);
  if (!duration) throw new RepoInputError("Choose an appointment type or a length.");
  const dates = Array.from({ length: days }, (_, i) => addDays(q.fromDate, i));
  let windows = await availabilityWindows(ctx, tenantId, dates, { siteId: q.siteId, practitionerIds: q.practitionerIds });
  if (q.onlineOnly) windows = windows.filter((w) => w.onlineBookable);
  if (windows.length === 0) return [];
  const practitionerIds = Array.from(new Set(windows.map((w) => w.practitionerId)));
  const roomIds = Array.from(new Set(windows.map((w) => w.roomId).filter((r): r is string => r !== null)));
  // Occupying items of those practitioners and rooms (any site: a practitioner booked elsewhere is busy), a day
  // at a time. A day whose list would be cut short offers nothing (never a slot that only looks free).
  const busy: BusySpan[] = [];
  const fullDays = new Set<string>();
  for (const date of Array.from(new Set(windows.map((w) => w.date)))) {
    const { items, truncated } = await listDiary(ctx, tenantId, { ...londonRange(date, 1), practitionerIds, roomIds, limit: 500 });
    if (truncated) fullDays.add(date);
    for (const i of items) busy.push({ practitionerId: i.practitionerId, roomId: i.roomId, startsAt: i.startsAt, endsAt: i.endsAt });
  }
  return freeSlots({
    windows: windows.filter((w) => !fullDays.has(w.date)),
    busy,
    durationMinutes: duration,
    stepMinutes: q.stepMinutes,
    notBefore: q.notBefore ?? nowIso(ctx),
    limit: Math.min(200, q.limit ?? 20),
  });
}
