"use client";
/**
 * The note's body chart (design round 2, note editor): front and back outlines side by side, numbered markers, and
 * the numbered details list under it – the chart never relies on colour or on seeing it (each marker is a list row
 * in words). Data, not a picture: { markers: [{ view, x, y, kind, intensity, label }] } (records' body-chart rules).
 *
 * Editing: click (or tap) the outline to add a marker there; "Add marker" adds one on the front and moves focus to
 * its "Where" field; a focused marker moves with the arrow keys (Shift = bigger steps) and goes with Delete; each
 * row sets where, what kind and the 0–10 score, or removes it.
 */
import { useRef, useState } from "react";
import { X } from "lucide-react";
import {
  BODY_OUTLINE_PATHS,
  BODY_VIEWS,
  CHART_HEIGHT,
  CHART_WIDTH,
  MARKER_KINDS,
  MARKER_KIND_LABELS,
  MAX_MARKERS,
  describeMarker,
  nudgeMarker,
  type BodyChart,
  type BodyMarker,
  type BodyView,
  type MarkerKind,
} from "@/modules/pms/records/body-chart";
import { PmsButton, inputClasses } from "@/components/pms/ui";
import { cn } from "@/lib/utils";

const VIEW_CAPTIONS: Record<BodyView, string> = { front: "Front (patient's right on left)", back: "Back" };

function details(m: BodyMarker): string {
  return [MARKER_KIND_LABELS[m.kind], m.intensity !== null && m.intensity !== undefined ? `NPRS ${m.intensity}` : null].filter(Boolean).join(" · ");
}

function Outline() {
  return (
    <g aria-hidden="true">
      {BODY_OUTLINE_PATHS.map((d, i) => (
        <path key={i} d={d} fill="#FFFFFF" stroke="#94A3B8" strokeWidth={0.9} strokeLinejoin="round" />
      ))}
    </g>
  );
}

function Marker({ x, y, n, selected }: { x: number; y: number; n: number; selected?: boolean }) {
  return (
    <>
      <circle cx={x} cy={y * 2} r={5} fill={selected ? "#1842B4" : "#0B7970"} stroke="#FFFFFF" strokeWidth={1.2} />
      <text x={x} y={y * 2 + 1.9} textAnchor="middle" fontSize={5.6} fontWeight={700} fill="#FFFFFF" style={{ pointerEvents: "none" }}>
        {n}
      </text>
    </>
  );
}

