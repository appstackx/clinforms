import type { Metadata } from "next";
import { PageHeader, Panel } from "@/components/account/shell";
import { ReportFilters } from "@/components/pms/reporting/report-filters";
import { BarTable, Definition, DownloadLink, NeedsModule, SectionHeading, StatGrid, StatTile, type BarRow } from "@/components/pms/reporting/report-ui";
import { REPORTS, REPORT_EXPORT_PATH } from "@/modules/pms/reporting/catalogue";
import { REPORTS_COPY } from "@/modules/pms/reporting/copy";
import { barPercent, formatRate, type AttendanceRow } from "@/modules/pms/reporting/metrics";
import { monthLabel } from "@/modules/pms/reporting/periods";
import { requireClinicActor } from "@/server/pms/actor";
import { reportPageData } from "@/server/pms/reporting/page-data";
import { loadAttendance } from "@/server/pms/reporting/reports";
import { reportingSources } from "@/server/pms/reporting/sources";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: REPORTS.attendance.title };

const COLUMNS = [
  { label: "Due", numeric: true },
  { label: "Attended", numeric: true },
  { label: "Did not attend", numeric: true },
  { label: "DNA rate", numeric: true },
  { label: "Late cancellations", numeric: true },
  { label: "Late rate", numeric: true },
];

function rows(list: AttendanceRow[], name: (id: string) => string): BarRow[] {
  const max = Math.max(0, ...list.map((r) => r.dnaRate ?? 0));
  return list.map((r) => ({
    key: r.key,
    label: name(r.key),
    cells: [r.due.toLocaleString("en-GB"), r.attended.toLocaleString("en-GB"), r.dna.toLocaleString("en-GB"), formatRate(r.dnaRate), r.lateCancel.toLocaleString("en-GB"), formatRate(r.lateCancelRate)],
    bar: r.dnaRate === null ? undefined : { percent: barPercent(r.dnaRate, max), title: `DNA rate ${formatRate(r.dnaRate)}` },
  }));
}

export default async function AttendancePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const actor = await requireClinicActor({ permission: "reports.view" });
  const data = await reportPageData(actor, searchParams);
  const report = await loadAttendance(data.ctx, data.request, reportingSources());
  const dir = data.directory;
  return (
    <>
      <PageHeader title={REPORTS.attendance.title} description={REPORTS.attendance.summary} />
      <ReportFilters
        action={REPORTS.attendance.href}
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
          <NeedsModule text={REPORTS_COPY.needsDiary} />
        </div>
      ) : (
        <>
          <div className="mt-6">
            <StatGrid label="Attendance in figures">
              <StatTile label="Did not attend" value={formatRate(report.total.dnaRate)} hint={`${report.total.dna.toLocaleString("en-GB")} of ${report.total.due.toLocaleString("en-GB")} due`} />
              <StatTile label="Late cancellations" value={formatRate(report.total.lateCancelRate)} hint={`${report.total.lateCancel.toLocaleString("en-GB")} of ${report.total.due.toLocaleString("en-GB")} due`} />
              <StatTile label="Attended" value={formatRate(report.total.attendedRate)} hint={`${report.total.attended.toLocaleString("en-GB")} appointments`} />
              <StatTile label="Not recorded yet" value={report.total.unrecorded.toLocaleString("en-GB")} hint={`Past appointments still to mark · ${report.total.upcoming.toLocaleString("en-GB")} still to come · ${report.total.cancelled.toLocaleString("en-GB")} cancelled in good time`} />
            </StatGrid>
          </div>
          <Panel className="mt-6">
            <SectionHeading id="by-practitioner" title="By practitioner">
              <DownloadLink href={`${REPORT_EXPORT_PATH}/attendance?${data.query}`} label={REPORTS_COPY.download} note={REPORTS_COPY.downloadNote} />
            </SectionHeading>
            <BarTable caption="Attendance by practitioner" first="Practitioner" columns={COLUMNS} rows={rows(report.byPractitioner, dir.practitionerName)} empty={REPORTS_COPY.noData} barLabel="DNA rate" />
          </Panel>
          <Panel className="mt-6">
            <SectionHeading id="by-site" title="By site" />
            <BarTable caption="Attendance by site" first="Site" columns={COLUMNS} rows={rows(report.bySite, dir.siteName)} empty={REPORTS_COPY.noData} barLabel="DNA rate" />
          </Panel>
          {report.byMonth.length > 1 ? (
            <Panel className="mt-6">
              <SectionHeading id="by-month" title="By month" />
              <BarTable caption="Attendance by month" first="Month" columns={COLUMNS} rows={rows(report.byMonth, monthLabel)} empty={REPORTS_COPY.noData} barLabel="DNA rate" />
            </Panel>
          ) : null}
        </>
      )}
      <Definition>{REPORTS_COPY.attendanceDefinition}</Definition>
    </>
  );
}
