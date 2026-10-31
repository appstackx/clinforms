import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type StepState = "done" | "current" | "upcoming";

/** Each step's state for a 0-based current step (past steps done, later ones upcoming). */
export function stepStates(count: number, current: number): StepState[] {
  return Array.from({ length: count }, (_, i) => (i < current ? "done" : i === current ? "current" : "upcoming"));
}

export interface StepIndicatorProps {
  /** Step names, in order ("Clinic", "Service", …). */
  steps: readonly string[];
  /** The 0-based current step. */
  current: number;
  /** What the steps are of ("Booking steps"). */
  label: string;
  className?: string;
}

/**
 * Step indicator (brief Part A – online booking, import): numbered steps with a tick when done, the current one in
 * teal with aria-current="step"; state is in the words too (screen readers hear "done" / "current step"), never colour
 * alone. On a phone it collapses to "Step 2 of 6 · Service" and a progress bar, so six steps never overflow 375 px.
 * Display only – going back is the screen's own Back button.
 */
export function StepIndicator({ steps, current, label, className }: StepIndicatorProps) {
  const states = stepStates(steps.length, current);
  const at = Math.min(Math.max(current, 0), steps.length - 1);
  return (
    <nav aria-label={label} className={cn("min-w-0", className)}>
      <ol className="hidden flex-wrap items-center gap-x-2 gap-y-2 sm:flex">
        {steps.map((name, i) => {
          const s = states[i];
          return (
            <li key={name} aria-current={s === "current" ? "step" : undefined} className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                  s === "done" && "bg-primary-strong text-white",
                  s === "current" && "border-2 border-primary-strong bg-white text-primary-strong",
                  s === "upcoming" && "border border-input-strong bg-white text-[#475569]",
                )}
              >
                {s === "done" ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={cn("whitespace-nowrap text-[13px]", s === "current" ? "font-semibold text-foreground" : s === "done" ? "text-foreground" : "text-[#475569]")}>
                {name}
                {s !== "upcoming" ? <span className="sr-only">{s === "done" ? " (done)" : " (current step)"}</span> : null}
              </span>
              {i < steps.length - 1 ? <span aria-hidden className={cn("h-px w-6 shrink-0", s === "done" ? "bg-primary-strong" : "bg-input-strong")} /> : null}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-col gap-1.5 sm:hidden">
        <p className="text-[13px] text-[#334155]">
          <span className="font-semibold text-foreground">
            Step {at + 1} of {steps.length}
          </span>{" "}
          · {steps[at]}
        </p>
        <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-[#E2E8F0]">
          <div className="h-full rounded-full bg-primary-strong" style={{ width: `${((at + 1) / steps.length) * 100}%` }} />
        </div>
      </div>
    </nav>
  );
}
