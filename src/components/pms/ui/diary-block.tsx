"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { blockLines, blockMinutes, diaryBlockStyle, type DiaryBlockStatus } from "./diary-block-model";
import { StatusIconGlyph } from "./status-icon";

export interface DiaryBlockProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  status: DiaryBlockStatus;
  /** "09:00" */
  start: string;
  /** "09:45" */
  end: string;
  /** Patient name, or what the blocked time is ("Lunch"). */
  title: string;
  /** Appointment type ("Follow-up"), or "Not bookable" for blocked time. */
  detail?: string;
  /** Type marker: a first appointment shows "+" before the type. */
  initial?: boolean;
  /** Selected or being moved by keyboard (teal outline). */
  selected?: boolean;
  /** Height in px (the diary grid sets it from the length). Default 76. */
  heightPx?: number;
  /**
   * A small marker shown IN the top line, before the status (e.g. the diary's "Double-booked" icon) – part of the
   * line's flow, so it never covers the time, name or status however short the block is. Decorative: say the same
   * thing in the block's description.
   */
  marker?: React.ReactNode;
}

/**
 * An appointment (or blocked time) in the diary (design system v1, "Diary appointment blocks"): time, patient,
 * type with its marker, and status as icon + word. 15 minutes or less collapse to one line; cancelled and late
 * cancellations are hatched so the slot reads as free. A button: the diary opens the details on click / Enter.
 */
export const DiaryBlock = React.forwardRef<HTMLButtonElement, DiaryBlockProps>(function DiaryBlock(
  { status, start, end, title, detail, initial, selected, heightPx, marker, className, style, ...props },
  ref,
) {
  const look = diaryBlockStyle(status);
  const minutes = blockMinutes(start, end);
  // Lines that fit the block's height (15 minutes or less, or too short for two lines, collapse to one).
  const lines = blockLines(heightPx, minutes);
  const collapsed = lines === 1;
  const time = `${start}–${end}`;
  // The accessible name is the visible text (WCAG 2.5.3, label in name) plus a few words only screen readers get:
  // the full status where the block shows a short tag ("DNA" → "did not attend"), and on a one-line block the end
  // time, the type and the status.
  const fullStatus = look.label !== look.tag ? <span className="sr-only"> ({look.label.toLowerCase()})</span> : null;
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected ? true : undefined}
      data-status={status}
      className={cn(
        "flex w-full flex-col gap-0.5 overflow-hidden rounded-[8px] border text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        collapsed ? "justify-center px-2 py-0.5" : "px-2 py-1.5",
        look.classes,
        selected && "border-primary shadow-[0_0_0_1px_hsl(var(--primary))]",
        className,
      )}
      style={{ height: heightPx ?? (collapsed ? 26 : 76), ...style }}
      {...props}
    >
      {collapsed ? (
        <span className="flex w-full min-w-0 items-center gap-1.5 text-xs leading-4">
          <span className="shrink-0 font-semibold tabular-nums">
            {start}
            <span className="sr-only">–{end},</span>
          </span>
          <span className={cn("min-w-0 flex-1 truncate font-semibold", look.strikeName && "line-through")}>
            {title}
            <span className="sr-only">
              {detail ? `, ${initial ? "initial: " : ""}${detail}` : ""}, {look.label}
            </span>
          </span>
          {marker}
          <StatusIconGlyph icon={look.icon} className="h-3 w-3 shrink-0" />
        </span>
      ) : (
        <>
          <span className="flex w-full items-center gap-1.5 text-xs leading-4">
            <span className="min-w-0 shrink truncate font-semibold tabular-nums">{time}</span>
            {marker ? <span className="ml-auto inline-flex shrink-0">{marker}</span> : null}
            {/* The status word gives way (truncates) before anything overflows a narrow block; the icon stays. */}
            <span className={cn("inline-flex min-w-0 shrink items-center gap-[3px] whitespace-nowrap font-semibold", !marker && "ml-auto")}>
              <StatusIconGlyph icon={look.icon} className="h-3 w-3 shrink-0" />
              <span className="min-w-0 truncate">{look.tag}</span>
              {fullStatus}
            </span>
          </span>
          <span className={cn("w-full truncate text-[13px] font-semibold", lines === 2 ? "leading-4" : "leading-[18px]", look.strikeName && "line-through")}>
            {title}
            {detail && lines !== 3 ? <span className="sr-only">, {initial ? "initial: " : ""}{detail}</span> : null}
          </span>
          {detail && lines === 3 ? (
            <span className="w-full truncate text-xs leading-4">
              {initial ? (
                <>
                  <span aria-hidden>+ </span>
                  <span className="sr-only">Initial: </span>
                </>
              ) : null}
              {detail}
            </span>
          ) : null}
        </>
      )}
    </button>
  );
});
