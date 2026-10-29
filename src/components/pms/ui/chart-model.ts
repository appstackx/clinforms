/**
 * Pure rules behind the kit's charts (brief Part A, "Chart styles"): a round axis maximum, its ticks, and the series
 * colours – tokens only, each at least 3:1 against the white card (WCAG 1.4.11) and told apart by a marker and the
 * legend's words as well as colour.
 */

export type ChartKind = "line" | "bar" | "stacked";

export interface ChartSeries {
  name: string;
  values: readonly number[];
}

/**
 * Series styles in order: Tailwind token classes (fill/stroke) and a marker shape. primary #0E958A 3.7:1,
 * secondary #1842B4 7.6:1, accent-text #864E0E 7.0:1, muted-foreground #64748B 4.8:1 on white.
 */
export const SERIES_STYLES = [
  { fill: "fill-primary", stroke: "stroke-primary", bg: "bg-primary", marker: "circle" },
  { fill: "fill-secondary", stroke: "stroke-secondary", bg: "bg-secondary", marker: "square" },
  { fill: "fill-accent-text", stroke: "stroke-accent-text", bg: "bg-accent-text", marker: "diamond" },
  { fill: "fill-muted-foreground", stroke: "stroke-muted-foreground", bg: "bg-muted-foreground", marker: "triangle" },
] as const;

export const seriesStyle = (i: number) => SERIES_STYLES[i % SERIES_STYLES.length];

/** The smallest "nice" number (1, 2, 2.5, 5 × 10^n) at or above `value`; 1 for zero or less. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  for (const m of [1, 2, 2.5, 5, 10]) if (m * base >= value - 1e-9) return m * base;
  return 10 * base;
}

/** The largest value the axis must show: per category, the sum (stacked) or the biggest single value. */
export function dataMax(kind: ChartKind, series: readonly ChartSeries[], categories: number): number {
  let max = 0;
  for (let c = 0; c < categories; c++) {
    const vals = series.map((s) => Math.max(0, s.values[c] ?? 0));
    max = Math.max(max, kind === "stacked" ? vals.reduce((a, b) => a + b, 0) : Math.max(0, ...vals));
  }
  return max;
}

/** Evenly spaced ticks from 0 to `max` inclusive (`count` intervals). */
export function axisTicks(max: number, count = 4): number[] {
  return Array.from({ length: count + 1 }, (_, i) => Math.round(((max * i) / count) * 1000) / 1000);
}

/** Per category, each series' [start, end] in a stacked bar. */
export function stackSegments(series: readonly ChartSeries[], categories: number): [number, number][][] {
  return Array.from({ length: categories }, (_, c) => {
    let at = 0;
    return series.map((s) => {
      const v = Math.max(0, s.values[c] ?? 0);
      const seg: [number, number] = [at, at + v];
      at += v;
      return seg;
    });
  });
}
