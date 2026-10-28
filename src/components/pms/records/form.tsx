"use client";
/**
 * Form kit of the records screens: a server-action form that shows the action's answer (and moves focus to it), and
 * labelled fields that show their own error next to them (aria-invalid + aria-describedby). Browser-safe.
 */
import { createContext, useContext, useEffect, useId, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";
import type { RecordsActionState } from "@/modules/pms/records/types";
import { inputClasses, pmsButtonVariants } from "@/components/pms/ui";

export type RecordsAction = (prev: RecordsActionState, form: FormData) => Promise<RecordsActionState>;

const ErrorsContext = createContext<Record<string, string>>({});

/** The design system's input (src/components/pms/ui/inputs.tsx); heights are set where it is used. */
export const INPUT_CLASS = inputClasses.replace("h-9 ", "block ");

export function ActionForm({
  action,
  children,
  className,
  successMessage = "Saved.",
  showSuccess = true,
}: {
  action: RecordsAction;
  children: React.ReactNode;
  className?: string;
  successMessage?: string;
  /** false when a successful answer redirects or the page changes anyway. */
  showSuccess?: boolean;
}) {
  const [state, formAction] = useFormState(action, null);
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state && (state.ok === false || showSuccess)) noticeRef.current?.focus();
  }, [state, showSuccess]);
  const errors = state && state.ok === false ? (state.fieldErrors ?? {}) : {};
  return (
    <ErrorsContext.Provider value={errors}>
      <form action={formAction} className={cn("space-y-4", className)}>
        <div ref={noticeRef} tabIndex={-1} className="outline-none">
          {state?.ok === false ? (
            <div role="alert" className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5 text-sm text-[#991B1B]">
              {state.error}
              {Object.keys(errors).length > 0 ? <span className="block text-xs">Check the fields marked below.</span> : null}
            </div>
          ) : null}
          {state?.ok === true && showSuccess ? (
            <div role="status" className="rounded-xl border border-[#A7E8BE] bg-[#F0FDF4] px-3.5 py-2.5 text-sm text-[#166534]">
              {state.message ?? successMessage}
            </div>
          ) : null}
        </div>
        {children}
      </form>
    </ErrorsContext.Provider>
  );
}

function useField(name: string, hint?: React.ReactNode) {
  const errors = useContext(ErrorsContext);
  const base = useId();
  const id = `${base}-${name}`;
  const error = errors[name];
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return { id, error, describedBy };
}

function Hint({ id, children }: { id: string; children?: React.ReactNode }) {
  return children ? (
    <p id={`${id}-hint`} className="text-xs text-muted-foreground">
      {children}
    </p>
  ) : null;
}

function FieldError({ id, error }: { id: string; error?: string }) {
  return error ? (
    <p id={`${id}-error`} className="text-xs font-medium text-red-700">
      {error}
    </p>
  ) : null;
}

export function TextField({
  label,
  name,
  type = "text",
  defaultValue,
  required,
  hint,
  autoComplete,
  inputMode,
  maxLength,
  placeholder,
  className,
  disabled,
}: {
  label: string;
  name: string;
  type?: "text" | "email" | "tel" | "date" | "number" | "search";
  defaultValue?: string | number | null;
  required?: boolean;
  hint?: React.ReactNode;
  autoComplete?: string;
  inputMode?: "text" | "numeric" | "decimal" | "email" | "tel";
  maxLength?: number;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const f = useField(name, hint);
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={f.id} className="block text-sm font-medium text-foreground">
        {label}
        {required ? <span className="text-destructive-strong" aria-hidden> *</span> : null}
      </label>
      <input
        id={f.id}
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        required={required}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={f.error ? true : undefined}
        aria-describedby={f.describedBy}
        className={cn(INPUT_CLASS, "h-9")}
      />
      <Hint id={f.id}>{hint}</Hint>
      <FieldError id={f.id} error={f.error} />
    </div>
  );
}

