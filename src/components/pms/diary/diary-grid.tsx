"use client";
/**
 * The diary's time grid (design round 2): one column per practitioner or room (day view) or per date (week view),
 * 15 minutes = 20 px, hour lines, the hours outside the rota shaded, blocked time hatched, the current-time line,
 * every appointment as the kit's DiaryBlock. A block opens its details on click / Enter; drag a block to move it
 * or its bottom edge to change its length (snapped to 15 minutes); click an empty slot to book it. Keyboard moves
 * and resizes are handled by the screen (onBlockKey) – this component draws the preview it is given.
 */
import * as React from "react";
import { AlertTriangle, Ban, CopyPlus, Globe } from "lucide-react";
import { DOUBLE_BOOKED_LABEL } from "@/modules/pms/diary/copy";
import type { DiaryCard, DiaryColumn } from "@/modules/pms/diary/view";
import { formatHhmm } from "@/modules/pms/diary/time";
import { layoutColumn } from "@/modules/pms/diary/rules";
import { cn } from "@/lib/utils";
import { DiaryBlock } from "../ui/diary-block";
import { PmsAvatar } from "../ui/pms-avatar";
import { blockStatusOf, cardSpan, clampLength, clampStart, hourMarks, minutesToPx, offRotaBands, pxToMinutes, snap } from "./grid-model";

export interface GridPreview {
  id: string;
  columnIndex: number;
  start: number;
  length: number;
  clash: boolean;
}

export interface DiaryGridProps {
  label: string;
  view: "day" | "week";
  columns: DiaryColumn[];
  cards: DiaryCard[];
  grid: { start: number; end: number };
  /** Column headers: day view shows the resource with avatar and "% booked"; week view the date and count. */
  header: (column: DiaryColumn, index: number) => React.ReactNode;
  today: string;
  /** Minutes after midnight now (UK) – null to hide the line. */
  nowMinute: number | null;
  selectedId: string | null;
  preview: GridPreview | null;
  canBook: boolean;
  /** Week view: shorter blocks (time + name only). */
  compact?: boolean;
  onOpen: (id: string) => void;
  onBlockKey: (e: React.KeyboardEvent<HTMLButtonElement>, card: DiaryCard, columnIndex: number) => void;
  onSlot: (columnIndex: number, minute: number) => void;
  /** A drag finished (mouse or touch): the screen saves it and offers Undo. */
  onDrop: (card: DiaryCard, change: { columnIndex: number; start: number; length: number; resize: boolean }) => void;
  /** Live clash check for drag previews. */
  clashAt: (cardId: string, columnIndex: number, start: number, length: number) => boolean;
  blockRef: (id: string, el: HTMLButtonElement | null) => void;
}

interface DragState {
  card: DiaryCard;
  resize: boolean;
  fromColumn: number;
  originY: number;
  originX: number;
  start: number;
  length: number;
  moved: boolean;
  preview: GridPreview;
}

const GUTTER = 56;

