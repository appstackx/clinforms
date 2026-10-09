import type { ReactNode } from "react";
import { formatLongDate } from "@/lib/site";

/**
 * Layout for the legal and trust pages: title, "Last updated", an optional summary and long-form text.
 * Long-form styles are applied to the children with arbitrary variants (no typography plugin).
 */
export function LegalPage({
  title,
  lastUpdated,
  intro,
  children,
}: {
  title: string;
  lastUpdated: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-white">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <header className="border-b border-slate-200 pb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">{title}</h1>
          <p className="mt-3 text-sm text-slate-600">
            Last updated: <time dateTime={lastUpdated}>{formatLongDate(lastUpdated)}</time>
          </p>
          {intro ? <div className="mt-5 text-base leading-7 text-slate-700">{intro}</div> : null}
        </header>
        <div className={PROSE}>{children}</div>
      </div>
    </div>
  );
}

/** Long-form text styles (headings, paragraphs, lists, links) for legal pages. Tables: LegalTable. */
export const PROSE = [
  "pt-4 text-[15px] leading-7 text-slate-700",
  "[&_h2]:mt-10 [&_h2]:scroll-mt-24 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-slate-900",
  "[&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-slate-900",
  "[&_p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6",
  "[&_a]:font-medium [&_a]:text-teal-800 [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-teal-900",
  "[&_strong]:font-semibold [&_strong]:text-slate-900",
  "[&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[13px] [&_code]:text-slate-800",
].join(" ");

/**
 * A table for legal pages: a normal table from the sm breakpoint, and one stacked block per row (each
 * value under its column name) on narrow screens, so nothing is cut off or scrolls sideways.
 */
export function LegalTable({ label, columns, rows }: { label: string; columns: string[]; rows: ReactNode[][] }) {
  return (
    <table aria-label={label} className="mt-4 block w-full border-collapse text-sm sm:table">
      <thead className="hidden sm:table-header-group">
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col" className="border-b border-slate-300 py-2 pr-4 text-left align-bottom font-semibold text-slate-900">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="block sm:table-row-group">
        {rows.map((cells, r) => (
          <tr key={r} className="block border-b border-slate-200 py-3 sm:table-row sm:py-0">
            {cells.map((cell, c) => (
              <td key={c} className="block py-1 align-top sm:table-cell sm:border-b sm:border-slate-200 sm:py-2.5 sm:pr-4">
                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500 sm:hidden">{columns[c]}</span>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
