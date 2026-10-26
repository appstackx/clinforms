"use client";
/**
 * Form kit of the set-up screens (client): a form bound to a server action that returns a FormResult, and
 * labelled fields that show their own error next to them (role="alert" on the summary, aria-invalid and
 * aria-describedby on the field). Actions are passed in as props by the server pages.
 */
import { createContext, useContext, useEffect, useId, useRef } from "react";
import { useFormState } from "react-dom";
import { Notice } from "@/components/account/shell";
import { SubmitButton } from "@/components/account/form-controls";
import type { FormResult } from "@/modules/pms/reporting/forms";
import { cn } from "@/lib/utils";

export type FormAction = (prev: FormResult | null, form: FormData) => Promise<FormResult>;

const ResultContext = createContext<FormResult | null>(null);

export const INPUT_CLASS =
  "block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-500 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30 aria-[invalid=true]:border-red-500 disabled:bg-slate-50 disabled:text-slate-600";

export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = "Saving…",
  successText = "Saved.",
  resetOnSuccess = false,
  className,
  variant = "primary",
  confirmText,
  hidden,
  compact = false,
}: {
  action: FormAction;
  children?: React.ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  successText?: string;
  resetOnSuccess?: boolean;
  className?: string;
  variant?: "primary" | "secondary" | "danger";
  confirmText?: string;
  /** Hidden fields (ids, revisions). */
  hidden?: Record<string, string | number>;
  /** A one-button form (remove, switch off): messages inline, smaller button. */
  compact?: boolean;
}) {
  const [result, run] = useFormState(action, null as FormResult | null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (result?.ok && resetOnSuccess) ref.current?.reset();
  }, [result, resetOnSuccess]);
  return (
    <ResultContext.Provider value={result}>
      <form ref={ref} action={run} className={cn(compact ? "inline-flex flex-wrap items-center gap-2" : "space-y-4", className)} noValidate>
        {hidden ? Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />) : null}
        {!compact && result?.ok === false ? <Notice tone="error">{result.error}</Notice> : null}
        {!compact && result?.ok === true ? <Notice tone="success">{result.message ?? successText}</Notice> : null}
        {children}
        <div className={compact ? "" : "pt-1"}>
          <SubmitButton pendingText={pendingLabel} variant={variant} confirmText={confirmText} className={compact ? "h-8 px-3 text-xs" : undefined}>
            {submitLabel}
          </SubmitButton>
        </div>
        {compact && result?.ok === false ? (
          <span role="alert" className="text-xs font-medium text-red-700">
            {result.error}
          </span>
        ) : null}
        {compact && result?.ok === true && result.message ? (
          <span role="status" className="text-xs text-teal-800">
            {result.message}
          </span>
        ) : null}
      </form>
    </ResultContext.Provider>
  );
}

function useFieldError(name: string): string | undefined {
  const result = useContext(ResultContext);
  return result && !result.ok ? result.fieldErrors?.[name] : undefined;
}

function FieldShell({ id, label, hint, error, children, className }: { id: string; label: React.ReactNode; hint?: React.ReactNode; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-800">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-slate-600">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, hint: unknown, error: unknown): string | undefined {
  return [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
}

export function TextInput({
  name,
  label,
  defaultValue,
  hint,
  type = "text",
  required,
  maxLength,
  inputMode,
  placeholder,
  errorKey,
  className,
  autoComplete,
  step,
  min,
  max,
  disabled,
}: {
  name: string;
  label: React.ReactNode;
  defaultValue?: string | number | null;
  hint?: React.ReactNode;
  type?: string;
  required?: boolean;
  maxLength?: number;
  inputMode?: "numeric" | "decimal" | "text" | "email" | "tel";
  placeholder?: string;
  /** The schema's field name when it differs from the form's. */
  errorKey?: string;
  className?: string;
  autoComplete?: string;
  step?: number;
  min?: number | string;
  max?: number | string;
  disabled?: boolean;
}) {
  const id = useId();
  const error = useFieldError(errorKey ?? name);
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} className={className}>
      <input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        required={required}
        maxLength={maxLength}
        inputMode={inputMode}
        placeholder={placeholder}
        autoComplete={autoComplete ?? "off"}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={INPUT_CLASS}
      />
    </FieldShell>
  );
}

export function TextArea({ name, label, defaultValue, hint, rows = 3, maxLength, errorKey, className }: { name: string; label: React.ReactNode; defaultValue?: string | null; hint?: React.ReactNode; rows?: number; maxLength?: number; errorKey?: string; className?: string }) {
  const id = useId();
  const error = useFieldError(errorKey ?? name);
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} className={className}>
      <textarea
        id={id}
        name={name}
        rows={rows}
        defaultValue={defaultValue ?? ""}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(INPUT_CLASS, "h-auto py-2")}
      />
    </FieldShell>
  );
}

export interface Option {
  value: string;
  label: string;
}

export function SelectInput({ name, label, options, defaultValue, hint, errorKey, className, disabled }: { name: string; label: React.ReactNode; options: Option[]; defaultValue?: string | null; hint?: React.ReactNode; errorKey?: string; className?: string; disabled?: boolean }) {
  const id = useId();
  const error = useFieldError(errorKey ?? name);
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} className={className}>
      <select id={id} name={name} defaultValue={defaultValue ?? ""} disabled={disabled} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} className={INPUT_CLASS}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function Checkbox({ name, label, defaultChecked, hint, value = "on" }: { name: string; label: React.ReactNode; defaultChecked?: boolean; hint?: React.ReactNode; value?: string }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        name={name}
        type="checkbox"
        value={value}
        defaultChecked={defaultChecked}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-400 text-teal-700 focus:ring-2 focus:ring-teal-600"
      />
      <div>
        <label htmlFor={id} className="block text-sm font-medium text-slate-800">
          {label}
        </label>
        {hint ? (
          <p id={`${id}-hint`} className="text-xs text-slate-600">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** A group of checkboxes with one legend (e.g. the sites a member works at). */
export function CheckboxGroup({ name, legend, options, checked, hint, errorKey }: { name: string; legend: string; options: Option[]; checked: readonly string[]; hint?: React.ReactNode; errorKey?: string }) {
  const id = useId();
  const error = useFieldError(errorKey ?? name);
  return (
    <fieldset className="space-y-2" aria-describedby={describedBy(id, hint, error)}>
      <legend className="text-sm font-medium text-slate-800">{legend}</legend>
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-slate-600">
          {hint}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm text-slate-800">
            <input type="checkbox" name={name} value={o.value} defaultChecked={checked.includes(o.value)} className="h-4 w-4 rounded border-slate-400 text-teal-700 focus:ring-2 focus:ring-teal-600" />
            {o.label}
          </label>
        ))}
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