export function DiaryGrid(props: DiaryGridProps) {
  const { label, view, columns, cards, grid, header, today, nowMinute, selectedId, preview, canBook, compact, onOpen, onBlockKey, onSlot, onDrop, clashAt, blockRef } = props;
  const height = minutesToPx(grid.end - grid.start);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const colRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const suppressClick = React.useRef(false);
  const marks = hourMarks(grid);

  const columnAt = (clientX: number): number => {
    for (let i = 0; i < colRefs.current.length; i++) {
      const r = colRefs.current[i]?.getBoundingClientRect();
      if (r && clientX >= r.left && clientX < r.right) return i;
    }
    return -1;
  };

  const startDrag = (e: React.PointerEvent, card: DiaryCard, columnIndex: number, resize: boolean) => {
    if (!canBook || e.button !== 0 || card.kind !== "appointment" || !(card.status === "booked" || card.status === "arrived")) return;
    const span = cardSpan(card, columns[columnIndex].date);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({
      card,
      resize,
      fromColumn: columnIndex,
      originY: e.clientY,
      originX: e.clientX,
      start: span.start,
      length: span.end - span.start,
      moved: false,
      preview: { id: card.id, columnIndex, start: span.start, length: span.end - span.start, clash: false },
    });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const dy = e.clientY - drag.originY;
    const dx = e.clientX - drag.originX;
    if (!drag.moved && Math.abs(dy) < 5 && Math.abs(dx) < 5) return;
    const delta = snap(pxToMinutes(dy));
    let next: GridPreview;
    if (drag.resize) {
      const length = clampLength(drag.length + delta, drag.start, grid);
      next = { ...drag.preview, length, clash: clashAt(drag.card.id, drag.fromColumn, drag.start, length) };
    } else {
      const col = columnAt(e.clientX);
      const columnIndex = col >= 0 ? col : drag.preview.columnIndex;
      const start = clampStart(drag.start + delta, drag.length, grid);
      next = { id: drag.card.id, columnIndex, start, length: drag.length, clash: clashAt(drag.card.id, columnIndex, start, drag.length) };
    }
    setDrag({ ...drag, moved: true, preview: next });
  };

  const onPointerUp = () => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (!d.moved) return;
    suppressClick.current = true;
    window.setTimeout(() => (suppressClick.current = false), 0);
    const p = d.preview;
    const unchanged = d.resize ? p.length === d.length : p.start === d.start && p.columnIndex === d.fromColumn;
    if (!unchanged) onDrop(d.card, { columnIndex: p.columnIndex, start: d.resize ? d.start : p.start, length: p.length, resize: d.resize });
  };

  const shown = drag?.moved ? drag.preview : preview;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white">
      <div className="overflow-x-auto" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setDrag(null)}>
        <div style={{ minWidth: GUTTER + columns.length * (view === "week" ? 120 : 180) }}>
          <div className="sticky top-0 z-[3] flex border-b border-border bg-white">
            <div style={{ width: GUTTER }} className="shrink-0" />
            {columns.map((c, i) => (
              <div key={c.key} className={cn("min-w-0 flex-1 border-l border-border px-3 py-2.5", view === "week" && c.date === today && "bg-[#F0FDFA]")}>
                {header(c, i)}
              </div>
            ))}
          </div>
          <div ref={bodyRef} className="relative flex" style={{ height }}>
            <div aria-hidden className="relative shrink-0" style={{ width: GUTTER }}>
              {marks.map((m) => (
                <span key={m.minute} className="absolute right-2 -translate-y-1/2 text-xs tabular-nums text-[#475569]" style={{ top: Math.max(8, m.top) }}>
                  {m.label}
                </span>
              ))}
              {nowMinute !== null && nowMinute >= grid.start && nowMinute <= grid.end && columns.some((c) => c.date === today) ? (
                <span className="absolute right-1 z-[2] -translate-y-1/2 rounded-[4px] bg-primary-strong px-1 text-[11px] font-semibold leading-4 text-white" style={{ top: minutesToPx(nowMinute - grid.start) }}>
                  {formatHhmm(nowMinute)}
                </span>
              ) : null}
            </div>
            <div role="group" aria-label={label} className="relative flex min-w-0 flex-1">
              {/* hour and quarter lines */}
              <div aria-hidden className="pointer-events-none absolute inset-0">
                {Array.from({ length: Math.round((grid.end - grid.start) / 15) }, (_, q) => (
                  <div key={q} className={cn("absolute inset-x-0 border-t", q % 4 === 0 ? "border-[#E2E8F0]" : "border-[#F1F5F9]")} style={{ top: minutesToPx(q * 15) }} />
                ))}
              </div>
              {columns.map((c, ci) => {
                const mine = cards.filter((x) => x.columnKey === c.key);
                const boxes = layoutColumn(mine.map((x) => ({ id: x.id, startsAt: x.startsAt, endsAt: x.endsAt })), c.date, grid.start, grid.end);
                const boxOf = new Map(boxes.map((b) => [b.id, b]));
                const bands = offRotaBands(c, grid);
                return (
                  <div
                    key={c.key}
                    ref={(el) => {
                      colRefs.current[ci] = el;
                    }}
                    role="group"
                    aria-label={`${c.label}${c.detail ? `, ${c.detail}` : ""}`}
                    className="relative min-w-0 flex-1 border-l border-border"
                    onClick={(e) => {
                      if (!canBook || suppressClick.current || e.target !== e.currentTarget) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const minute = grid.start + Math.floor(pxToMinutes(e.clientY - rect.top) / 15) * 15;
                      onSlot(ci, minute);
                    }}
                  >
                    {bands.map((b, bi) => (
                      <div
                        key={bi}
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 bg-[repeating-linear-gradient(135deg,#F8FAFC_0_6px,#EEF2F6_6px_12px)]"
                        style={{ top: minutesToPx(b.top), height: minutesToPx(b.height) }}
                      />
                    ))}
                    {mine.map((card) => {
                      const box = boxOf.get(card.id);
                      if (!box) return null;
                      const moving = shown && shown.id === card.id;
                      const span = cardSpan(card, c.date);
                      const width = `calc(${100 / box.lanes}% - 8px)`;
                      const left = `calc(${(100 / box.lanes) * box.lane}% + 4px)`;
                      if (card.kind === "block") {
                        return (
                          <button
                            key={card.id}
                            type="button"
                            ref={(el) => blockRef(card.id, el)}
                            onClick={() => onOpen(card.id)}
                            onKeyDown={(e) => onBlockKey(e, card, ci)}
                            aria-label={`${card.title || "Blocked time"}, ${card.timeLabel}, not bookable${card.status === "cancelled" ? " (removed)" : ""}`}
                            className={cn(
                              "absolute z-[1] flex items-start gap-1.5 overflow-hidden rounded-[8px] border border-[#CBD5E1] px-2 py-1.5 text-left text-xs font-semibold text-[#334155] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                              "bg-[repeating-linear-gradient(135deg,#F1F5F9_0_6px,#E2E8F0_6px_12px)]",
                              card.status === "cancelled" && "opacity-60 line-through",
                              selectedId === card.id && "border-2 border-[#0F172A]",
                            )}
                            style={{ top: minutesToPx(box.top) + 1, height: minutesToPx(box.height) - 2, left, width }}
                          >
                            <Ban className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                            <span className="truncate">
                              {card.title || "Blocked"}
                              {compact ? "" : ` · ${card.timeLabel.replace("–", "–")}`}
                            </span>
                          </button>
                        );
                      }
                      const start = formatHhmm(span.start);
                      const end = formatHhmm(span.end % 1440);
                      const name = card.patientName ?? "Appointment";
                      const lengthMin = span.end - span.start;
                      return (
                        <div
                          key={card.id}
                          className={cn("absolute z-[1]", moving && "opacity-40")}
                          style={{ top: minutesToPx(box.top) + 1, height: minutesToPx(box.height) - 2, left, width }}
                        >
                          <DiaryBlock
                            ref={(el) => blockRef(card.id, el)}
                            status={blockStatusOf(card)}
                            start={start}
                            end={end}
                            title={name}
                            detail={!compact && lengthMin >= 45 ? (card.serviceName ?? undefined) : undefined}
                            initial={card.initial}
                            selected={selectedId === card.id}
                            heightPx={Math.max(18, minutesToPx(box.height) - 2)}
                            aria-describedby={`dg-${card.id}`}
                            className={cn("h-full touch-none", lengthMin > 15 && lengthMin < 45 && "gap-0 py-0.5",
                              lengthMin >= 45 && lengthMin < 60 && "gap-0 py-1", selectedId === card.id && "border-2 border-[#0F172A] shadow-none")}
                            onClick={() => {
                              if (!suppressClick.current) onOpen(card.id);
                            }}
                            onKeyDown={(e) => onBlockKey(e, card, ci)}
                            onPointerDown={(e) => startDrag(e, card, ci, false)}
                          />
                          <span id={`dg-${card.id}`} className="sr-only">
                            {[
                              card.practitionerName,
                              card.roomName,
                              card.hasAlerts ? "has an alert" : null,
                              card.source === "online" ? "booked online" : null,
                              card.doubleBookedWith.length > 0 ? `${DOUBLE_BOOKED_LABEL.toLowerCase()} with ${card.doubleBookedWith.map((x) => `${x.patientName ?? "another appointment"} ${x.timeLabel}`).join(", ")}` : null,
                            ]
                              .filter(Boolean)
                              .join(", ")}
                          </span>
                          {card.doubleBookedWith.length > 0 ? (
                            // The clash marker of a logged double-booking (Khuram's decision A) – on both blocks.
                            <span
                              aria-hidden
                              data-double-booked="true"
                              title={`${DOUBLE_BOOKED_LABEL} with ${card.doubleBookedWith.map((x) => `${x.patientName ?? "another appointment"} ${x.timeLabel}`).join(", ")}`}
                              className="pointer-events-none absolute bottom-1 right-1.5 z-[2] inline-flex items-center gap-0.5 rounded-[4px] border border-[#FDBA74] bg-[#FFF7ED] px-1 text-[10px] font-semibold leading-[14px] text-[#9A3412]"
                            >
                              <CopyPlus className="h-2.5 w-2.5" />
                              {lengthMin >= 30 && !compact ? DOUBLE_BOOKED_LABEL : null}
                            </span>
                          ) : null}
                          {(card.hasAlerts || card.source === "online") && lengthMin > 15 ? (
                            <span aria-hidden className="pointer-events-none absolute right-2 top-[22px] flex gap-1 text-[#864E0E]">
                              {card.hasAlerts ? <AlertTriangle className="h-3 w-3" /> : null}
                              {card.source === "online" ? <Globe className="h-3 w-3 text-[#1842B4]" /> : null}
                            </span>
                          ) : null}
                          {canBook && (card.status === "booked" || card.status === "arrived") ? (
                            <span
                              aria-hidden
                              title="Drag to change the length"
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                startDrag(e, card, ci, true);
                              }}
                              className="absolute inset-x-2 bottom-0 h-2 cursor-ns-resize touch-none"
                            >
                              {selectedId === card.id ? <span className="absolute bottom-1 left-1/2 h-[3px] w-6 -translate-x-1/2 rounded-full bg-current opacity-50" /> : null}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                    {shown && shown.columnIndex === ci ? (
                      <div
                        aria-hidden
                        className={cn(
                          "pointer-events-none absolute inset-x-1 z-[5] rounded-[8px] border-2 shadow-[0_10px_24px_rgba(15,23,42,0.22)]",
                          shown.clash ? "border-destructive-strong bg-[#FEF2F2]/80" : "border-primary bg-[#F0FDFA]/80",
                        )}
                        style={{ top: minutesToPx(shown.start - grid.start) + 1, height: minutesToPx(shown.length) - 2 }}
                      >
                        <span className="px-2 text-xs font-semibold tabular-nums">
                          {formatHhmm(shown.start)}–{formatHhmm((shown.start + shown.length) % 1440)}
                        </span>
                      </div>
                    ) : null}
                    {nowMinute !== null && c.date === today && nowMinute >= grid.start && nowMinute <= grid.end ? (
                      <div aria-hidden className="pointer-events-none absolute inset-x-0 z-[4] border-t-2 border-primary-strong" style={{ top: minutesToPx(nowMinute - grid.start) }} />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The day view's column header: avatar, name, then "Room 1 · 53% booked". */
export function ResourceHeader({ name, detail, booked }: { name: string; detail: string | null; booked: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <PmsAvatar name={name} size={32} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-semibold text-foreground" title={name}>
          {name}
        </span>
        <span className="truncate text-xs text-[#475569]">{[detail, booked].filter(Boolean).join(" · ") || "Not on the rota"}</span>
      </span>
    </div>
  );
}
