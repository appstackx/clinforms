"use client";
/**
 * The report filter bar (design round 2c): period chips (This week / Last 6 weeks / This quarter / Custom) with the
 * dates they cover, the sites (all of the member's sites, or one), and – where the report has them – practitioner
 * and appointment type. Everything is in the address (?period=&from=&to=&site=&practitioner=&service=), so a view
 * can be bookmarked and the CSV link reproduces it; the server ignores anything outside the member's access.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { cn } from "@/lib/utils";
import type { ReportFilters } from "@/modules/pms/reporting/view";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const selectClass = cn("h-8 max-w-full rounded-[8px] border px-2 text-[13px] font-medium", focusRing);

export function ReportFilterBar({ filters, path }: { filters: ReportFilters; path: string }) {
  const router = useRouter();
  const [customOpen, setCustomOpen] = React.useState(filters.period?.preset === "custom");
  const [from, setFrom] = React.useState(filters.period?.from ?? "");
  const [to, setTo] = React.useState(filters.period?.to ?? "");

  const href = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const base: Record<string, string | null> = {
      period: filters.period ? filters.period.preset : null,
      from: filters.period?.preset === "custom" ? filters.period.from : null,
      to: filters.period?.preset === "custom" ? filters.period.to : null,
      site: filters.siteId ?? "all",
      practitioner: filters.practitionerId,
      service: filters.serviceId,
    };
    for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };

  const siteCount = filters.sites.length;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-white px-3 py-2.5" data-testid="report-filters">
      {filters.period ? (
        <>
          <div role="group" aria-label="Date range" className="flex max-w-full flex-wrap gap-0.5 rounded-[8px] bg-[#F1F5F9] p-[3px]">
            {filters.period.chips.map((c) => {
              const selected = c.preset === "custom" ? customOpen : !customOpen && filters.period?.preset === c.preset;
              return c.preset === "custom" ? (
                <button
                  key={c.preset}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setCustomOpen(true)}
                  data-testid="report-period-custom"
                  className={cn("h-[30px] whitespace-nowrap rounded-[6px] px-2.5 text-[13px] font-medium text-foreground", selected ? "bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08)]" : "hover:bg-white/60", focusRing)}
                >
                  {c.label}
                </button>
              ) : (
                <Link
                  key={c.preset}
                  href={href({ period: c.preset, from: null, to: null })}
                  aria-current={selected ? "true" : undefined}
                  data-testid={`report-period-${c.preset}`}
                  className={cn("inline-flex h-[30px] items-center whitespace-nowrap rounded-[6px] px-2.5 text-[13px] font-medium text-foreground", selected ? "bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08)]" : "hover:bg-white/60", focusRing)}
                >
                  {c.label}
                </Link>
              );
            })}
          </div>
          {customOpen ? (
            <form
              className="flex flex-wrap items-center gap-1.5 text-[13px]"
              onSubmit={(e) => {
                e.preventDefault();
                router.push(href({ period: "custom", from, to }));
              }}
            >
              <label className="sr-only" htmlFor="report-from">
                From
              </label>
              <input id="report-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={cn(selectClass, "border-input-strong")} data-testid="report-from" />
              <span aria-hidden>–</span>
              <label className="sr-only" htmlFor="report-to">
                To
              </label>
              <input id="report-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={cn(selectClass, "border-input-strong")} data-testid="report-to" />
              <button type="submit" className={cn("h-8 rounded-[8px] bg-primary-strong px-3 text-[13px] font-medium text-white", focusRing)} data-testid="report-period-apply">
                Show
              </button>
            </form>
          ) : (
            <span className="text-[13px] tabular-nums text-[#475569]" data-testid="report-range">
              {filters.period.rangeText}
            </span>
          )}
          {filters.period.error ? (
            <span role="alert" className="text-[13px] text-destructive-strong">
              {filters.period.error}
            </span>
          ) : null}
        </>
      ) : (
        <span className="text-[13px] text-[#475569]">As of today</span>
      )}
      <label className="sr-only" htmlFor="report-site">
        Sites
      </label>
      <select
        id="report-site"
        data-testid="report-site-select"
        value={filters.siteId ?? "all"}
        onChange={(e) => router.push(href({ site: e.target.value }))}
        className={cn(selectClass, filters.siteId ? "border-border bg-white text-foreground" : "border-[#0E958A] bg-[#F0FDFA] text-[#0B5F58]")}
      >
        <option value="all">{filters.allSites ? `Sites: all ${siteCount}` : `Sites: your ${siteCount}`}</option>
        {filters.sites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {filters.practitioners ? (
        <>
          <label className="sr-only" htmlFor="report-practitioner">
            Practitioner
          </label>
          <select
            id="report-practitioner"
            data-testid="report-practitioner-select"
            value={filters.practitionerId ?? ""}
            onChange={(e) => router.push(href({ practitioner: e.target.value || null }))}
            className={cn(selectClass, filters.practitionerId ? "border-[#0E958A] bg-[#F0FDFA] text-[#0B5F58]" : "border-dashed border-[#CBD5E1] bg-white text-foreground")}
          >
            <option value="">+ Practitioner</option>
            {filters.practitioners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </>
      ) : null}
      {filters.services ? (
        <>
          <label className="sr-only" htmlFor="report-service">
            Service
          </label>
          <select
            id="report-service"
            data-testid="report-service-select"
            value={filters.serviceId ?? ""}
            onChange={(e) => router.push(href({ service: e.target.value || null }))}
            className={cn(selectClass, filters.serviceId ? "border-[#0E958A] bg-[#F0FDFA] text-[#0B5F58]" : "border-dashed border-[#CBD5E1] bg-white text-foreground")}
          >
            <option value="">+ Service</option>
            {filters.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </>
      ) : null}
    </div>
  );
}
