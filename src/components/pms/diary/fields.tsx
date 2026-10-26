"use client";
/**
 * Small labelled form controls for the diary's dialogs: every control has a <label>, its error sits next to it
 * (aria-describedby + aria-invalid), and the focus ring is visible. Browser-safe.
 */
import { cn } from "@/lib/utils";

const CONTROL =
  "block w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30 disabled:bg-slate-50 disabled:text-slate-500";

interface BaseProps {
  id: string;
  label: string;
  error?: string;
  hint?: React.ReactNode;
  className?: string;
}

function described(id: string, error?: string, hint?: React.ReactNode): string | undefined {
  const ids = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

function Messages({ id, error, hint }: { id: string; error?: string; hint?: React.ReactNode }) {
  return (
    <>
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
    </>
  );
}

export function TextField({
  id,
  label,
  error,
  hint,
  className,
  ...input
}: BaseProps & Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "className">) {
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-800">
        {label}
      </label>
      <input id={id} aria-invalid={error ? true : undefined} aria-describedby={described(id, error, hint)} className={cn(CONTROL, "h-10")} {...input} />
      <Messages id={id} error={error} hint={hint} />
    </div>
  );
}

export function SelectField({
  id,
  label,
  error,
  hint,
  className,
  children,
  ...select
}: BaseProps & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "id" | "className">) {
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-800">
        {label}
      </label>
      <select id={id} aria-invalid={error ? true : undefined} aria-describedby={described(id, error, hint)} className={cn(CONTROL, "h-10")} {...select}>
        {children}
      </select>
      <Messages id={id} error={error} hint={hint} />
    </div>
  );
}

export function TextAreaField({
  id,
  label,
  error,
  hint,
  className,
  ...area
}: BaseProps & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "className">) {
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-800">
        {label}
      </label>
      <textarea id={id} aria-invalid={error ? true : undefined} aria-describedby={described(id, error, hint)} className={cn(CONTROL, "min-h-[72px] py-2")} {...area} />
      <Messages id={id} error={error} hint={hint} />
    </div>
  );
}

export function CheckboxField({ id, label, hint, className, ...input }: Omit<BaseProps, "error"> & Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "className" | "type">) {
  return (
    <div className={cn("flex items-start gap-2", className)}>
      <input id={id} type="checkbox" aria-describedby={hint ? `${id}-hint` : undefined} className="mt-0.5 h-4 w-4 rounded border-slate-400 text-teal-700 focus:ring-2 focus:ring-teal-600" {...input} />
      <div>
        <label htmlFor={id} className="text-sm font-medium text-slate-800">
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

export function ActionButton({
  variant = "primary",
  className,
  ...button
}: { variant?: "primary" | "secondary" | "danger" | "quiet" } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles = {
    primary: "bg-teal-700 text-white hover:bg-teal-800 focus-visible:ring-teal-700",
    secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 focus-visible:ring-slate-500",
    danger: "border border-red-300 bg-white text-red-700 hover:bg-red-50 focus-visible:ring-red-600",
    quiet: "text-teal-800 underline-offset-4 hover:underline focus-visible:ring-teal-700",
  }[variant];
  return (
    <button
      type="button"
      className={cn(
        "inline-flex min-h-[40px] items-center justify-center rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
        variant === "quiet" ? "min-h-0 px-1" : "shadow-sm",
        styles,
        className,
      )}
      {...button}
    />
  );
}

/** Errors and clashes from an action, in one alert. */
export function ActionError({ error, details }: { error: string | null; details?: string[] }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      <p className="font-medium">{error}</p>
      {details && details.length ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
