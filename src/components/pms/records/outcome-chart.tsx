/**
 * One measure's scores over time (server-safe SVG, no hooks): a line through the recorded scores with each value
 * written next to its point, so the chart reads without colour; the table under it carries the same numbers.
 */
import { formatUkDate } from "@/modules/pms/core/text";
import { MEASURES, formatScore, type OutcomeMeasureId } from "@/modules/pms/records/outcomes";

export interface OutcomePoint {
  takenOn: string;
  scoreTenths: number;
}

const W = 320;
const H = 140;
const PAD = { left: 30, right: 14, top: 14, bottom: 26 };

export function OutcomeChart({ measure, points }: { measure: OutcomeMeasureId; points: OutcomePoint[] }) {
  const def = MEASURES[measure];
  const max = def.scoreMax * 10;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (Math.min(max, Math.max(0, v)) / max) * innerH;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.scoreTenths).toFixed(1)}`).join(" ");
  const first = points[0];
  const last = points[points.length - 1];
  const summary = points.length > 1 ? `from ${formatScore(measure, first.scoreTenths)} on ${formatUkDate(first.takenOn)} to ${formatScore(measure, last.scoreTenths)} on ${formatUkDate(last.takenOn)}` : `${formatScore(measure, last.scoreTenths)} on ${formatUkDate(last.takenOn)}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-md" role="img" aria-label={`${def.short} ${summary}. ${def.higherIsBetter ? "Higher is better." : "Lower is better."}`}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(max * f)} y2={y(max * f)} stroke="#e2e8f0" strokeWidth={1} />
          <text x={PAD.left - 4} y={y(max * f) + 3} textAnchor="end" fontSize={9} fill="#475569">
            {(def.scoreMax * f).toString()}
          </text>
        </g>
      ))}
      <path d={path} fill="none" stroke="#0f766e" strokeWidth={2} />
      {points.map((p, i) => (
        <g key={`${p.takenOn}-${i}`}>
          <circle cx={x(i)} cy={y(p.scoreTenths)} r={3.5} fill="#0f766e" />
          <text x={x(i)} y={y(p.scoreTenths) - 6} textAnchor="middle" fontSize={9} fontWeight={600} fill="#0f172a">
            {formatScore(measure, p.scoreTenths).replace(/\/(10|100)$/, "")}
          </text>
          <text x={x(i)} y={H - 8} textAnchor="middle" fontSize={8.5} fill="#475569">
            {formatUkDate(p.takenOn).slice(0, 5)}
          </text>
        </g>
      ))}
    </svg>
  );
}
