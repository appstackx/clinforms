import type { Metadata } from "next";
import { PageHeader, Panel } from "@/components/account/shell";
import { ReportFilters } from "@/components/pms/reporting/report-filters";
import { BarTable, Definition, DownloadLink, NeedsModule, SectionHeading, StatGrid, StatTile } from "@/components/pms/reporting/report-ui";
import { formatPence, formatUkDate } from "@/modules/pms/core/text";
import { REPORTS, REPORT_EXPORT_PATH } from "@/modules/pms/reporting/catalogue";
import { DEBT_BUCKET_LABELS, PAYER_TYPE_LABELS, REPORTS_COPY, labelOf } from "@/modules/pms/reporting/copy";
import { DEBT_BUCKETS, barPercent, overduePence } from "@/modules/pms/reporting/metrics";
import { requireClinicActor } from "@/server/pms/actor";
import { reportPageData } from "@/server/pms/reporting/page-data";
import { loadDebtors } from "@/server/pms/reporting/reports";
import { reportingSources } from "@/server/pms/reporting/sources";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: REPORTS.debtors.title };

export default async function DebtorsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const actor = await requireClinicActor({ permission: "reports.view" });
  const data = await reportPageData(actor, searchParams);
  const report = await loadDebtors(data.ctx, data.request, reportingSources());
  return (
    <>
      <PageHeader title={REPORTS.debtors.title} description={REPORTS.debtors.summary} />
      <ReportFilters
        action={REPORTS.debtors.href}
        preset={data.request.period.preset}
        from={data.request.period.from}
        to={data.request.period.to}
        siteId={data.request.siteId}
        sites={data.siteChoices}
        limited={!data.scope.all}
        hidePeriod
      />
      {!report.available ? (
        <div className="mt-6">
          <NeedsModule text={REPORTS_COPY.needsBilling} />
        </div>
      ) : (
        <>
          <div className="mt-6">
            <StatGrid label="Outstanding in figures">
              <StatTile label="Outstanding" value={formatPence(report.total.outstandingPence)} hint={`${report.total.invoices.toLocaleString("en-GB")} invoices`} />
              <StatTile label="Over 30 days overdue" value={formatPence(overduePence(report.total, 30))} />
              <StatTile label="Over 90 days overdue" value={formatPence(overduePence(report.total, 90))} />
              <StatTile label="Oldest due date" value={report.total.oldestDueOn ? formatUkDate(report.total.oldestDueOn) : "–"} />
            </StatGrid>
          </div>
          <Panel className="mt-6">
            <SectionHeading id="by-payer" title="By payer">
              <DownloadLink href={`${REPORT_EXPORT_PATH}/debtors?${data.query}`} label={REPORTS_COPY.download} note={REPORTS_COPY.downloadNote} />
            </SectionHeading>
            <BarTable
              caption="Outstanding debt by payer and age"
              first="Payer"
              columns={[{ label: "Type" }, { label: "Invoices", numeric: true }, ...DEBT_BUCKETS.map((b) => ({ label: DEBT_BUCKET_LABELS[b], numeric: true })), { label: "Total", numeric: true }]}
              rows={report.rows.map((r) => ({
                key: r.key,
                label: r.name,
                cells: [labelOf(PAYER_TYPE_LABELS, r.payerType), r.invoices.toLocaleString("en-GB"), ...DEBT_BUCKETS.map((b) => (r.buckets[b] ? formatPence(r.buckets[b]) : "–")), formatPence(r.outstandingPence)],
                bar: { percent: barPercent(r.outstandingPence, report.rows[0]?.outstandingPence ?? 0), title: formatPence(r.outstandingPence) },
              }))}
              empty="Nothing is owed. Every invoice is paid or credited."
              barLabel="Outstanding"
            />
          </Panel>
        </>
      )}
      <Definition>{REPORTS_COPY.debtDefinition}</Definition>
    </>
  );
}
