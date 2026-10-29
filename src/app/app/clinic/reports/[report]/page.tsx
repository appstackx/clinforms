import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ReportScreen } from "@/components/pms/reporting/report-screen";
import { SITE_COOKIE } from "@/components/pms/shell/site-cookie";
import { REPORTS, REPORT_EXPORT_PATH, isReportId, reportAccess } from "@/modules/pms/reporting/catalogue";
import { requireClinicActor } from "@/server/pms/actor";
import { reportPageFor } from "@/server/pms/reporting/service";

export const dynamic = "force-dynamic";

/** The report's access is checked here too, so a member who may not open it gets a real 404 (src/server/pms/page-gate.ts). */
export async function generateMetadata({ params }: { params: { report: string } }): Promise<Metadata> {
  if (!isReportId(params.report)) notFound();
  const actor = await requireClinicActor();
  if (reportAccess(params.report, (p) => actor.can(p)) === null) notFound();
  return { title: REPORTS[params.report].title };
}

/**
 * /app/clinic/reports/<report> – one report (design round 2c): filters (period, sites, practitioner, service),
 * three figures, a chart and the table, "Export CSV" for members who may export. Who may open which report and
 * which sites they see is decided on the server (src/server/pms/reporting/service.ts). Without a site in the
 * address the shell's chosen site (cookie) preselects one; "all" keeps every site.
 */
export default async function ReportPage({ params, searchParams }: { params: { report: string }; searchParams: Record<string, string | string[] | undefined> }) {
  if (!isReportId(params.report)) notFound();
  const actor = await requireClinicActor();
  const query: Record<string, string | string[] | undefined> = { ...searchParams };
  if (query.site === undefined) {
    const chosen = cookies().get(SITE_COOKIE)?.value;
    if (chosen && chosen !== "all") query.site = chosen;
  } else if (query.site === "all") {
    delete query.site;
  }
  const r = await reportPageFor(actor, params.report, query);
  if (!r.ok) notFound();
  return <ReportScreen page={r.value} path={REPORTS[params.report].href} exportHref={`${REPORT_EXPORT_PATH}/${params.report}`} />;
}