export function BodyChartPanel({ chart, editable, onChange }: { chart: BodyChart | null; editable: boolean; onChange?: (chart: BodyChart) => void }) {
  const markers = chart?.markers ?? [];
  const [selected, setSelected] = useState<number | null>(null);
  const [announce, setAnnounce] = useState("");
  const labelRefs = useRef<(HTMLInputElement | null)[]>([]);

  const update = (next: BodyMarker[], message?: string) => {
    onChange?.({ markers: next });
    if (message) setAnnounce(message);
  };
  const add = (view: BodyView, x = 50, y = 22, focusLabel = false) => {
    if (markers.length >= MAX_MARKERS) return setAnnounce(`At most ${MAX_MARKERS} markers.`);
    const m: BodyMarker = { view, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, kind: "pain", intensity: null, label: null };
    const next = [...markers, m];
    update(next, `Marker ${next.length} added on the ${view}.`);
    setSelected(next.length - 1);
    if (focusLabel) setTimeout(() => labelRefs.current[next.length - 1]?.focus(), 0);
  };
  const remove = (i: number) => {
    update(
      markers.filter((_, k) => k !== i),
      `Marker ${i + 1} removed.`,
    );
    setSelected(null);
  };
  const patch = (i: number, change: Partial<BodyMarker>) => update(markers.map((m, k) => (k === i ? { ...m, ...change } : m)));
  const onSvgClick = (view: BodyView, e: React.MouseEvent<SVGSVGElement>) => {
    if (!editable) return;
    const box = e.currentTarget.getBoundingClientRect();
    if (!box.width || !box.height) return;
    add(view, Math.min(100, Math.max(0, ((e.clientX - box.left) / box.width) * 100)), Math.min(100, Math.max(0, ((e.clientY - box.top) / box.height) * 100)));
  };
  const onMarkerKey = (i: number, e: React.KeyboardEvent<SVGGElement>) => {
    const step = e.shiftKey ? 5 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step / 2], ArrowDown: [0, step / 2] };
    if (moves[e.key]) {
      e.preventDefault();
      patch(i, nudgeMarker(markers[i], moves[e.key][0], moves[e.key][1]));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(i);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="body-chart-heading" className="text-[15px] font-semibold text-foreground">
          Body chart
        </h2>
        {editable ? (
          <PmsButton variant="secondary" size="sm" onClick={() => add("front", 50, 22, true)}>
            Add marker
          </PmsButton>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#F8FAFC] p-2" role="group" aria-labelledby="body-chart-heading">
        {BODY_VIEWS.map((view) => (
          <figure key={view} className="flex flex-col items-center gap-1">
            <svg
              viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
              className={cn("h-auto w-full max-w-[120px] touch-manipulation", editable && "cursor-crosshair")}
              onClick={(e) => onSvgClick(view, e)}
              role={editable ? "group" : "img"}
              aria-label={editable ? `${view === "front" ? "Front" : "Back"} of the body: click to add a marker` : `${view === "front" ? "Front" : "Back"} of the body with ${markers.filter((m) => m.view === view).length} markers`}
            >
              <Outline />
              {markers.map((m, i) =>
                m.view === view ? (
                  editable ? (
                    <g
                      key={i}
                      tabIndex={0}
                      role="button"
                      aria-label={`${describeMarker(m, i)}. Arrow keys move it, Delete removes it.`}
                      aria-pressed={selected === i}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(i);
                      }}
                      onFocus={() => setSelected(i)}
                      onKeyDown={(e) => onMarkerKey(i, e)}
                      className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-[#0E958A] [&:focus-visible>circle]:stroke-[2.5]"
                    >
                      <Marker x={m.x} y={m.y} n={i + 1} selected={selected === i} />
                    </g>
                  ) : (
                    <g key={i}>
                      <Marker x={m.x} y={m.y} n={i + 1} />
                    </g>
                  )
                ) : null,
              )}
            </svg>
            <figcaption className="text-[10px] text-[#475569]">{VIEW_CAPTIONS[view]}</figcaption>
          </figure>
        ))}
      </div>
      <div aria-live="polite" className="sr-only">
        {announce}
      </div>
      {markers.length ? (
        <ol className="flex flex-col gap-2.5" aria-label="Body chart markers">
          {markers.map((m, i) => (
            <li key={i} className={cn("flex gap-2.5", editable && selected === i && "rounded-lg bg-[#F0FDFA] p-1.5 -m-1.5")}>
              <span aria-hidden className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-strong text-[11px] font-bold text-white">
                {i + 1}
              </span>
              {editable ? (
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <label className="sr-only" htmlFor={`marker-${i}-label`}>
                    Marker {i + 1}: where
                  </label>
                  <input
                    id={`marker-${i}-label`}
                    ref={(el) => {
                      labelRefs.current[i] = el;
                    }}
                    value={m.label ?? ""}
                    maxLength={120}
                    placeholder="Where (e.g. right shoulder, anterolateral)"
                    onChange={(e) => patch(i, { label: e.target.value })}
                    onFocus={() => setSelected(i)}
                    className={cn(inputClasses, "h-8 text-[13px]")}
                  />
                  <div className="flex gap-1.5">
                    <label className="sr-only" htmlFor={`marker-${i}-kind`}>
                      Marker {i + 1}: kind
                    </label>
                    <select id={`marker-${i}-kind`} value={m.kind} onChange={(e) => patch(i, { kind: e.target.value as MarkerKind })} className={cn(inputClasses, "h-8 min-w-0 flex-1 px-2 text-[13px]")}>
                      {MARKER_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {MARKER_KIND_LABELS[k]}
                        </option>
                      ))}
                    </select>
                    <label className="sr-only" htmlFor={`marker-${i}-score`}>
                      Marker {i + 1}: pain score 0 to 10
                    </label>
                    <select
                      id={`marker-${i}-score`}
                      value={m.intensity === null || m.intensity === undefined ? "" : String(m.intensity)}
                      onChange={(e) => patch(i, { intensity: e.target.value === "" ? null : Number(e.target.value) })}
                      className={cn(inputClasses, "h-8 w-[88px] px-2 text-[13px]")}
                    >
                      <option value="">NPRS –</option>
                      {Array.from({ length: 11 }, (_, n) => (
                        <option key={n} value={n}>
                          NPRS {n}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-border text-[#475569] hover:bg-[#F1F5F9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      <X className="h-4 w-4" aria-hidden />
                      <span className="sr-only">Remove marker {i + 1}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <span className="flex min-w-0 flex-col text-sm">
                  <strong className="font-semibold text-foreground">{m.label || `${m.view === "front" ? "Front" : "Back"} marker`}</strong>
                  <span className="text-[13px] text-[#475569]">{details(m)}</span>
                </span>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">{editable ? "No markers yet. Click the outline where the patient points." : "No markers."}</p>
      )}
    </div>
  );
}
