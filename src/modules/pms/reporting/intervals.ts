/**
 * Minute intervals of one day (pure): used by the diary's reporting source to work out a practitioner's available
 * and booked time (utilisation) – rota windows and bookings joined, blocked time (leave, meetings…) taken away, so
 * booked time can never be more than available time. Intervals are [start, end) in minutes after local midnight.
 */

export type Interval = readonly [number, number];

/** Sorted, non-overlapping intervals covering the same minutes (empty and backwards ones dropped). */
export function mergeIntervals(list: readonly Interval[]): [number, number][] {
  const sorted = list.filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s).slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** Minutes covered (overlaps counted once). */
export function coveredMinutes(list: readonly Interval[]): number {
  return mergeIntervals(list).reduce((sum, [s, e]) => sum + (e - s), 0);
}

/** `list` with every minute of `remove` taken out. */
export function subtractIntervals(list: readonly Interval[], remove: readonly Interval[]): [number, number][] {
  const cut = mergeIntervals(remove);
  const out: [number, number][] = [];
  for (const [s0, e0] of mergeIntervals(list)) {
    let s = s0;
    for (const [rs, re] of cut) {
      if (re <= s) continue;
      if (rs >= e0) break;
      if (rs > s) out.push([s, Math.min(rs, e0)]);
      s = Math.max(s, re);
      if (s >= e0) break;
    }
    if (s < e0) out.push([s, e0]);
  }
  return out;
}

/**
 * A practitioner's day at one site for utilisation:
 *   available = (rota windows ∪ bookings) − blocked time
 *   booked    = bookings − blocked time
 * A booking outside the rota or the opening hours (hours changed after it was booked, an extra session) counts as
 * available time too, so booked ≤ available always (never more than 100 %). `blocked` = the rota time lost to
 * blocked time (leave, meetings…).
 */
export function dayUtilisation(rota: readonly Interval[], bookings: readonly Interval[], blocks: readonly Interval[]): { available: number; booked: number; blocked: number } {
  const available = coveredMinutes(subtractIntervals([...rota, ...bookings], blocks));
  const booked = coveredMinutes(subtractIntervals(bookings, blocks));
  const rotaMinutes = coveredMinutes(rota);
  const blocked = rotaMinutes - coveredMinutes(subtractIntervals(rota, blocks));
  return { available, booked: Math.min(booked, available), blocked };
}
