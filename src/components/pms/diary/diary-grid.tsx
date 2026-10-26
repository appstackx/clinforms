"use client";
/**
 * The diary grid: a time axis and one column per practitioner or room (day view) or per day (week view). Working
 * hours are white, the rest grey. Appointments are buttons placed by their UK time, coloured AND labelled by
 * status. Mouse: click an empty spot to book there, drag an appointment to move it. Keyboard: Tab to an
 * appointment, Enter opens it (with a Move form); Alt+Arrow keys move it 15 minutes or one column. The grid
 * scrolls inside its own box, so the page never scrolls sideways on a phone.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { BLOCK_KIND_LABELS, STATUS_LABELS, STATUS_TAGS } from "@/modules/pms/diary/copy";
import { canMove, layoutColumn, localSpan } from "@/modules/pms/diary/rules";
import { formatDayHeading, formatHhmm, londonParts } from "@/modules/pms/diary/time";
import type { DiaryCard, DiaryColumn } from "@/modules/pms/diary/view";
import { cn } from "@/lib/utils";
import { STATUS_TAG, cardClass } from "./status-style";

/** Height of one minute on screen (a 30-minute appointment is 45 px tall). */
export const PX_PER_MINUTE = 1.5;
const SNAP_CLICK = 15;
const SNAP_DROP = 5;

export function cardLabel(c: DiaryCard): string {
  const who = c.kind === "block" ? (c.title ?? (c.blockKind ? BLOCK_KIND_LABELS[c.blockKind] : "Blocked time")) : (c.patientName ?? "Patient");
  const parts = [
    c.timeLabel,
    who,
    c.kind === "appointment" ? c.serviceName : null,
    c.kind === "block" ? (c.status === "cancelled" ? "removed" : "blocked time") : STATUS_LABELS[c.status],
    c.practitionerName ? `with ${c.practitionerName}` : null,
    c.roomName ?? (c.kind === "appointment" ? "no room" : null),
    c.hasAlerts ? "medical alert on the record" : null,
    c.feeDue ? "fee to charge" : null,
  ];
  return parts.filter(Boolean).join(", ");
}

export interface DiaryGridProps {
  label: string;
  columns: DiaryColumn[];
  cards: DiaryCard[];
  hours: { start: number; end: number };
  canBook: boolean;
  focusId: string | null;
  busyId: string | null;
  onOpen: (card: DiaryCard) => void;
  onBookAt: (column: DiaryColumn, minute: number) => void;
  onMove: (card: DiaryCard, column: DiaryColumn, minute: number) => void;
}

