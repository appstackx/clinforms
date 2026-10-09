/**
 * Small presentational pieces shared by the sandbox screens (slate/blue clinic-system look).
 *
 * Owner: sandbox agent.
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { SimAppointmentStatus } from "../wire-types";
import { APPOINTMENT_STATUS } from "./format";

export function Panel({
  title,
  description,
  actions,
  children,
  className = "",
  headingLevel = 2,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {title && <Heading className="text-sm font-semibold text-slate-900">{title}</Heading>}
            {description && <p className="mt-0.5 text-xs text-slate-600">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-slate-900">{children ?? <span className="text-slate-400">–</span>}</dd>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100">
        <Icon className="h-5 w-5 text-slate-500" aria-hidden />
      </span>
      <p className="mt-3 text-sm font-medium text-slate-900">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-slate-600">{children}</div>}
    </div>
  );
}

export function StatusChip({ status }: { status: SimAppointmentStatus }) {
  const s = APPOINTMENT_STATUS[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.className}`}
    >
      <span className="font-mono font-semibold">{status}</span>
      <span aria-hidden>·</span>
      <span>{s.label}</span>
    </span>
  );
}

export function Pill({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "blue" }) {
  const cls =
    tone === "blue" ? "bg-blue-50 text-blue-800 ring-blue-600/25" : "bg-slate-100 text-slate-700 ring-slate-500/25";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
      {children}
    </span>
  );
}
