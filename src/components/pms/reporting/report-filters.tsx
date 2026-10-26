/**
 * The period / site / practitioner filter above every report: a plain GET form (works without scripts, the
 * filter is in the address so a view can be bookmarked). Server component.
 */
import { Notice } from "@/components/account/shell";
import { PERIOD_LABELS, PERIOD_PRESETS, type PeriodPreset } from "@/modules/pms/reporting/periods";
import { REPORTS_COPY } from "@/modules/pms/reporting/copy";
import { formatUkDate } from "@/modules/pms/core/text";

const INPUT =
  "block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30";
const LABEL = "block text-sm font-medium text-slate-800";

export interface FilterChoice {
  id: string;
  name: string;
  active?: boolean;
}

export function ReportFilters({
  action,
  preset,
  from,
  to,
  siteId,
  sites,
  limited,
  practitionerId,
  practitioners,
  periodError,
  extra,
  hidePeriod,
}: {
  action: string;
  preset: PeriodPreset;
  from: string;
  to: string;
  siteId: string | null;
  sites: FilterChoice[];
  /** The member works at some sites only ("All sites" then means their sites). */
  limited: boolean;
  practitionerId?: string | null;
  /** Omit to hide the practitioner filter. */
  practitioners?: FilterChoice[];
  periodError?: string | null;
  /** More fields of the report's own (rendered inside the form, before the button). */
  extra?: React.ReactNode;
  /** Reports about "now" (outstanding debt) have no period. */
  hidePeriod?: boolean;
}) {
  return (
    <form method="get" action={action} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-label="Report filters">
      {periodError ? (
        <div className="mb-3">
          <Notice tone="error">{periodError} Showing {PERIOD_LABELS.this_month.toLowerCase()} instead.</Notice>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] lg:items-end">
        {hidePeriod ? null : (
          <>
            <div className="space-y-1.5">
              <label htmlFor="rf-period" className={LABEL}>
                {REPORTS_COPY.periodLabel}
              </label>
              <select id="rf-period" name="period" defaultValue={preset} className={INPUT}>
                {PERIOD_PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {PERIOD_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rf-from" className={LABEL}>
                {REPORTS_COPY.fromLabel}
              </label>
              <input id="rf-from" name="from" type="date" defaultValue={preset === "custom" ? from : ""} className={INPUT} aria-describedby="rf-dates-hint" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rf-to" className={LABEL}>
                {REPORTS_COPY.toLabel}
              </label>
              <input id="rf-to" name="to" type="date" defaultValue={preset === "custom" ? to : ""} className={INPUT} aria-describedby="rf-dates-hint" />
            </div>
          </>
        )}
        <div className="space-y-1.5">
          <label htmlFor="rf-site" className={LABEL}>
            {REPORTS_COPY.siteLabel}
          </label>
          <select id="rf-site" name="site" defaultValue={siteId ?? ""} className={INPUT}>
            <option value="">{limited ? REPORTS_COPY.yourSites : REPORTS_COPY.allSites}</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.active === false ? " (closed)" : ""}
              </option>
            ))}
          </select>
        </div>
        {practitioners ? (
          <div className="space-y-1.5">
            <label htmlFor="rf-practitioner" className={LABEL}>
              {REPORTS_COPY.practitionerLabel}
            </label>
            <select id="rf-practitioner" name="practitioner" defaultValue={practitionerId ?? ""} className={INPUT}>
              <option value="">{REPORTS_COPY.allPractitioners}</option>
              {practitioners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {extra}
        <div>
          <button
            type="submit"
            className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 sm:w-auto"
          >
            {REPORTS_COPY.apply}
          </button>
        </div>
      </div>
      <p id="rf-dates-hint" className="mt-2 text-xs text-slate-600">
        {hidePeriod ? "Figures as they stand today." : `Showing ${formatUkDate(from)} to ${formatUkDate(to)}. For other dates, choose "${PERIOD_LABELS.custom}" and enter both dates.`}
        {limited ? ` ${REPORTS_COPY.limitedSites}` : ""}
      </p>
    </form>
  );
}
