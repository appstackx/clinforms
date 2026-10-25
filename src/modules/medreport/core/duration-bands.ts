/**
 * Printed time bands (Blue Heart fix round 3, B2-10): a referrer's options such as "0-3 MONTHS", "4-6 MONTHS",
 * "7-9 MONTHS", "10-12 MONTHS", and a duration a clinician recorded in days, weeks or months ("should settle within
 * 4–6 weeks"). bandFor() gives the printed band that contains the whole recorded duration – 4–6 weeks is within
 * "0-3 MONTHS" – so a gap or a suggested question never offers a band that cannot contain it. Deterministic; pure.
 */

const DAYS: Record<string, number> = { day: 1, week: 7, month: 30.4375, year: 365.25 };
const unitDays = (unit: string) => DAYS[unit.toLowerCase().replace(/s$/, "")] ?? NaN;

export interface DurationBand {
  option: string;
  /** Lower and upper bound in days; the lower bound is exclusive for a band that follows on from the one before. */
  lo: number;
  hi: number;
  loExclusive: boolean;
}

/** The options as time bands, in order – or null when any option is not one ("0-3 MONTHS", "Less than 6 weeks", "Over 12 months"). */
export function durationBands(options: readonly string[] | undefined): DurationBand[] | null {
  if (!options || options.length < 2) return null;
  const out: DurationBand[] = [];
  let prevHi: { n: number; unit: string } | null = null;
  for (const raw of options) {
    const o = raw.trim();
    let m: RegExpExecArray | null;
    if ((m = /^(\d+)\s*(?:-|–|—|to)\s*(\d+)\s*(days?|weeks?|months?|years?)$/i.exec(o))) {
      const d = unitDays(m[3]);
      const lo = Number(m[1]);
      // "4-6 MONTHS" after "0-3 MONTHS": it starts where that one ends.
      const follows = prevHi !== null && prevHi.unit === m[3].toLowerCase().replace(/s$/, "") && lo === prevHi.n + 1;
      out.push({ option: o, lo: follows ? (prevHi as { n: number }).n * d : lo * d, hi: Number(m[2]) * d, loExclusive: follows });
      prevHi = { n: Number(m[2]), unit: m[3].toLowerCase().replace(/s$/, "") };
    } else if ((m = /^(?:less than|under|up to|within)\s+(\d+)\s*(days?|weeks?|months?|years?)$/i.exec(o))) {
      out.push({ option: o, lo: 0, hi: Number(m[1]) * unitDays(m[2]), loExclusive: false });
      prevHi = null;
    } else if ((m = /^(?:over|more than|longer than)\s+(\d+)\s*(days?|weeks?|months?|years?)$|^(\d+)\s*\+\s*(days?|weeks?|months?|years?)$/i.exec(o))) {
      const n = Number(m[1] ?? m[3]);
      out.push({ option: o, lo: n * unitDays(m[2] ?? m[4]), hi: Infinity, loExclusive: true });
      prevHi = null;
    } else return null;
  }
  return out.every((b) => Number.isFinite(b.lo)) ? out : null;
}

/** The first duration a text records – "4–6 weeks", "within 6 weeks", "2 weeks" – in days, with its words; or null. */
export function recordedDuration(text: string): { lo: number; hi: number; text: string } | null {
  const m =
    /\b(?:(within|in|over|up to|under)\s+)?(\d+(?:\.\d+)?)(?:\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?))?\s*(days?|weeks?|months?|years?)\b/i.exec(text);
  if (!m) return null;
  const d = unitDays(m[4]);
  const a = Number(m[2]);
  const b = m[3] ? Number(m[3]) : a;
  const upTo = Boolean(m[1]) && /^(?:within|up to|under)$/i.test(m[1]);
  return { lo: upTo ? 0 : a * d, hi: b * d, text: m[0].replace(/^(?:within|in|over|up to|under)\s+/i, "") };
}

/** The printed band that contains the whole duration `text` records, or null (no band, or it spans two). */
export function bandFor(options: readonly string[] | undefined, text: string): { option: string; duration: string } | null {
  const bands = durationBands(options);
  const d = recordedDuration(text);
  if (!bands || !d) return null;
  const inside = bands.filter((b) => (b.loExclusive ? d.lo > b.lo : d.lo >= b.lo) && d.hi <= b.hi);
  return inside.length === 1 ? { option: inside[0].option, duration: d.text } : null;
}
