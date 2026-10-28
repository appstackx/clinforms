"use client";
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Form controls (design system v1, "Inputs"): 36 px, 8 px radius, #CBD5E1 border (input-strong, 3:1 on white),
 * error border destructive-strong, teal focus ring. Use inside FormField for the label, hint and error.
 */
export const inputClasses =
  "h-9 w-full min-w-0 rounded-[8px] border border-input-strong bg-white px-3 text-sm text-foreground placeholder:text-[#64748B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:bg-[#F8FAFC] disabled:text-[#64748B] aria-[invalid=true]:border-destructive-strong";

export const TextInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, type, ...props }, ref) {
  return <input ref={ref} type={type ?? "text"} className={cn(inputClasses, className)} {...props} />;
});

export const SelectInput = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function SelectInput({ className, children, ...props }, ref) {
  return (
    <div className="relative min-w-0">
      <select ref={ref} className={cn(inputClasses, "appearance-none pr-8", className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" aria-hidden />
    </div>
  );
});

export const TextArea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(inputClasses, "h-auto min-h-[72px] resize-y px-3 py-2", className)} {...props} />;
});

export interface IconInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon: React.ReactNode;
  /** A key hint at the end (e.g. "/" on a search box). */
  kbd?: string;
  boxClassName?: string;
}

/** An input with a leading icon (date, time, search), optionally with a key hint. The ring wraps the whole box. */
export const IconInput = React.forwardRef<HTMLInputElement, IconInputProps>(function IconInput({ icon, kbd, className, boxClassName, ...props }, ref) {
  return (
    <div
      className={cn(
        "flex h-9 min-w-0 items-center gap-2 rounded-[8px] border border-input-strong bg-white px-2.5 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary has-[[aria-invalid=true]]:border-destructive-strong",
        boxClassName,
      )}
    >
      <span className="inline-flex shrink-0 text-[#64748B] [&>svg]:h-4 [&>svg]:w-4" aria-hidden>
        {icon}
      </span>
      <input ref={ref} className={cn("h-full w-full min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-[#64748B] focus:outline-none", className)} {...props} />
      {kbd ? <InlineKbd>{kbd}</InlineKbd> : null}
    </div>
  );
});

/** The small key hint inside a search box. */
export function InlineKbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="shrink-0 rounded-[4px] border border-b-2 border-border bg-white px-[5px] font-sans text-[11px] leading-[18px] text-[#475569]" aria-hidden>
      {children}
    </kbd>
  );
}

export interface ChoiceProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: React.ReactNode;
}

export const Checkbox = React.forwardRef<HTMLInputElement, ChoiceProps>(function Checkbox({ label, className, ...props }, ref) {
  return (
    <label className={cn("flex items-start gap-2 text-sm text-foreground", className)}>
      <input ref={ref} type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[#0B7970] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" {...props} />
      <span>{label}</span>
    </label>
  );
});

export const Radio = React.forwardRef<HTMLInputElement, ChoiceProps>(function Radio({ label, className, ...props }, ref) {
  return (
    <label className={cn("flex items-center gap-2 text-sm text-foreground", className)}>
      <input ref={ref} type="radio" className="m-0 h-4 w-4 shrink-0 accent-[#0B7970] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" {...props} />
      <span>{label}</span>
    </label>
  );
});

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: React.ReactNode;
  /** Show the label next to the switch (default) or only to screen readers. */
  hideLabel?: boolean;
  disabled?: boolean;
  id?: string;
}

/** On/off switch (role="switch"): 40 × 22, teal when on. */
export function Switch({ checked, onCheckedChange, label, hideLabel, disabled, id }: SwitchProps) {
  const autoId = React.useId();
  const labelId = `${id ?? autoId}-label`;
  return (
    <span className="inline-flex items-center gap-2.5 text-sm">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "flex h-[22px] w-10 shrink-0 rounded-full p-0.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60",
          checked ? "justify-end bg-primary-strong" : "justify-start bg-[#CBD5E1]",
        )}
      >
        <span className="h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)]" />
      </button>
      <span id={labelId} className={cn(hideLabel && "sr-only", !checked && "text-[#475569]")}>
        {label}
      </span>
    </span>
  );
}
