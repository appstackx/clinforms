"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  /** Accessible name when the label is an icon only. */
  ariaLabel?: string;
}

export interface SegmentedControlProps<T extends string = string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** The group's name ("Diary view"). */
  label: string;
  /** Show the label as a visible caption before the control. */
  showLabel?: boolean;
  size?: "sm" | "default";
  className?: string;
}

/**
 * Segmented control (brief Part A, "Day | Week"): two to five mutually exclusive choices that change the view in place.
 * A radio group – one Tab stop, ←/→ (and ↑/↓) move and choose, Home/End the first/last. 36 px high, 44 px on a
 * phone. For choices that change the URL (the diary's Day | Week links) keep links with aria-current; this is for
 * in-page state.
 */
export function SegmentedControl<T extends string>({ options, value, onChange, label, showLabel, size = "default", className }: SegmentedControlProps<T>) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const labelId = React.useId();
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = options.length;
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % n;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + n) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      {showLabel ? (
        <span id={labelId} className="text-[13px] font-medium text-[#334155]">
          {label}
        </span>
      ) : null}
      <div
        role="radiogroup"
        aria-labelledby={showLabel ? labelId : undefined}
        aria-label={showLabel ? undefined : label}
        onKeyDown={onKeyDown}
        className={cn("inline-flex min-w-0 gap-0.5 rounded-[10px] bg-[#F1F5F9] p-[3px]", size === "sm" ? "h-8" : "h-9", "max-sm:h-auto")}
      >
        {options.map((o, i) => {
          const on = i === index;
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={o.ariaLabel}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(o.value)}
              className={cn(
                "inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 font-medium max-sm:h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&_svg]:h-4 [&_svg]:w-4",
                size === "sm" ? "text-[13px]" : "text-sm",
                on ? "bg-white text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.08)]" : "text-[#475569] hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
