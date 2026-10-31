/**
 * One report (design round 2c, "Reports"): title and description, Export CSV (members who may export), the filter
 * bar, three figures, a bar chart and the table(s). Server-rendered from the ReportPage the server layer built
 * (src/server/pms/reporting/service.ts); only the filter bar runs in the browser. The chart is a picture of the
 * table: it carries a text description, and the table below holds every figure.
 */
import Link from "next/link";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReportChart, ReportPage, ReportTable } from "@/modules/pms/reporting/view";
import { PmsNotice } from "../ui/notice";
import { ReportFilterBar } from "./report-filter-bar";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

export function ReportScreen({ page, path, exportHref }: { page: ReportPage; path: string; exportHref: string }) {
  const { view, filters } = page;
  const csvHref = page.query ? `${exportHref}?${page.query}` : exportHref;
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1180px] flex-col gap-4" data-testid={`report-${view.id}`}>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="flex min-w-[240px] flex-1 flex-col gap-0.5">
          <h1 className="text-xl font-semibold leading-7 text-foreground">{view.title}</h1>
          <p className="text-[#475569]">{view.description}</p>
        </div>
        {page.canExport ? (
          <a
            href={csvHref}
            download
            data-testid="report-export-csv"
            className={cn("inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-border bg-white px-3.5 font-medium text-foreground hover:bg-[#F8FAFC]", focusRing)}
          >
            <Download className="h-4 w-4" aria-hidden />
            Export CSV
          </a>
        ) : null}
      </div>
      <ReportFilterBar filters={filters} path={path} />
      {filters.own ? <p className="text-[13px] text-[#475569]">Your own caseload only.</p> : null}
      {view.notice ? <PmsNotice tone="info" title="No figures to show">{view.notice}</PmsNotice> : null}
      {view.stats.length ? (
        <ul className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(180px,100%),1fr))]" aria-label="Key figures">
          {view.stats.map((s) => (
            <li key={s.id} className="flex flex-col gap-0.5 rounded-2xl border border-border bg-white px-4 py-3.5" data-testid={`report-stat-${s.id}`}>
              <span className="text-[13px] text-[#475569]">{s.label}</span>
              <strong className="text-[22px] font-semibold leading-[30px] tabular-nums text-foreground" data-testid="report-stat-value">
                {s.value}
              </strong>
              <span className={cn("text-xs", s.tone === "warn" ? "font-medium text-[#B45309]" : "text-[#475569]")}>{s.sub}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {view.chart ? <Chart chart={view.chart} /> : null}
      {view.tables.map((t, i) => (
        <Table key={t.id} table={t} testId={i === 0 ? "report-table" : `report-table-${t.id}`} />
      ))}
      {view.footnote ? <p className="text-xs text-[#475569]">{view.footnote}</p> : null}
    </div>
  );
}

function Chart({ chart }: { chart: ReportChart }) {
  const n = Math.max(1, chart.bars.length);
  const slot = 700 / n;
  const bw = Math.min(64, slot * 0.6);
  const hasStrong = chart.note !== null;
  return (
    <figure className="m-0 flex flex-col gap-2 rounded-2xl border border-border bg-white px-5 py-4" data-testid="report-chart">
      <figcaption className="font-semibold text-foreground">{chart.title}</figcaption>
      <svg role="img" aria-label={chart.description} viewBox="0 0 760 240" className="h-auto w-full">
        <line x1="48" y1="200" x2="750" y2="200" stroke="#CBD5E1" />
        <line x1="48" y1="140" x2="750" y2="140" stroke="#F1F5F9" />
        <line x1="48" y1="80" x2="750" y2="80" stroke="#F1F5F9" />
        <line x1="48" y1="20" x2="750" y2="20" stroke="#F1F5F9" />
        <text x="40" y="204" textAnchor="end" fontSize="11" fill="#64748B">
          0
        </text>
        <text x="40" y="24" textAnchor="end" fontSize="11" fill="#64748B">
          {chart.maxLabel}
        </text>
        {chart.bars.map((b, i) => {
          const h = chart.max > 0 ? Math.max(b.value > 0 ? 2 : 0, Math.min(180, (b.value / chart.max) * 180)) : 0;
          const x = 48 + slot * i + (slot - bw) / 2;
          const fill = hasStrong ? (b.strong ? "#0B5F58" : "#5EC4B9") : "#0E958A";
          return (
            <g key={`${b.label}-${i}`}>
              <rect x={x} y={200 - h} width={bw} height={h} rx="4" fill={fill} />
              <text x={x + bw / 2} y={200 - h - 6} textAnchor="middle" fontSize="12" fontWeight="600" fill="#0F172A">
                {b.display}
              </text>
              <text x={x + bw / 2} y="220" textAnchor="middle" fontSize="11" fill="#475569">
                {b.label}
              </text>
            </g>
          );
        })}
      </svg>
      {chart.note ? <span className="text-xs text-[#475569]">{chart.note}</span> : null}
    </figure>
  );
}

function Table({ table, testId }: { table: ReportTable; testId: string }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-white" aria-label={table.title ?? "Figures"}>
      {table.title ? <h2 className="border-b border-border px-4 py-3 text-[15px] font-semibold text-foreground">{table.title}</h2> : null}
      {/* Scrolls sideways on a phone: focusable so a keyboard can scroll it (axe scrollable-region-focusable). */}
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`${table.title ?? "Figures"} (scrolls sideways)`}>
        <table className="w-full min-w-[640px] border-collapse tabular-nums" data-testid={testId}>
          <thead>
            <tr className="bg-[#F8FAFC] text-xs text-[#475569]">
              {table.columns.map((c, ci) => (
                <th key={`${c.label}-${ci}`} scope="col" className={cn("px-4 py-2.5 font-semibold", c.align === "left" ? "text-left" : "text-right")}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.length === 0 ? (
              <tr className="border-t border-border">
                <td colSpan={table.columns.length} className="px-4 py-3 text-[#475569]">
                  {table.empty}
                </td>
              </tr>
            ) : (
              table.rows.map((row, ri) => (
                <tr key={ri} className="border-t border-border">
                  {row.cells.map((cell, ci) => (
                    <td key={ci} className={cn("px-4 py-2.5", ci === 0 ? "text-left font-medium" : "text-right")}>
                      {ci === 0 && row.href ? (
                        <Link href={row.href} className={cn("text-primary-strong underline underline-offset-2", focusRing)}>
                          {cell}
                        </Link>
                      ) : (
                        cell
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
