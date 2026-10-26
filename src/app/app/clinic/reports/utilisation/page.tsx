import type { Metadata } from "next";
import { PageHeader, Panel } from "@/components/account/shell";
import { ReportFilters } from "@/components/pms/reporting/report-filters";
import { BarTable, Definition, DownloadLink, NeedsModule, SectionHeading, StatGrid, StatTile, type BarRow } from "@/components/pms/reporting/report-ui";
import { REPORTS, REPORT_EXPORT_PATH } from "@/modules/pms/reporting/catalogue";
import { REPORTS_COPY } from "@/modules/pms/reporting/copy";
import { barPercent, formatMinutes, formatRate, type UtilisationRow } from "@/modules/pms/reporting/metrics";
import { requireClinicActor } from "@/server/pms/actor";
import { reportPageData } from "@/server/pms/reporting/page-data";
import { loadUtilisation } from "@/server/pms/reporting/reports";
import { reportingSources } from "@/server/pms/reporting/sources";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: REPORTS.utilisation.title };

function rows(list: UtilisationRow[], name: (id: string) => string): BarRow[] {
  return list.map((r) => ({
    key: r.key,
    label: name(r.key),
    cells: [formatRate(r.utilisation), formatMinutes(r.bookedMinutes), r.availableMinutes === null ? "Not set" : formatMinutes(r.availableMinutes), r.appointments.toLocaleString("en-GB")],
    bar: r.utilisation === null ? undefined : { percent: barPercent(r.utilisation, 1), title: formatRate(r.utilisation) },
  }));
}

const COLUMNS = [
  { label: "Utilisation", numeric: true },
  { label: "Booked", numeric: true },
  { label: "Available", numeric: true },
  { label: "Appointments", numeric: true },
];

export default async function UtilisationPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const actor = await requireClinicActor({ permission: "reports.view" });
  const data = await reportPageData(actor, searchParams);
  const report = await loadUtilisation(data.ctx, data.request, data.directory, reportingSources());
  const dir = data.directory;
  return (
    <>
      <PageHeader title={REPORTS.utilisation.title} description={REPORTS.utilisation.summary} />
      <ReportFilters
        action={REPORTS.utilisation.href}
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
            <StatGrid label="Utilisation in figures">
              <StatTile label="Room time used" value={formatRate(report.total.utilisation)} hint={`${formatMinutes(report.total.bookedMinutes)} of ${formatMinutes(report.total.availableMinutes)}`} />
              <StatTile label="Working time used" value={formatRate(report.practitionerTotal.utilisation)} hint={`${formatMinutes(report.practitionerTotal.bookedMinutes)} of ${formatMinutes(report.practitionerTotal.availableMinutes)}`} />
            </StatGrid>
          </div>
          {report.sitesWithoutHours.length > 0 ? (
            <p className="mt-3 text-sm text-slate-700">
              No opening hours set for {report.sitesWithoutHours.map((id) => dir.siteName(id)).join(", ")} – set them under Clinic set-up → Sites and rooms to see their utilisation.
            </p>
          ) : null}
          <Panel className="mt-6">
            <SectionHeading id="by-practitioner" title="By practitioner">
              <DownloadLink href={`${REPORT_EXPORT_PATH}/utilisation?${data.query}`} label={REPORTS_COPY.download} note={REPORTS_COPY.downloadNote} />
            </SectionHeading>
            <BarTable caption="Utilisation by practitioner" first="Practitioner" columns={COLUMNS} rows={rows(report.byPractitioner, dir.practitionerName)} empty={REPORTS_COPY.noData} barLabel="Utilisation" />
          </Panel>
          {data.request.practitionerId ? null : (
            <>
              <Panel className="mt-6">
                <SectionHeading id="by-site" title="By site" />
                <BarTable caption="Utilisation by site" first="Site" columns={COLUMNS} rows={rows(report.bySite, dir.siteName)} empty={REPORTS_COPY.noData} barLabel="Utilisation" />
              </Panel>
              <Panel className="mt-6">
                <SectionHeading id="by-room" title="By room" />
                <BarTable caption="Utilisation by room" first="Room" columns={COLUMNS} rows={rows(report.byRoom, dir.roomName)} empty={REPORTS_COPY.noData} barLabel="Utilisation" />
              </Panel>
            </>
          )}
        </>
      )}
      <Definition>{REPORTS_COPY.utilisationDefinition}</Definition>
    </>
  );
}
