import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Panel } from "@/components/account/shell";
import { ReportFilters } from "@/components/pms/reporting/report-filters";
import { Definition, DownloadLink, SectionHeading } from "@/components/pms/reporting/report-ui";
import { CLINIC_BASE_PATH } from "@/modules/pms/core/modules";
import { formatPence, formatUkDate } from "@/modules/pms/core/text";
import { REPORTS, REPORT_EXPORT_PATH } from "@/modules/pms/reporting/catalogue";
import { AUTHORISATION_REASON_LABELS, REPORTS_COPY } from "@/modules/pms/reporting/copy";
import { queryValue } from "@/modules/pms/reporting/schemas";
import { requireClinicActor } from "@/server/pms/actor";
import { filterQuery, reportPageData } from "@/server/pms/reporting/page-data";
import { AUTHORISATION_WINDOWS, loadAuthorisations } from "@/server/pms/reporting/reports";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: REPORTS.authorisations.title };

const SELECT =
  "block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30";

export default async function AuthorisationsReportPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const actor = await requireClinicActor({ permission: "reports.view" });
  const data = await reportPageData(actor, searchParams);
  const asked = Number(queryValue(searchParams, "days"));
  const days = (AUTHORISATION_WINDOWS as readonly number[]).includes(asked) ? asked : 14;
  const alerts = await loadAuthorisations(data.ctx, data.request, days);
  const dir = data.directory;
  const canOpen = actor.can("patients.view");
  return (
    <>
      <PageHeader title={REPORTS.authorisations.title} description={REPORTS.authorisations.summary} />
      <ReportFilters
        action={REPORTS.authorisations.href}
        preset={data.request.period.preset}
        from={data.request.period.from}
        to={data.request.period.to}
        siteId={data.request.siteId}
        sites={data.siteChoices}
        limited={!data.scope.all}
        practitionerId={data.request.practitionerId}
        practitioners={data.practitionerChoices.map((p) => ({ id: p.id, name: p.displayName }))}
        hidePeriod
        extra={
          <div className="space-y-1.5">
            <label htmlFor="rf-days" className="block text-sm font-medium text-slate-800">
              Expiring within
            </label>
            <select id="rf-days" name="days" defaultValue={String(days)} className={SELECT}>
              {AUTHORISATION_WINDOWS.map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </div>
        }
      />
      <Panel className="mt-6">
        <SectionHeading id="to-act-on" title={`${alerts.length.toLocaleString("en-GB")} to act on`}>
          {alerts.length > 0 ? <DownloadLink href={`${REPORT_EXPORT_PATH}/authorisations?${filterQuery(data, { days })}`} label={REPORTS_COPY.download} note={REPORTS_COPY.downloadNote} /> : null}
        </SectionHeading>
        {alerts.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing needs attention: no authorisation expires within {days} days or is nearly used up.</p>
        ) : (
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[44rem] border-collapse text-sm">
              <caption className="sr-only">Treatment authorisations to act on</caption>
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <th scope="col" className="py-2 pr-3">Patient</th>
                  <th scope="col" className="px-2 py-2">Authorisation</th>
                  <th scope="col" className="px-2 py-2">Issued by</th>
                  <th scope="col" className="px-2 py-2 text-right">Sessions left</th>
                  <th scope="col" className="px-2 py-2 text-right">Value left</th>
                  <th scope="col" className="px-2 py-2">Expires</th>
                  <th scope="col" className="px-2 py-2">Why</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map(({ authorisation: a, view, reasons }) => (
                  <tr key={a.id} className="border-b border-slate-100 align-top last:border-0">
                    <th scope="row" className="py-2 pr-3 text-left font-medium text-slate-900">
                      {canOpen ? (
                        <Link href={`${CLINIC_BASE_PATH}/patients/${a.patientId}`} className="text-teal-800 underline-offset-4 hover:underline">
                          {a.patientName ?? "Patient"}
                        </Link>
                      ) : (
                        (a.patientName ?? "Patient")
                      )}
                      <span className="block text-xs font-normal text-slate-600">
                        {a.patientNumber !== null ? `No. ${a.patientNumber}` : ""}
                        {a.caseTitle ? ` · ${a.caseTitle}` : ""}
                        {a.practitionerId ? ` · ${dir.practitionerName(a.practitionerId)}` : ""}
                      </span>
                    </th>
                    <td className="px-2 py-2 font-mono text-xs text-slate-800">{a.code}</td>
                    <td className="px-2 py-2 text-slate-800">{a.issuerName ?? "–"}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-800">{view.sessionsLeft === null ? "No limit" : `${view.sessionsLeft} of ${a.sessionsAuthorised}`}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-800">{view.valueLeftPence === null ? "No limit" : formatPence(view.valueLeftPence)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-slate-800">
                      {a.expiresOn ? formatUkDate(a.expiresOn) : "No expiry"}
                      {view.daysToExpiry !== null ? (
                        <span className="block text-xs text-slate-600">{view.daysToExpiry < 0 ? `${-view.daysToExpiry} days ago` : view.daysToExpiry === 0 ? "Today" : `In ${view.daysToExpiry} days`}</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      <ul className="flex flex-wrap gap-1">
                        {reasons.map((r) => (
                          <li key={r} className={r === "expired_recently" || r === "used_up" ? "rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900" : "rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800"}>
                            {AUTHORISATION_REASON_LABELS[r]}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Definition>{REPORTS_COPY.authorisationsDefinition}</Definition>
    </>
  );
}
