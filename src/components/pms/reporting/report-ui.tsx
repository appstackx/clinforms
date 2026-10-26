/**
 * Building blocks of the report pages (server components, no client code): headline figures, tables with a bar
 * per row, "needs the diary / invoicing" notices, definitions and the download link. Figures are always text;
 * bars only repeat them (single hue, never the only way to read a value). Wide tables scroll inside their box.
 */
import { Notice } from "@/components/account/shell";
import { cn } from "@/lib/utils";

export function StatTile({ label, value, hint, compare }: { label: string; value: string; hint?: string; compare?: string | null }) {
  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-slate-600">{hint}</p> : null}
      {compare ? <p className="mt-1 text-xs text-slate-600">{compare}</p> : null}
    </li>
  );
}

export function StatGrid({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section aria-label={label}>
      <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">{children}</ul>
    </section>
  );
}

/** A horizontal bar repeating a value (0–100 % of the row maximum). Hidden from screen readers: the number is in the row. */
export function Bar({ percent, title }: { percent: number; title?: string }) {
  return (
    <span className="block h-2 w-full min-w-[4rem] rounded bg-slate-100" title={title} aria-hidden>
      <span className="block h-2 rounded bg-teal-600" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
    </span>
  );
}

export interface BarRow {
  key: string;
  label: React.ReactNode;
  /** Text cells after the label (numbers right-aligned by the column's `numeric`). */
  cells: React.ReactNode[];
  /** Bar width (0–100) and its tooltip. Omit for no bar. */
  bar?: { percent: number; title: string };
}

export interface Column {
  label: string;
  numeric?: boolean;
}

export function BarTable({ caption, first, columns, rows, empty, barLabel }: { caption: string; first: string; columns: Column[]; rows: BarRow[]; empty: string; barLabel?: string }) {
  if (rows.length === 0) return <p className="text-sm text-slate-600">{empty}</p>;
  const hasBar = rows.some((r) => r.bar);
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[32rem] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            <th scope="col" className="py-2 pr-3 font-semibold">
              {first}
            </th>
            {columns.map((c) => (
              <th key={c.label} scope="col" className={cn("px-2 py-2 font-semibold", c.numeric && "text-right")}>
                {c.label}
              </th>
            ))}
            {hasBar ? (
              <th scope="col" className="w-1/4 py-2 pl-2 font-semibold">
                <span className="sr-only">{barLabel ?? "Bar"}</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-slate-100 last:border-0">
              <th scope="row" className="py-2 pr-3 text-left font-medium text-slate-900">
                {r.label}
              </th>
              {r.cells.map((cell, i) => (
                <td key={i} className={cn("whitespace-nowrap px-2 py-2 text-slate-800", columns[i]?.numeric && "text-right tabular-nums")}>
                  {cell}
                </td>
              ))}
              {hasBar ? <td className="py-2 pl-2 align-middle">{r.bar ? <Bar percent={r.bar.percent} title={r.bar.title} /> : null}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function NeedsModule({ text }: { text: string }) {
  return <Notice>{text}</Notice>;
}

export function Definition({ children }: { children: React.ReactNode }) {
  return (
    <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
      <summary className="cursor-pointer font-medium text-slate-800">How these figures are worked out</summary>
      <p className="mt-2">{children}</p>
    </details>
  );
}

/** A plain link (never prefetched: each download is recorded). */
export function DownloadLink({ href, label, note }: { href: string; label: string; note?: string }) {
  return (
    <div className="text-right">
      <a href={href} download className="inline-flex items-center rounded text-sm font-medium text-teal-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">
        {label}
      </a>
      {note ? <p className="mt-0.5 text-xs text-slate-600">{note}</p> : null}
    </div>
  );
}

export function SectionHeading({ id, title, children }: { id: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <h2 id={id} className="text-base font-semibold text-slate-900">
        {title}
      </h2>
      {children}
    </div>
  );
}