export function TextAreaField({
  label,
  name,
  defaultValue,
  rows = 3,
  hint,
  maxLength,
  required,
  className,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  rows?: number;
  hint?: React.ReactNode;
  maxLength?: number;
  required?: boolean;
  className?: string;
}) {
  const f = useField(name, hint);
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={f.id} className="block text-sm font-medium text-foreground">
        {label}
        {required ? <span className="text-destructive-strong" aria-hidden> *</span> : null}
      </label>
      <textarea
        id={f.id}
        name={name}
        rows={rows}
        defaultValue={defaultValue ?? ""}
        maxLength={maxLength}
        required={required}
        aria-invalid={f.error ? true : undefined}
        aria-describedby={f.describedBy}
        className={cn(INPUT_CLASS, "py-2")}
      />
      <Hint id={f.id}>{hint}</Hint>
      <FieldError id={f.id} error={f.error} />
    </div>
  );
}

export interface Option {
  value: string;
  label: string;
}

export function SelectField({
  label,
  name,
  options,
  defaultValue,
  hint,
  required,
  emptyLabel,
  className,
}: {
  label: string;
  name: string;
  options: readonly Option[];
  defaultValue?: string | null;
  hint?: React.ReactNode;
  required?: boolean;
  /** A first, empty choice ("None", "Choose…"). */
  emptyLabel?: string;
  className?: string;
}) {
  const f = useField(name, hint);
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={f.id} className="block text-sm font-medium text-foreground">
        {label}
        {required ? <span className="text-destructive-strong" aria-hidden> *</span> : null}
      </label>
      <select
        id={f.id}
        name={name}
        defaultValue={defaultValue ?? ""}
        required={required}
        aria-invalid={f.error ? true : undefined}
        aria-describedby={f.describedBy}
        className={cn(INPUT_CLASS, "h-9")}
      >
        {emptyLabel !== undefined ? <option value="">{emptyLabel}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Hint id={f.id}>{hint}</Hint>
      <FieldError id={f.id} error={f.error} />
    </div>
  );
}

export function CheckboxField({ label, name, defaultChecked, hint }: { label: string; name: string; defaultChecked?: boolean; hint?: React.ReactNode }) {
  const f = useField(name, hint);
  return (
    <div className="flex items-start gap-3">
      <input
        id={f.id}
        name={name}
        type="checkbox"
        value="on"
        defaultChecked={defaultChecked}
        aria-invalid={f.error ? true : undefined}
        aria-describedby={f.describedBy}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-400 text-teal-700 focus:ring-2 focus:ring-teal-600"
      />
      <div className="min-w-0">
        <label htmlFor={f.id} className="block text-sm font-medium text-foreground">
          {label}
        </label>
        <Hint id={f.id}>{hint}</Hint>
        <FieldError id={f.id} error={f.error} />
      </div>
    </div>
  );
}

/** A submit button that can carry a name/value (two buttons on one form) and shows the pending state. */
export function Submit({
  children,
  pendingText = "Saving…",
  variant = "primary",
  name,
  value,
  confirmText,
  className,
}: {
  children: React.ReactNode;
  pendingText?: string;
  variant?: "primary" | "secondary" | "danger";
  name?: string;
  value?: string;
  confirmText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  const styles = pmsButtonVariants({ variant: variant === "danger" ? "destructive" : variant });
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      aria-disabled={pending}
      onClick={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
      className={cn(styles, "disabled:opacity-80", className)}
    >
      {pending ? pendingText : children}
    </button>
  );
}

export function Fieldset({ legend, children, description }: { legend: string; children: React.ReactNode; description?: React.ReactNode }) {
  return (
    <fieldset className="space-y-4 rounded-2xl border border-border bg-white p-4">
      <legend className="px-1 text-sm font-semibold text-foreground">{legend}</legend>
      {description ? <p className="-mt-2 text-xs text-muted-foreground">{description}</p> : null}
      {children}
    </fieldset>
  );
}
