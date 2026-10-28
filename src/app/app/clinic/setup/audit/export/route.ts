import { parseAuditSearch } from "@/modules/pms/reporting/schemas";
import { clinicRoute } from "@/server/pms/http";
import { auditCsvFor } from "@/server/pms/reporting/audit-trail";

export const dynamic = "force-dynamic";

/** GET /app/clinic/setup/audit/export?… – the audit search as CSV (settings.members + reports.export; audited). */
export const GET = clinicRoute({ permission: "settings.members" }, async (req, actor) => {
  const r = await auditCsvFor(actor, parseAuditSearch(new URL(req.url).searchParams));
  if (!r.ok) return new Response("Not allowed", { status: r.status });
  return new Response(r.csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-trail-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
});
