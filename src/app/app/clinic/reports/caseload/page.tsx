import type { Metadata } from "next";
import { PageHeader, Panel } from "@/components/account/shell";
import { ReportFilters } from "@/components/pms/reporting/report-filters";
import { BarTable, Definition, DownloadLink, SectionHeading, StatGrid, StatTile } from "@/components/pms/reporting/report-ui";
import { REPORTS, REPORT_EXPORT_PATH } from "@/modules/pms/reporting/catalogue";
import { PAYER_TYPE_LABELS, REPORTS_COPY, labelOf } from "@/modules/pms/reporting/copy";
import { barPercent } from "@/modules/pms/reporting/metrics";
import { monthLabel } from "@/modules/pms/reporting/periods";
import { requireClinicActor } from "@/server/pms/actor";
import { reportPageData } from "@/server/pms/reporting/page-data";
import { loadCaseload } from "@/server/pms/reporting/reports";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: REPORTS.caseload.title };

export default async function CaseloadPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const actor = await requireClinicActor({ permission: "reports.view" });
  const data = await reportPageData(actor, searchParams);
  const report = await loadCaseload(data.ctx, data.request);
  const dir = data.directory;
  const n = (v: number) => v.toLocaleString("en-GB");
  const bars = <K,>(list: { key: K; cases: number }[], name: (k: K) => string, caption: string, first: string) => {
    const max = Math.max(0, ...list.map((r) => r.cases));
    return (
      <BarTable
        caption={caption}
        first={first}
        columns={[{ label: "Cases", numeric: true }]}
        rows={list.map((r) => ({ key: String(r.key ?? "none"), label: name(r.key), cells: [n(r.cases)], bar: { percent: barPercent(r.cases, max), title: `${n(r.cases)} cases` } }))}
        empty={REPORTS_COPY.noData}
        barLabel="Cases"
      />
    );
  };
  return (
    <>
      <PageHeader title={REPORTS.caseload.title} description={REPORTS.caseload.summary} />
      <ReportFilters
        action={REPORTS.caseload.href}
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
      <div className="mt-6">
        <StatGrid label="Cases in figures">
          <StatTile label="Open cases now" value={n(report.openTotal)} />
          <StatTile label="Opened in the period" value={n(report.opened)} />
          <StatTile label="Closed in the period" value={n(report.closed)} hint="Discharged or closed" />
        </StatGrid>
      </div>
      <Panel className="mt-6">
        <SectionHeading id="open-by-practitioner" title="Open cases by practitioner">
          <DownloadLink href={`${REPORT_EXPORT_PATH}/caseload?${data.query}`} label={REPORTS_COPY.download} note={REPORTS_COPY.downloadNote} />
        </SectionHeading>
        {bars(report.openByPractitioner, (k) => dir.practitionerName(k), "Open cases by practitioner", "Practitioner")}
      </Panel>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel>
          <SectionHeading id="open-by-site" title="Open cases by site" />
          {bars(report.openBySite, (k) => dir.siteName(k), "Open cases by site", "Site")}
        </Panel>
        <Panel>
          <SectionHeading id="open-by-payer" title="Open cases by payer" />
          {bars(report.openByPayer, (k) => labelOf(PAYER_TYPE_LABELS, k), "Open cases by payer", "Payer")}
        </Panel>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel>
          <SectionHeading id="opened-by-month" title="Cases opened by month" />
          {bars(report.openedByMonth.map((m) => ({ key: m.month, cases: m.value })), (k) => monthLabel(k), "Cases opened by month", "Month")}
        </Panel>
        <Panel>
          <SectionHeading id="opened-by-payer" title="Cases opened by payer" />
          {bars(report.openedByPayer, (k) => labelOf(PAYER_TYPE_LABELS, k), "Cases opened by payer", "Payer")}
        </Panel>
      </div>
      <Definition>{REPORTS_COPY.caseloadDefinition}</Definition>
    </>
  );
}
