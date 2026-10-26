"use client";
/**
 * Body chart editor: click (or tap) the front or back outline to add a marker; every marker is also a row in the list
 * below, where its kind, intensity and description are set. Keyboard: "Add a marker" buttons add one in the middle
 * of a view; a focused marker moves with the arrow keys (Shift = bigger steps) and goes with Delete. The chart is
 * sent with the note as data (a hidden field), never as a picture.
 */
import { useRef, useState } from "react";
import {
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
import { INPUT_CLASS } from "./form";
import { MarkerShape, Outline, VIEW_LABELS } from "./body-chart-view";

export function BodyChartEditor({ name = "bodyChart", initial, onChange }: { name?: string; initial: BodyChart | null; onChange?: () => void }) {
  const [markers, setMarkers] = useState<BodyMarker[]>(initial?.markers ?? []);
  const [selected, setSelected] = useState<number | null>(null);
  const [kind, setKind] = useState<MarkerKind>("pain");
  const [announce, setAnnounce] = useState("");
  const refs = useRef<(SVGGElement | null)[]>([]);

  function update(next: BodyMarker[], message?: string) {
    setMarkers(next);
    if (message) setAnnounce(message);
    onChange?.();
  }

  function add(view: BodyView, x = 50, y = 25) {
    if (markers.length >= MAX_MARKERS) {
      setAnnounce(`At most ${MAX_MARKERS} markers.`);
      return;
    }
    const marker: BodyMarker = { view, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, kind, intensity: null, label: null };
    const next = [...markers, marker];
    update(next, `Marker ${next.length} added: ${describeMarker(marker, next.length - 1)}`);
    setSelected(next.length - 1);
  }

  function onSvgClick(view: BodyView, e: React.MouseEvent<SVGSVGElement>) {
    const svg = e.currentTarget;
    const box = svg.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    const x = ((e.clientX - box.left) / box.width) * 100;
    const y = ((e.clientY - box.top) / box.height) * 100;
    add(view, Math.min(100, Math.max(0, x)), Math.min(100, Math.max(0, y)));
  }

  function onMarkerKey(index: number, e: React.KeyboardEvent<SVGGElement>) {
    const step = e.shiftKey ? 5 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step / 2], ArrowDown: [0, step / 2] };
    if (moves[e.key]) {
      e.preventDefault();
      const [dx, dy] = moves[e.key];
      update(markers.map((m, i) => (i === index ? nudgeMarker(m, dx, dy) : m)));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(index);
    }
  }

  function remove(index: number) {
    const next = markers.filter((_, i) => i !== index);
    update(next, `Marker ${index + 1} removed.`);
    setSelected(null);
  }

  function patch(index: number, change: Partial<BodyMarker>) {
    update(markers.map((m, i) => (i === index ? { ...m, ...change } : m)));
  }

  return (
    <div className="space-y-3">
      <input type="hidden" name={name} value={JSON.stringify({ markers })} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label htmlFor="body-chart-kind" className="block text-sm font-medium text-slate-800">
            New markers show
          </label>
          <select id="body-chart-kind" value={kind} onChange={(e) => setKind(e.target.value as MarkerKind)} className={`${INPUT_CLASS} h-10 w-48`}>
            {MARKER_KINDS.map((k) => (
              <option key={k} value={k}>
                {MARKER_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        {BODY_VIEWS.map((view) => (
          <button
            key={view}
            type="button"
            onClick={() => add(view)}
            className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
          >
            Add a marker to the {VIEW_LABELS[view].toLowerCase()}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-600">Click the outline where the patient points. Select a marker and use the arrow keys to move it, Delete to remove it.</p>
      <div className="grid max-w-md grid-cols-2 gap-3">
        {BODY_VIEWS.map((view) => (
          <div key={view} className="rounded-xl border border-slate-200 bg-white p-2">
            <p className="text-center text-xs font-semibold uppercase tracking-wide text-slate-600">{VIEW_LABELS[view]}</p>
            <svg
              viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
              className="mx-auto h-auto w-full max-w-[10rem] cursor-crosshair touch-manipulation"
              onClick={(e) => onSvgClick(view, e)}
              aria-label={`${VIEW_LABELS[view]} of the body: click to add a marker`}
              role="group"
            >
              <Outline />
              {markers.map((m, i) =>
                m.view === view ? (
                  <g
                    key={i}
                    ref={(el) => {
                      refs.current[i] = el;
                    }}
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
                    className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-[2] [&:focus-visible>circle]:stroke-teal-500"
                  >
                    <MarkerShape x={m.x} y={m.y} letter={String(i + 1)} selected={selected === i} />
                  </g>
                ) : null,
              )}
            </svg>
          </div>
        ))}
      </div>
      <div aria-live="polite" className="sr-only">
        {announce}
      </div>
      {markers.length > 0 ? (
        <ol className="space-y-2">
          {markers.map((m, i) => (
            <li key={i} className={`grid gap-2 rounded-lg border p-2 sm:grid-cols-[2rem_9rem_7rem_1fr_auto] sm:items-center ${selected === i ? "border-teal-500 bg-teal-50/40" : "border-slate-200"}`}>
              <span className="text-sm font-semibold text-slate-900" aria-hidden="true">
                {i + 1}.
              </span>
              <label className="sr-only" htmlFor={`marker-${i}-kind`}>
                Marker {i + 1}: kind
              </label>
              <select id={`marker-${i}-kind`} value={m.kind} onChange={(e) => patch(i, { kind: e.target.value as MarkerKind })} className={`${INPUT_CLASS} h-9`}>
                {MARKER_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {MARKER_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor={`marker-${i}-intensity`}>
                Marker {i + 1}: intensity out of 10
              </label>
              <select
                id={`marker-${i}-intensity`}
                value={m.intensity === null || m.intensity === undefined ? "" : String(m.intensity)}
                onChange={(e) => patch(i, { intensity: e.target.value === "" ? null : Number(e.target.value) })}
                className={`${INPUT_CLASS} h-9`}
              >
                <option value="">Intensity –</option>
                {Array.from({ length: 11 }, (_, n) => (
                  <option key={n} value={n}>
                    {n}/10
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor={`marker-${i}-label`}>
                Marker {i + 1}: description
              </label>
              <input
                id={`marker-${i}-label`}
                value={m.label ?? ""}
                maxLength={120}
                placeholder={`${VIEW_LABELS[m.view]}: describe it (optional)`}
                onChange={(e) => patch(i, { label: e.target.value })}
                className={`${INPUT_CLASS} h-9`}
              />
              <button
                type="button"
                onClick={() => remove(i)}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-red-300 bg-white px-3 text-sm font-medium text-red-800 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
              >
                Remove<span className="sr-only"> marker {i + 1}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-slate-600">No markers yet.</p>
      )}
    </div>
  );
}
