import * as React from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FormFieldProps {
  /** The control's id; the label points at it and the hint/error ids derive from it. */
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  /** The error next to the field (red, with an icon, announced). */
  error?: React.ReactNode;
  /** Hide the label visually (it stays for screen readers). */
  hideLabel?: boolean;
  required?: boolean;
  className?: string;
  /**
   * The control. A function gets the ARIA props to spread on it; an element gets them added automatically
   * (`aria-describedby`, `aria-invalid`).
   */
  children: React.ReactElement | ((aria: FieldAria) => React.ReactNode);
}

export interface FieldAria {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
}

/** Label, control, hint and error, 6 px apart (design system v1, "Inputs"). */
export function FormField({ id, label, hint, error, hideLabel, required, className, children }: FormFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const aria: FieldAria = {
    id,
    "aria-describedby": [errorId, hintId].filter(Boolean).join(" ") || undefined,
    "aria-invalid": error ? true : undefined,
    "aria-required": required ? true : undefined,
  };
  const control = typeof children === "function" ? children(aria) : React.cloneElement(children, aria);
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className={cn("text-sm font-medium text-foreground", hideLabel && "sr-only")}>
        {label}
        {required ? <span className="sr-only"> (required)</span> : null}
      </label>
      {control}
      {error ? (
        <span id={errorId} role="alert" className="flex items-center gap-1 text-xs text-destructive-strong">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </span>
      ) : null}
      {hint ? (
        <span id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
