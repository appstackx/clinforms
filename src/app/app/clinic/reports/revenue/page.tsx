import type { Metadata } from "next";
import { PageHeader, Panel } from "@/components/account/shell";
import { ReportFilters } from "@/components/pms/reporting/report-filters";
import { BarTable, Definition, DownloadLink, NeedsModule, SectionHeading, StatGrid, StatTile, type BarRow } from "@/components/pms/reporting/report-ui";
import { formatPence } from "@/modules/pms/core/text";
import { REPORTS, REPORT_EXPORT_PATH } from "@/modules/pms/reporting/catalogue";
import { PAYER_TYPE_LABELS, REPORTS_COPY, labelOf } from "@/modules/pms/reporting/copy";
import { barPercent, type RevenueRow } from "@/modules/pms/reporting/metrics";
import { monthLabel } from "@/modules/pms/reporting/periods";
import { requireClinicActor } from "@/server/pms/actor";
import { reportPageData } from "@/server/pms/reporting/page-data";
import { loadRevenue } from "@/server/pms/reporting/reports";
import { reportingSources } from "@/server/pms/reporting/sources";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: REPORTS.revenue.title };

const COLUMNS = [
  { label: "Invoiced", numeric: true },
  { label: "Credited", numeric: true },
  { label: "Net", numeric: true },
  { label: "Received", numeric: true },
];

function rows(list: RevenueRow[], name: (k: string) => string): BarRow[] {
  const max = Math.max(0, ...list.map((r) => r.netPence));
  return list.map((r) => ({
    key: r.key || "none",
    label: name(r.key),
    cells: [formatPence(r.invoicedPence), formatPence(r.creditedPence), formatPence(r.netPence), formatPence(r.receivedPence)],
    bar: { percent: barPercent(r.netPence, max), title: `Net ${formatPence(r.netPence)}` },
  }));
}

export default async function RevenuePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const actor = await requireClinicActor({ permission: "reports.view" });
  const data = await reportPageData(actor, searchParams);
  const report = await loadRevenue(data.ctx, data.request, reportingSources());
  const dir = data.directory;
  return (
    <>
      <PageHeader title={REPORTS.revenue.title} description={REPORTS.revenue.summary} />
      <ReportFilters
        action={REPORTS.revenue.href}
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
      {!report.available ? (
        <div className="mt-6">
          <NeedsModule text={REPORTS_COPY.needsBilling} />
        </div>
      ) : (
        <>
          <div className="mt-6">
            <StatGrid label="Revenue in figures">
              <StatTile label="Invoiced" value={formatPence(report.total.invoicedPence)} hint={`${report.total.invoices.toLocaleString("en-GB")} invoices`} />
              <StatTile label="Credited" value={formatPence(report.total.creditedPence)} />
              <StatTile label="Net" value={formatPence(report.total.netPence)} hint="Invoiced less credit notes" />
              <StatTile label="Received" value={formatPence(report.total.receivedPence)} hint="Payments less refunds" />
            </StatGrid>
          </div>
          <Panel className="mt-6">
            <SectionHeading id="by-month" title="By month">
              <DownloadLink href={`${REPORT_EXPORT_PATH}/revenue?${data.query}`} label={REPORTS_COPY.download} note={REPORTS_COPY.downloadNote} />
            </SectionHeading>
            <BarTable caption="Revenue by month" first="Month" columns={COLUMNS} rows={rows(report.byMonth, monthLabel)} empty={REPORTS_COPY.noData} barLabel="Net" />
          </Panel>
          <div className="mt-6 grid gap-6">
            <Panel>
              <SectionHeading id="by-payer" title="By payer" />
              <BarTable caption="Revenue by payer" first="Payer" columns={COLUMNS} rows={rows(report.byPayer, (k) => labelOf(PAYER_TYPE_LABELS, k))} empty={REPORTS_COPY.noData} barLabel="Net" />
            </Panel>
            <Panel>
              <SectionHeading id="by-site" title="By site" />
              <BarTable caption="Revenue by site" first="Site" columns={COLUMNS} rows={rows(report.bySite, (k) => dir.siteName(k || null))} empty={REPORTS_COPY.noData} barLabel="Net" />
            </Panel>
            <Panel>
              <SectionHeading id="by-practitioner" title="By practitioner" />
              <BarTable caption="Revenue by practitioner" first="Practitioner" columns={COLUMNS} rows={rows(report.byPractitioner, dir.practitionerName)} empty={REPORTS_COPY.noData} barLabel="Net" />
            </Panel>
          </div>
        </>
      )}
      <Definition>{REPORTS_COPY.revenueDefinition}</Definition>
    </>
  );
}
