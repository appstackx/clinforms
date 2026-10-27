import * as React from "react";
import { cn } from "@/lib/utils";
import { statusStyle, TONE_CLASSES, type StatusKind } from "./status";
import { StatusIconGlyph } from "./status-icon";

export interface StatusPillProps {
  kind: StatusKind;
  /** The stored status ("booked", "part_paid", "signed"…). */
  status: string;
  /** Replaces the word (e.g. "Arrived 10:27"); the colour and icon still come from the status. */
  label?: string;
  /** "md" = 24 px with a border (lists of states); "sm" = 22 px, no border (inside tables, cards and drawers). */
  size?: "md" | "sm";
  className?: string;
}

/** A status as colour + icon + word, never wrapping (design system v1, "Status pills"). */
export function StatusPill({ kind, status, label, size = "md", className }: StatusPillProps) {
  const style = statusStyle(kind, status);
  const tone = TONE_CLASSES[style.tone];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-[5px] whitespace-nowrap rounded-full text-xs font-medium",
        size === "md" ? cn("h-6 border pl-[7px] pr-[9px]", tone.border) : "h-[22px] pl-1.5 pr-2",
        tone.fill,
        tone.text,
        style.strike && "line-through",
        className,
      )}
    >
      <StatusIconGlyph icon={style.icon} />
      {label ?? style.label}
    </span>
  );
}

export interface FlagPillProps {
  /** "alert" = amber, bold (a clinical alert); "flag" = neutral (initial, insured, quiet hours…). */
  variant?: "alert" | "flag";
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** Alerts and flags on a patient or appointment (square-ish, so they never read as a status). */
export function FlagPill({ variant = "flag", icon, children, className }: FlagPillProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-[5px] whitespace-nowrap rounded-[6px] pl-[7px] pr-[9px] text-xs",
        variant === "alert" ? "bg-[#FEF3C7] font-semibold text-[#864E0E]" : "bg-[#F1F5F9] font-medium text-[#334155]",
        className,
      )}
    >
      {icon ? <span className="inline-flex [&>svg]:h-3 [&>svg]:w-3" aria-hidden>{icon}</span> : null}
      {children}
    </span>
  );
}
