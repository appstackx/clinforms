/**
 * GET /app/clinic/reports/export/<report>?period=…&site=…&practitioner=…&service=… – a report as CSV: the same
 * figures as its page, for the same filters (values outside the member's sites are ignored; a clinician with
 * "own caseload" gets only their own). Needs "Export data" (reports.export) as well as the report's own permission.
 * Formula-safe cells (src/modules/pms/reporting/csv.ts); each download is in the clinic's audit trail.
 */
import { isReportId } from "@/modules/pms/reporting/catalogue";
import { clinicRoute } from "@/server/pms/http";
import { reportCsvFor } from "@/server/pms/reporting/service";

export const dynamic = "force-dynamic";

export const GET = clinicRoute<{ report: string }>({ permission: "reports.export" }, async (req, actor, params) => {
  if (!isReportId(params.report)) {
    return Response.json({ error: { code: "NOT_FOUND", message: "There is no such report." } }, { status: 404 });
  }
  const r = await reportCsvFor(actor, params.report, new URL(req.url).searchParams);
  if (!r.ok) return Response.json({ error: { code: r.code.toUpperCase(), message: r.error } }, { status: r.code === "forbidden" ? 403 : 400 });
  return new Response(r.value.csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${r.value.fileName}"`,
      "cache-control": "no-store",
    },
  });
});
