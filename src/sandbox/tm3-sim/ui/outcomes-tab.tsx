/**
 * Outcome measures tab: one card per instrument with a small SVG line chart and a score table.
 * The table is the accessible source of truth; the chart has a text summary as its label.
 *
 * Owner: sandbox agent.
 */
import { LineChart } from "lucide-react";
import type { SimOutcomeMeasure } from "../wire-types";
import { formatDate, INSTRUMENT_NAMES } from "./format";
import { EmptyState, Panel } from "./ui-bits";

const W = 320;
const H = 150;
const PAD = { top: 18, right: 14, bottom: 26, left: 30 };

function domainFor(m: SimOutcomeMeasure): [number, number] {
  if (m.unit === "%") return [0, 100];
  if (m.unit === "/10") return [0, 10];
  const max = Math.max(1, ...m.scores.map((s) => s.value));
  return [0, Math.ceil(max * 1.2)];
}

function dayNumber(iso: string): number {
  const [y, mo, d] = iso.split("-").map(Number);
  return Date.UTC(y, (mo || 1) - 1, d || 1) / 86_400_000;
}

const shortDate = (iso: string) => formatDate(iso).slice(0, 5);
const withUnit = (v: number, unit: string) => (unit === "%" ? `${v}%` : unit === "/10" ? `${v}/10` : `${v} ${unit}`.trim());

function ScoreChart({ m }: { m: SimOutcomeMeasure }) {
  const scores = m.scores.slice().sort((a, b) => a.date.localeCompare(b.date));
  const [lo, hi] = domainFor(m);
  const days = scores.map((s) => dayNumber(s.date));
  const d0 = Math.min(...days);
  const d1 = Math.max(...days);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (day: number) => PAD.left + (d1 === d0 ? innerW / 2 : ((day - d0) / (d1 - d0)) * innerW);
  const y = (v: number) => PAD.top + innerH - ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo || 1)) * innerH;
  const ticks = [0, 0.5, 1].map((f) => lo + (hi - lo) * f);
  const points = scores.map((s, i) => `${x(days[i])},${y(s.value)}`).join(" ");
  const summary = `${m.instrument} scores: ${scores.map((s) => `${withUnit(s.value, m.unit)} on ${formatDate(s.date)}`).join(", ")}.`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={summary}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth={1} />
          <text x={PAD.left - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill="#64748b">
            {Math.round(t)}
          </text>
        </g>
      ))}
      {scores.length > 1 && (
        <polyline points={points} fill="none" stroke="#1d4ed8" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
      )}
      {scores.map((s, i) => (
        <g key={`${s.date}-${i}`}>
          <circle cx={x(days[i])} cy={y(s.value)} r={4} fill="#fff" stroke="#1d4ed8" strokeWidth={2} />
          <text x={x(days[i])} y={y(s.value) - 8} textAnchor="middle" fontSize={10} fontWeight={600} fill="#0f172a">
            {s.value}
          </text>
          <text
            x={x(days[i])}
            y={H - 8}
            textAnchor={i === 0 && scores.length > 1 ? "start" : i === scores.length - 1 && scores.length > 1 ? "end" : "middle"}
            fontSize={10}
            fill="#64748b"
          >
            {shortDate(s.date)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function SeriesCard({ m }: { m: SimOutcomeMeasure }) {
  const scores = m.scores.slice().sort((a, b) => a.date.localeCompare(b.date));
  const baseline = scores[0]?.value;
  return (
    <Panel
      headingLevel={3}
      title={
        <>
          {INSTRUMENT_NAMES[m.instrument]} <span className="font-normal text-slate-500">({m.instrument})</span>
        </>
      }
      description={`Unit ${m.unit} · ${m.higher_is_worse ? "lower is better" : "higher is better"} · ${scores.length} recordings`}
    >
      {scores.length === 0 ? (
        <p className="text-sm text-slate-600">No scores recorded.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center">
          <div className="rounded-lg bg-slate-50 p-2">
            <ScoreChart m={m} />
          </div>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{m.instrument} scores by date</caption>
            <thead className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr className="border-b border-slate-200">
                <th scope="col" className="py-2 pr-3">Date</th>
                <th scope="col" className="py-2 pr-3">Score</th>
                <th scope="col" className="py-2">Change from first</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {scores.map((s, i) => {
                const delta = baseline === undefined ? 0 : s.value - baseline;
                const better = m.higher_is_worse ? delta < 0 : delta > 0;
                return (
                  <tr key={`${s.date}-${i}`}>
                    <td className="whitespace-nowrap py-2 pr-3 text-slate-700">{formatDate(s.date)}</td>
                    <td className="whitespace-nowrap py-2 pr-3 font-semibold text-slate-900">{withUnit(s.value, m.unit)}</td>
                    <td className="whitespace-nowrap py-2 text-slate-700">
                      {i === 0 ? (
                        <span className="text-slate-500">Baseline</span>
                      ) : (
                        <span className={delta === 0 ? "" : better ? "text-emerald-700" : "text-rose-700"}>
                          {delta > 0 ? "+" : delta < 0 ? "−" : "±"}
                          {Math.abs(delta)}
                          {m.unit === "%" ? " points" : ""}
                          {delta !== 0 && <span className="sr-only">{better ? " (improved)" : " (worse)"}</span>}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function OutcomesTab({ measures }: { measures: SimOutcomeMeasure[] }) {
  if (measures.length === 0) {
    return (
      <Panel headingLevel={3}>
        <EmptyState icon={LineChart} title="No outcome measures">
          Scores such as NDI, ODI or NPRS recorded during this episode of care will be shown here.
        </EmptyState>
      </Panel>
    );
  }
  return (
    <div className="space-y-4">
      {measures.map((m) => (
        <SeriesCard key={m.id} m={m} />
      ))}
    </div>
  );
}
