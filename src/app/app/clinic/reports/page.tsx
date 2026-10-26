import type { Metadata } from "next";
import Link from "next/link";
import { Notice, PageHeader, Panel } from "@/components/account/shell";
import { ReportFilters } from "@/components/pms/reporting/report-filters";
import { StatGrid, StatTile } from "@/components/pms/reporting/report-ui";
import { formatPence, formatUkDate } from "@/modules/pms/core/text";
import { REPORTS, REPORT_IDS, REPORTS_PATH } from "@/modules/pms/reporting/catalogue";
import { REPORTS_COPY } from "@/modules/pms/reporting/copy";
import { formatRate, overduePence } from "@/modules/pms/reporting/metrics";
import { requireClinicActor } from "@/server/pms/actor";
import { reportPageData } from "@/server/pms/reporting/page-data";
import { loadDashboard } from "@/server/pms/reporting/reports";
import { reportingSources } from "@/server/pms/reporting/sources";
import { getPmsSettings } from "@/server/repos/pms/settings";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reports" };

function was(text: string, previous: { from: string; to: string }): string {
  return `${formatUkDate(previous.from)}–${formatUkDate(previous.to)}: ${text}`;
}

/** /app/clinic/reports – the clinic's figures for a period at a glance, and the fixed reports. */
export default async function ReportsOverviewPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const actor = await requireClinicActor({ permission: "reports.view" });
  const data = await reportPageData(actor, searchParams);
  const sources = reportingSources();
  const [dash, settings] = await Promise.all([loadDashboard(data.ctx, data.request, data.directory, sources), getPmsSettings(data.ctx, actor.tenantId)]);
  const prev = dash.previous;
  const needDiary = "Needs the diary";
  const needBilling = "Needs invoicing";
  return (
    <>
      <PageHeader title={REPORTS_COPY.title} description={REPORTS_COPY.intro} />
      {settings.isDemo ? (
        <div className="mb-4">
          <Notice tone="warning">Demonstration clinic – every figure here comes from fictional data.</Notice>
        </div>
      ) : null}
      <ReportFilters
        action={REPORTS_PATH}
        preset={data.request.period.preset}
        from={data.request.period.from}
        to={data.request.period.to}
        siteId={data.request.siteId}
        sites={data.siteChoices}
        limited={!data.scope.all}
        practitionerId={data.request.practitionerId}
        practitioners={data.practitionerChoices.map((p) => ({ id: p.id, name: p.displayName }))}
        periodError={data.periodError}
      />
      <div className="mt-6 space-y-3">
        <StatGrid label="Appointments">
          <StatTile
            label="Did not attend"
            value={dash.attendance ? formatRate(dash.attendance.now.dnaRate) : "–"}
            hint={dash.attendance ? `${dash.attendance.now.dna.toLocaleString("en-GB")} of ${dash.attendance.now.due.toLocaleString("en-GB")} due` : needDiary}
            compare={dash.attendance ? was(formatRate(dash.attendance.before.dnaRate), prev) : null}
          />
          <StatTile
            label="Late cancellations"
            value={dash.attendance ? formatRate(dash.attendance.now.lateCancelRate) : "–"}
            hint={dash.attendance ? `${dash.attendance.now.lateCancel.toLocaleString("en-GB")} of ${dash.attendance.now.due.toLocaleString("en-GB")} due` : needDiary}
            compare={dash.attendance ? was(formatRate(dash.attendance.before.lateCancelRate), prev) : null}
          />
          <StatTile
            label="Utilisation"
            value={dash.utilisation ? formatRate(dash.utilisation.now) : "–"}
            hint={dash.utilisation ? (data.request.practitionerId ? "Of working hours" : "Of room time") : needDiary}
            compare={dash.utilisation ? was(formatRate(dash.utilisation.before), prev) : null}
          />
          <StatTile
            label="New patients"
            value={dash.patients.now.newPatients.toLocaleString("en-GB")}
            hint={`${dash.patients.now.returning.toLocaleString("en-GB")} returning (by cases opened)`}
            compare={was(dash.patients.before.newPatients.toLocaleString("en-GB"), prev)}
          />
        </StatGrid>
        <StatGrid label="Money and cases">
          <StatTile
            label="Invoiced, less credits"
            value={dash.revenue ? formatPence(dash.revenue.now.netPence) : "–"}
            hint={dash.revenue ? `${formatPence(dash.revenue.now.receivedPence)} received` : needBilling}
            compare={dash.revenue ? was(formatPence(dash.revenue.before.netPence), prev) : null}
          />
          <StatTile
            label="Outstanding today"
            value={dash.debt ? formatPence(dash.debt.outstandingPence) : "–"}
            hint={dash.debt ? `${formatPence(overduePence(dash.debt))} more than 30 days overdue` : needBilling}
          />
          <StatTile label="Authorisations to act on" value={dash.authorisationsToAct.toLocaleString("en-GB")} hint="Expiring within 14 days, expired or nearly used up" />
          <StatTile label="Open cases" value={dash.openCases.toLocaleString("en-GB")} hint="Now" />
        </StatGrid>
      </div>
      <Panel title="Reports" className="mt-6">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {REPORT_IDS.filter((id) => actor.can(REPORTS[id].permission)).map((id) => {
            const r = REPORTS[id];
            const missing = (r.needs.includes("diary") && !sources.diary) || (r.needs.includes("billing") && !sources.billing);
            return (
              <li key={id}>
                <Link
                  href={`${r.href}?${data.query}`}
                  className="block h-full rounded-xl border border-slate-200 px-4 py-3 hover:border-teal-300 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
                >
                  <span className="block text-sm font-semibold text-slate-900">{r.title}</span>
                  <span className="mt-1 block text-sm text-slate-600">{r.summary}</span>
                  {missing ? <span className="mt-2 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{r.needs.includes("diary") ? needDiary : needBilling}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </Panel>
    </>
  );
}
