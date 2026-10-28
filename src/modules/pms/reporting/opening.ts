/**
 * The ONE opening-hours source of the clinic system (pure): a site's opening sessions per weekday and its closures
 * (pms_site_hours, pms_site_closures – Set-up → Sites and hours). The diary's rota windows are clipped to them
 * (src/server/repos/pms/diary/availability.ts), so the diary's shading, free slots, the booking check, online booking
 * and the utilisation reports all follow the same hours. A site with no opening sessions at all is "not set": its
 * rota windows are not limited (clinics before set-up keep working). A closure (of the site or of every site) takes
 * every window of that date away.
 */
import { isoWeekday } from "./periods";
import { timeToMinutes } from "./schemas";

export interface OpeningRow {
  siteId: string;
  weekday: number;
  opensAt: string;
  closesAt: string;
}

export interface ClosureRow {
  siteId: string | null;
  startsOn: string;
  endsOn: string;
  reason: string | null;
}

export interface OpeningInfo {
  /** siteId → weekday → [start, end) local minutes. Only sites with hours set. */
  hours: ReadonlyMap<string, ReadonlyMap<number, readonly (readonly [number, number])[]>>;
  closures: readonly ClosureRow[];
}

export function openingInfo(rows: readonly OpeningRow[], closures: readonly ClosureRow[]): OpeningInfo {
  const hours = new Map<string, Map<number, [number, number][]>>();
  for (const r of rows) {
    const site = hours.get(r.siteId) ?? new Map<number, [number, number][]>();
    hours.set(r.siteId, site);
    const day = site.get(r.weekday) ?? [];
    day.push([timeToMinutes(r.opensAt), timeToMinutes(r.closesAt)]);
    day.sort((a, b) => a[0] - b[0]);
    site.set(r.weekday, day);
  }
  return { hours, closures };
}

/** The closure of a site on a date (its own or every site's), or null. */
export function closureOn(info: Pick<OpeningInfo, "closures">, siteId: string, date: string): ClosureRow | null {
  return info.closures.find((c) => (c.siteId === null || c.siteId === siteId) && c.startsOn <= date && c.endsOn >= date) ?? null;
}

/** The site's opening sessions on a date: null = hours not set (no limit); [] = closed that day. */
export function openSessionsOn(info: OpeningInfo, siteId: string, date: string): readonly (readonly [number, number])[] | null {
  if (closureOn(info, siteId, date)) return [];
  const site = info.hours.get(siteId);
  if (!site) return null;
  return site.get(isoWeekday(date)) ?? [];
}

/** Rota windows clipped to the opening sessions of their site and date (pieces outside are cut off). */
export function clipToOpening<W extends { siteId: string; date: string; startMinute: number; endMinute: number }>(windows: readonly W[], info: OpeningInfo): W[] {
  const out: W[] = [];
  for (const w of windows) {
    const sessions = openSessionsOn(info, w.siteId, w.date);
    if (sessions === null) {
      out.push(w);
      continue;
    }
    for (const [open, close] of sessions) {
      const start = Math.max(open, w.startMinute);
      const end = Math.min(close, w.endMinute);
      if (end > start) out.push({ ...w, startMinute: start, endMinute: end });
    }
  }
  return out;
}

/** A new site's opening hours (and the demo sites'): Mon–Fri 08:00–20:00, Sat 09:00–13:00, Sun closed. */
export const DEFAULT_SITE_HOURS: readonly OpeningRowInput[] = [
  ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, opensAt: "08:00", closesAt: "20:00" })),
  { weekday: 6, opensAt: "09:00", closesAt: "13:00" },
];

export interface OpeningRowInput {
  weekday: number;
  opensAt: string;
  closesAt: string;
}
