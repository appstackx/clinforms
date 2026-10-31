"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { axisTicks, dataMax, niceMax, seriesStyle, stackSegments, type ChartKind, type ChartSeries } from "./chart-model";
import { SegmentedControl } from "./segmented-control";

export interface PmsChartProps {
  kind: ChartKind;
  title: string;
  /** One sentence for screen readers saying what the chart shows ("Attended appointments rose from 312 to 368"). */
  summary: string;
  /** X-axis labels (weeks, months, sites). */
  categories: readonly string[];
  series: readonly ChartSeries[];
  /** How a value reads in labels and the table (default: the number). */
  format?: (v: number) => string;
  /** Header of the table's first column ("Month"). */
  categoryLabel?: string;
  /** Start on the table (e.g. a phone setting). */
  defaultView?: "chart" | "table";
  className?: string;
}

const W = 640;
const H = 240;
const PAD = { top: 16, right: 16, bottom: 32, left: 64 };

function Marker({ shape, x, y, cls }: { shape: string; x: number; y: number; cls: string }) {
  const s = 4;
  if (shape === "square") return <rect x={x - s} y={y - s} width={s * 2} height={s * 2} className={cls} />;
  if (shape === "diamond") return <polygon points={`${x},${y - s - 1} ${x + s + 1},${y} ${x},${y + s + 1} ${x - s - 1},${y}`} className={cls} />;
  if (shape === "triangle") return <polygon points={`${x},${y - s - 1} ${x + s + 1},${y + s} ${x - s - 1},${y + s}`} className={cls} />;
  return <circle cx={x} cy={y} r={s} className={cls} />;
}

/**
 * Report chart (brief Part A, "Chart styles"): line, bar (grouped when several series) and stacked bar, drawn with the
 * colour tokens on a white card – #CBD5E1 axis, #F1F5F9 grid lines, 11 px #475569 labels. Always with a table
 * alternative: a "Chart | Table" switch shows the same figures as a real table, and the chart itself is one image
 * with a spoken summary. Series differ by colour AND marker shape, and the legend names them. On a phone the chart
 * scrolls sideways inside its card (keyboard-focusable) rather than shrinking its text.
 */
export function PmsChart({ kind, title, summary, categories, series, format = (v) => String(v), categoryLabel = "", defaultView = "chart", className }: PmsChartProps) {
  const [view, setView] = React.useState<"chart" | "table">(defaultView);
  const titleId = React.useId();
  const n = categories.length;
  const max = niceMax(dataMax(kind, series, n));
  const ticks = axisTicks(max);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const slot = plotW / Math.max(1, n);
  const cx = (c: number) => PAD.left + slot * c + slot / 2;

  return (
    <figure className={cn("m-0 flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-white px-5 py-4", className)} aria-labelledby={titleId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <figcaption id={titleId} className="font-semibold text-foreground">
          {title}
        </figcaption>
        <SegmentedControl
          size="sm"
          label={`Show ${title} as`}
          value={view}
          onChange={setView}
          options={[
            { value: "chart", label: "Chart" },
            { value: "table", label: "Table" },
          ]}
        />
      </div>
      {series.length > 1 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#334155]" aria-label="Legend">
          {series.map((s, i) => (
            <li key={s.name} className="inline-flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <Marker shape={seriesStyle(i).marker} x={6} y={6} cls={seriesStyle(i).fill} />
              </svg>
              {s.name}
            </li>
          ))}
        </ul>
      ) : null}
      {view === "chart" ? (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`${title} (scrolls sideways)`}>
          <svg role="img" aria-label={summary} viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[480px]">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#CBD5E1" : "#F1F5F9"} />
                <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#475569">
                  {format(t)}
                </text>
              </g>
            ))}
            {categories.map((c, i) => (
              <text key={c} x={cx(i)} y={H - 10} textAnchor="middle" fontSize="11" fill="#475569">
                {c}
              </text>
            ))}
            {kind === "line"
              ? series.map((s, si) => {
                  const st = seriesStyle(si);
                  const pts = s.values.map((v, c) => `${cx(c)},${y(v)}`).join(" ");
                  return (
                    <g key={s.name}>
                      <polyline points={pts} fill="none" strokeWidth="2" strokeLinejoin="round" className={st.stroke} />
                      {s.values.map((v, c) => (
                        <Marker key={c} shape={st.marker} x={cx(c)} y={y(v)} cls={cn(st.fill, "stroke-white")} />
                      ))}
                    </g>
                  );
                })
              : null}
            {kind === "bar"
              ? categories.map((c, ci) => {
                  const group = Math.min(56, slot * 0.7);
                  const bw = group / Math.max(1, series.length);
                  return series.map((s, si) => {
                    const v = Math.max(0, s.values[ci] ?? 0);
                    const x = cx(ci) - group / 2 + bw * si;
                    return <rect key={`${c}-${s.name}`} x={x + 1} y={y(v)} width={Math.max(1, bw - 2)} height={y(0) - y(v)} rx="3" className={seriesStyle(si).fill} />;
                  });
                })
              : null}
            {kind === "stacked"
              ? stackSegments(series, n).map((segs, ci) => {
                  const bw = Math.min(40, slot * 0.6);
                  return segs.map(([a, b], si) =>
                    b > a ? <rect key={`${ci}-${si}`} x={cx(ci) - bw / 2} y={y(b)} width={bw} height={y(a) - y(b)} className={cn(seriesStyle(si).fill, "stroke-white")} strokeWidth="1" /> : null,
                  );
                })
              : null}
          </svg>
        </div>
      ) : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`${title} – table (scrolls sideways)`}>
          <table className="w-full border-collapse text-sm tabular-nums">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="bg-[#F8FAFC] text-xs text-[#475569]">
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  {categoryLabel || <span className="sr-only">Category</span>}
                </th>
                {series.map((s) => (
                  <th key={s.name} scope="col" className="px-3 py-2 text-right font-semibold">
                    {s.name}
                  </th>
                ))}
                {kind === "stacked" ? (
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    Total
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {categories.map((c, ci) => (
                <tr key={c} className="border-t border-border">
                  <th scope="row" className="px-3 py-2 text-left font-medium text-foreground">
                    {c}
                  </th>
                  {series.map((s) => (
                    <td key={s.name} className="px-3 py-2 text-right">
                      {format(s.values[ci] ?? 0)}
                    </td>
                  ))}
                  {kind === "stacked" ? <td className="px-3 py-2 text-right font-semibold">{format(series.reduce((a, s) => a + (s.values[ci] ?? 0), 0))}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}
