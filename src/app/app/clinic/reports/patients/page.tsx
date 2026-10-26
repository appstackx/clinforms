import type { Metadata } from "next";
import { PageHeader, Panel } from "@/components/account/shell";
import { ReportFilters } from "@/components/pms/reporting/report-filters";
import { BarTable, Definition, DownloadLink, SectionHeading, StatGrid, StatTile } from "@/components/pms/reporting/report-ui";
import { REPORTS, REPORT_EXPORT_PATH } from "@/modules/pms/reporting/catalogue";
import { REFERRER_KIND_LABELS, REPORTS_COPY, labelOf } from "@/modules/pms/reporting/copy";
import { barPercent, formatRate } from "@/modules/pms/reporting/metrics";
import { monthLabel } from "@/modules/pms/reporting/periods";
import { requireClinicActor } from "@/server/pms/actor";
import { reportPageData } from "@/server/pms/reporting/page-data";
import { loadPatients } from "@/server/pms/reporting/reports";
import { reportingSources } from "@/server/pms/reporting/sources";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: REPORTS.patients.title };

export default async function PatientsReportPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const actor = await requireClinicActor({ permission: "reports.view" });
  const data = await reportPageData(actor, searchParams);
  const report = await loadPatients(data.ctx, data.request, reportingSources());
  const maxMonth = Math.max(0, ...report.newByMonth.map((m) => m.value));
  const maxSource = Math.max(0, ...report.sources.map((s) => s.cases));
  const maxKind = Math.max(0, ...report.sourcesByKind.map((s) => s.cases));
  const n = (v: number) => v.toLocaleString("en-GB");
  return (
    <>
      <PageHeader title={REPORTS.patients.title} description={REPORTS.patients.summary} />
      <ReportFilters
        action={REPORTS.patients.href}
        preset={data.request.period.preset}
        from={data.request.period.from}
        to={data.request.period.to}
        siteId={data.request.siteId}
        sites={data.siteChoices}
        limited={!data.scope.all}
        periodError={data.periodError}
      />
      <div className="mt-6">
        <StatGrid label="Patients in figures">
          <StatTile label="New patients" value={n(report.byCases.newPatients)} hint={`First case with the clinic · ${formatRate(report.byCases.newShare)} of ${n(report.byCases.patients)}`} />
          <StatTile label="Returning patients" value={n(report.byCases.returning)} hint="A new case, seen before" />
          <StatTile label="Cases opened" value={n(report.casesOpened)} />
          {report.registered !== null ? <StatTile label="Patients registered" value={n(report.registered)} hint="Records created in the period (all sites)" /> : null}
          {report.byAppointments ? (
            <StatTile label="Seen in the diary" value={n(report.byAppointments.patients)} hint={`${n(report.byAppointments.newPatients)} for the first time · ${n(report.byAppointments.returning)} returning`} />
          ) : null}
        </StatGrid>
      </div>
      <Panel className="mt-6">
        <SectionHeading id="new-by-month" title="New patients by month">
          <DownloadLink href={`${REPORT_EXPORT_PATH}/patients?${data.query}`} label={REPORTS_COPY.download} note={REPORTS_COPY.downloadNote} />
        </SectionHeading>
        <BarTable
          caption="New patients by month"
          first="Month"
          columns={[{ label: "New patients", numeric: true }]}
          rows={report.newByMonth.map((m) => ({ key: m.month, label: monthLabel(m.month), cells: [n(m.value)], bar: { percent: barPercent(m.value, maxMonth), title: `${n(m.value)} new patients` } }))}
          empty={REPORTS_COPY.noData}
          barLabel="New patients"
        />
      </Panel>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel>
          <SectionHeading id="by-kind" title="Referrals by kind of referrer" />
          <BarTable
            caption="Cases opened by kind of referrer"
            first="Referred by"
            columns={[{ label: "Cases", numeric: true }]}
            rows={report.sourcesByKind.map((k) => ({ key: k.kind ?? "none", label: k.kind ? labelOf(REFERRER_KIND_LABELS, k.kind) : "Not recorded", cells: [n(k.cases)], bar: { percent: barPercent(k.cases, maxKind), title: `${n(k.cases)} cases` } }))}
            empty={REPORTS_COPY.noData}
            barLabel="Cases"
          />
        </Panel>
        <Panel>
          <SectionHeading id="by-source" title="Top referrers" />
          <BarTable
            caption="Cases opened by referrer"
            first="Referrer"
            columns={[{ label: "Kind" }, { label: "Cases", numeric: true }]}
            rows={report.sources.slice(0, 15).map((s) => ({
              key: s.referrerId ?? "none",
              label: s.name ?? "Not recorded",
              cells: [s.kind ? labelOf(REFERRER_KIND_LABELS, s.kind) : "–", n(s.cases)],
              bar: { percent: barPercent(s.cases, maxSource), title: `${n(s.cases)} cases` },
            }))}
            empty={REPORTS_COPY.noData}
            barLabel="Cases"
          />
        </Panel>
      </div>
      <Definition>{REPORTS_COPY.patientsDefinition}</Definition>
    </>
  );
}
