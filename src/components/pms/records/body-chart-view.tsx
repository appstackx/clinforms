/**
 * A body chart drawn from its data (server-safe, no hooks): the front and back outline, the numbered markers, and
 * the numbered list of markers in words – the chart never relies on colour or on seeing it.
 */
import { BODY_OUTLINE_PATHS, BODY_VIEWS, CHART_HEIGHT, CHART_WIDTH, describeMarker, type BodyChart, type BodyView } from "@/modules/pms/records/body-chart";

export const VIEW_LABELS: Record<BodyView, string> = { front: "Front", back: "Back" };

export function Outline() {
  return (
    <g aria-hidden="true">
      {BODY_OUTLINE_PATHS.map((d, i) => (
        <path key={i} d={d} fill="#f8fafc" stroke="#64748b" strokeWidth={0.8} strokeLinejoin="round" />
      ))}
    </g>
  );
}

export function MarkerShape({ x, y, letter, selected = false }: { x: number; y: number; letter: string; selected?: boolean }) {
  return (
    <>
      <circle cx={x} cy={y * 2} r={4.2} fill={selected ? "#115e59" : "#b91c1c"} stroke="#ffffff" strokeWidth={0.9} />
      <text x={x} y={y * 2 + 1.6} textAnchor="middle" fontSize={4.6} fontWeight={700} fill="#ffffff" style={{ pointerEvents: "none" }}>
        {letter}
      </text>
    </>
  );
}

export function BodyChartView({ chart, title = "Body chart" }: { chart: BodyChart; title?: string }) {
  return (
    <figure className="space-y-3">
      <figcaption className="text-sm font-semibold text-slate-900">{title}</figcaption>
      <div className="grid max-w-md grid-cols-2 gap-3">
        {BODY_VIEWS.map((view) => (
          <div key={view} className="rounded-xl border border-slate-200 bg-white p-2">
            <p className="text-center text-xs font-semibold uppercase tracking-wide text-slate-600">{VIEW_LABELS[view]}</p>
            <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="mx-auto h-auto w-full max-w-[10rem]" role="img" aria-label={`${VIEW_LABELS[view]} of the body with ${chart.markers.filter((m) => m.view === view).length} markers`}>
              <Outline />
              {chart.markers.map((m, i) =>
                m.view === view ? (
                  <g key={i}>
                    <MarkerShape x={m.x} y={m.y} letter={String(i + 1)} />
                  </g>
                ) : null,
              )}
            </svg>
          </div>
        ))}
      </div>
      {chart.markers.length ? (
        <ol className="space-y-0.5 text-sm text-slate-800">
          {chart.markers.map((m, i) => (
            <li key={i}>{describeMarker(m, i)}</li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-slate-600">No markers.</p>
      )}
    </figure>
  );
}