export function DiaryGrid({ label, columns, cards, hours, canBook, focusId, busyId, onOpen, onBookAt, onMove }: DiaryGridProps) {
  const height = (hours.end - hours.start) * PX_PER_MINUTE;
  const grab = useRef<{ id: string; offset: number } | null>(null);
  const [drop, setDrop] = useState<{ key: string; minute: number } | null>(null);
  const [now, setNow] = useState<{ date: string; minute: number } | null>(null);
  useEffect(() => {
    const tick = () => {
      const p = londonParts(Date.now());
      setNow({ date: p.date, minute: p.minute });
    };
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  const byColumn = useMemo(() => {
    const map = new Map<string, DiaryCard[]>();
    for (const c of cards) map.set(c.columnKey, [...(map.get(c.columnKey) ?? []), c]);
    return map;
  }, [cards]);

  const hourMarks: number[] = [];
  for (let m = hours.start; m <= hours.end; m += 60) hourMarks.push(m);
  const minuteAt = (e: React.MouseEvent<HTMLElement> | React.DragEvent<HTMLElement>, snap: number, offset = 0) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = hours.start + (e.clientY - rect.top - offset) / PX_PER_MINUTE;
    const snapped = Math.floor(raw / snap) * snap;
    return Math.max(hours.start, Math.min(hours.end - snap, snapped));
  };
  const lines = `repeating-linear-gradient(to bottom, rgb(203 213 225) 0, rgb(203 213 225) 1px, transparent 1px, transparent ${30 * PX_PER_MINUTE}px)`;

  return (
    <div role="region" aria-label={label} tabIndex={0} className="relative max-h-[78vh] overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">
      <div className="grid min-w-max" style={{ gridTemplateColumns: `3.25rem repeat(${columns.length}, minmax(9.5rem, 1fr))` }}>
        <div className="sticky left-0 top-0 z-30 border-b border-slate-200 bg-white" aria-hidden />
        {columns.map((c) => (
          <div key={c.key} className="sticky top-0 z-20 border-b border-l border-slate-200 bg-white px-2 py-1.5">
            <div className="flex items-start justify-between gap-1">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{c.label}</p>
                {c.sublabel ? <p className="truncate text-xs text-slate-600">{c.sublabel}</p> : null}
              </div>
              {canBook ? (
                <button
                  type="button"
                  onClick={() => onBookAt(c, c.windows[0]?.startMinute ?? Math.max(hours.start, 9 * 60))}
                  aria-label={`Book an appointment: ${c.label}, ${formatDayHeading(c.date)}`}
                  className="shrink-0 rounded-md border border-teal-300 px-1.5 py-0.5 text-xs font-semibold text-teal-800 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
                >
                  + Book
                </button>
              ) : null}
            </div>
          </div>
        ))}

        <div className="sticky left-0 z-10 border-r border-slate-200 bg-white" style={{ height }} aria-hidden>
          {hourMarks.map((m) => (
            <span key={m} className="absolute right-1 -translate-y-1/2 text-[11px] tabular-nums text-slate-600" style={{ top: (m - hours.start) * PX_PER_MINUTE }}>
              {m === hours.start ? "" : formatHhmm(m)}
            </span>
          ))}
        </div>

        {columns.map((c) => {
          const items = byColumn.get(c.key) ?? [];
          const boxes = new Map(layoutColumn(items, c.date, hours.start, hours.end).map((b) => [b.id, b]));
          return (
            <div
              key={c.key}
              data-column={c.key}
              className={cn("relative border-l border-slate-200 bg-slate-100", canBook && "cursor-copy")}
              style={{ height }}
              onClick={(e) => {
                if (!canBook || e.target !== e.currentTarget) return;
                onBookAt(c, minuteAt(e, SNAP_CLICK));
              }}
              onDragOver={(e) => {
                if (!grab.current) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const minute = minuteAt(e, SNAP_DROP, grab.current.offset);
                setDrop((d) => (d && d.key === c.key && d.minute === minute ? d : { key: c.key, minute }));
              }}
              onDragLeave={(e) => {
                if (e.currentTarget === e.target) setDrop(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const g = grab.current;
                setDrop(null);
                grab.current = null;
                const card = g ? cards.find((x) => x.id === g.id) : undefined;
                if (card && g) onMove(card, c, minuteAt(e, SNAP_DROP, g.offset));
              }}
            >
              {c.windows.map((w, i) => (
                <div key={i} aria-hidden className="pointer-events-none absolute inset-x-0 bg-white" style={{ top: (Math.max(w.startMinute, hours.start) - hours.start) * PX_PER_MINUTE, height: (Math.min(w.endMinute, hours.end) - Math.max(w.startMinute, hours.start)) * PX_PER_MINUTE }} />
              ))}
              <div aria-hidden className="pointer-events-none absolute inset-0" style={{ backgroundImage: lines }} />
              {now && now.date === c.date && now.minute >= hours.start && now.minute <= hours.end ? (
                <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500" style={{ top: (now.minute - hours.start) * PX_PER_MINUTE }} />
              ) : null}
              {drop && drop.key === c.key ? (
                <div aria-hidden className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-dashed border-teal-700" style={{ top: (drop.minute - hours.start) * PX_PER_MINUTE }}>
                  <span className="ml-1 rounded bg-teal-700 px-1 text-[11px] font-semibold text-white">{formatHhmm(drop.minute)}</span>
                </div>
              ) : null}
              {items.map((card) => {
                const box = boxes.get(card.id);
                if (!box) return null;
                const movable = canBook && canMove(card.status);
                return (
                  <button
                    key={card.id}
                    type="button"
                    data-card={card.id}
                    draggable={movable}
                    aria-label={cardLabel(card)}
                    aria-describedby={movable ? "diary-keys-hint" : undefined}
                    aria-busy={busyId === card.id || undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(card);
                    }}
                    onDragStart={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      grab.current = { id: card.id, offset: e.clientY - rect.top };
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", card.id);
                    }}
                    onDragEnd={() => {
                      grab.current = null;
                      setDrop(null);
                    }}
                    onKeyDown={(e) => {
                      if (!movable || !e.altKey) return;
                      const index = columns.findIndex((x) => x.key === c.key);
                      const start = localSpan(card, card.startsOn).start;
                      const step: Record<string, [number, number]> = { ArrowUp: [-15, 0], ArrowDown: [15, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
                      const s = step[e.key];
                      if (!s) return;
                      e.preventDefault();
                      const target = columns[index + s[1]];
                      if (!target) return;
                      onMove(card, target, start + s[0]);
                    }}
                    className={cn(
                      "absolute z-10 overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-left text-[11px] leading-tight text-slate-900 shadow-sm hover:shadow focus-visible:z-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-1",
                      cardClass(card.kind, card.status),
                      focusId === card.id && "ring-2 ring-teal-700 ring-offset-1",
                      busyId === card.id && "animate-pulse",
                      movable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                    )}
                    style={{
                      top: box.top * PX_PER_MINUTE + 1,
                      height: Math.max(14, box.height * PX_PER_MINUTE - 2),
                      left: `calc(${(box.lane / box.lanes) * 100}% + 2px)`,
                      width: `calc(${100 / box.lanes}% - 4px)`,
                    }}
                  >
                    <span className="flex items-baseline gap-1">
                      <span className="shrink-0 font-semibold tabular-nums">{card.timeLabel.slice(0, 5)}</span>
                      <span className={cn("truncate font-semibold", (card.status === "cancelled" || card.status === "late_cancelled") && "line-through")}>
                        {card.kind === "block" ? (card.title ?? (card.blockKind ? BLOCK_KIND_LABELS[card.blockKind] : "Blocked")) : (card.patientName ?? "Patient")}
                      </span>
                    </span>
                    {box.height >= 25 ? (
                      <span className="mt-0.5 flex flex-wrap items-center gap-1">
                        {card.kind === "appointment" ? <span className="truncate text-slate-800">{card.serviceName}</span> : null}
                        <span className={cn("rounded px-1 text-[10px] font-semibold", card.kind === "block" ? "bg-slate-300 text-slate-900" : STATUS_TAG[card.status])}>
                          {card.kind === "block" ? (card.status === "cancelled" ? "Removed" : "Blocked") : STATUS_TAGS[card.status]}
                        </span>
                        {card.hasAlerts ? <span className="rounded bg-red-100 px-1 text-[10px] font-semibold text-red-800">Alert</span> : null}
                        {card.feeDue ? <span className="rounded bg-orange-100 px-1 text-[10px] font-semibold text-orange-900">Fee</span> : null}
                        {card.hasNotes ? <span className="rounded bg-white/70 px-1 text-[10px] font-semibold text-slate-800">Note</span> : null}
                        {card.siteCode && card.columnKey.startsWith("d:") ? <span className="rounded bg-white/70 px-1 text-[10px] font-semibold text-slate-800">{card.siteCode}</span> : null}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
