/** Layout pieces for the sign-in pages and the clinic settings area (server-safe). */
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PRODUCT_NAME } from "@/lib/account-copy";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold text-slate-900", className)}>
      <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-600 text-xs font-bold text-white">
        CF
      </span>
      {PRODUCT_NAME}
    </span>
  );
}

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-start justify-center bg-slate-50 px-4 py-12 text-slate-900 sm:items-center">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Link href="/" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" aria-label={`${PRODUCT_NAME} home`}>
            <BrandMark />
          </Link>
        </div>
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
          <div className="mt-6">{children}</div>
        </section>
        {footer ? <div className="mt-4 text-center text-sm text-slate-600">{footer}</div> : null}
      </div>
    </main>
  );
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-teal-700 underline-offset-4 hover:underline">
      {children}
    </Link>
  );
}

export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  required,
  defaultValue,
  hint,
  readOnly,
  inputMode,
  maxLength,
  minLength,
  pattern,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  defaultValue?: string | number;
  hint?: React.ReactNode;
  readOnly?: boolean;
  inputMode?: "numeric" | "text" | "email" | "tel";
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  placeholder?: string;
}) {
  const id = `f-${name}`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-800">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        defaultValue={defaultValue}
        readOnly={readOnly}
        inputMode={inputMode}
        maxLength={maxLength}
        minLength={minLength}
        pattern={pattern}
        placeholder={placeholder}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={cn(
          "block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400",
          "focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30",
          readOnly && "bg-slate-50 text-slate-600",
        )}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "success" | "warning" | "error"; children: React.ReactNode }) {
  const styles = {
    info: "border-slate-200 bg-slate-50 text-slate-700",
    success: "border-teal-200 bg-teal-50 text-teal-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    error: "border-red-200 bg-red-50 text-red-800",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-lg border px-3 py-2 text-sm", styles)}>
      {children}
    </div>
  );
}

export function PageHeader({ title, description }: { title: string; description?: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description ? <p className="mt-1 max-w-2xl text-sm text-slate-600">{description}</p> : null}
    </div>
  );
}

export function Panel({ title, description, children, className }: { title?: string; description?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6", className)}>
      {title ? <h2 className="text-base font-semibold">{title}</h2> : null}
      {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
      <div className={title || description ? "mt-4" : undefined}>{children}</div>
    </section>
  );
}
