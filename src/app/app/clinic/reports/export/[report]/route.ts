/**
 * GET /app/clinic/reports/export/<report>?period=…&site=…&practitioner=… – a report as CSV: the same figures as
 * its page, for the same filters (values outside the member's site access are ignored). Owners and
 * administrators (reports.export). Each download is recorded in the clinic's audit trail (ids and counts only).
 */
import { isReportId } from "@/modules/pms/reporting/catalogue";
import { reportFileName } from "@/modules/pms/reporting/csv";
import { queryValue } from "@/modules/pms/reporting/schemas";
import { clinicRoute } from "@/server/pms/http";
import { reportTable, tableToCsv } from "@/server/pms/reporting/csv-reports";
import { reportPageData } from "@/server/pms/reporting/page-data";
import { reportingSources } from "@/server/pms/reporting/sources";
import { pmsAudit } from "@/server/repos/pms/context";

export const dynamic = "force-dynamic";

export const GET = clinicRoute<{ report: string }>({ permission: "reports.export" }, async (req, actor, params) => {
  if (!isReportId(params.report)) {
    return Response.json({ error: { code: "NOT_FOUND", message: "There is no such report." } }, { status: 404 });
  }
  const url = new URL(req.url);
  const data = await reportPageData(actor, url.searchParams);
  const days = Number(queryValue(url.searchParams, "days")) || undefined;
  const table = await reportTable(params.report, data.ctx, data.request, data.directory, reportingSources(), { days, patientNames: actor.can("patients.export") });
  await pmsAudit(data.ctx, actor.tenantId, actor.actor, {
    action: "pms.report.export",
    targetType: "pms_report",
    targetId: params.report,
    detail: {
      rows: table.rows.length,
      days: data.request.period.days,
      siteFiltered: data.request.siteIds !== null,
      practitionerFiltered: data.request.practitionerId !== null,
    },
  });
  const { from, to } = data.request.period;
  return new Response(tableToCsv(table), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${reportFileName(params.report, actor.tenantId, from, to)}"`,
      "cache-control": "no-store",
    },
  });
});
