/** Small server-safe pieces of the records screens (no hooks): badges, definition lists, empty states, link buttons. */
import Link from "next/link";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "teal" | "amber" | "red" | "blue";

const TONES: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-800 ring-slate-300",
  teal: "bg-teal-50 text-teal-900 ring-teal-300",
  amber: "bg-amber-50 text-amber-900 ring-amber-300",
  red: "bg-red-50 text-red-800 ring-red-300",
  blue: "bg-sky-50 text-sky-900 ring-sky-300",
};

/** A label in a coloured pill – the words always carry the meaning (never colour alone). */
export function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONES[tone], className)}>{children}</span>;
}

export function DetailList({ items, className }: { items: { label: string; value: React.ReactNode }[]; className?: string }) {
  const shown = items.filter((i) => i.value !== null && i.value !== undefined && i.value !== "");
  if (shown.length === 0) return <p className="text-sm text-slate-600">Nothing recorded.</p>;
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2", className)}>
      {shown.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-600">{i.label}</dt>
          <dd className="mt-0.5 break-words text-slate-900">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-8 text-center">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {children ? <div className="mx-auto mt-1 max-w-md text-sm text-slate-600">{children}</div> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function LinkButton({ href, children, variant = "primary", className }: { href: string; children: React.ReactNode; variant?: "primary" | "secondary"; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-10 items-center justify-center whitespace-nowrap rounded-lg px-4 text-sm font-semibold shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        variant === "primary" ? "bg-teal-700 text-white hover:bg-teal-800 focus-visible:ring-teal-700" : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 focus-visible:ring-slate-500",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function TextLinkTo({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("rounded font-medium text-teal-800 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700", className)}>
      {children}
    </Link>
  );
}

/** A heading row: title on the left, actions on the right (they wrap under it on a phone). */
export function SectionHeader({ title, description, actions, level = 2 }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; level?: 2 | 3 }) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <H className={level === 2 ? "text-lg font-semibold text-slate-900" : "text-base font-semibold text-slate-900"}>{title}</H>
        {description ? <p className="mt-0.5 text-sm text-slate-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** A table that scrolls inside its own box on a narrow screen (the page never scrolls sideways). */
export function TableBox({ children, caption }: { children: React.ReactNode; caption: string }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export const TH = "whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600";
export const TD = "px-3 py-2 align-top text-slate-900";
