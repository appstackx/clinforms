/**
 * GET /app/platform/usage/export?month=YYYY-MM[&rate=…] – the platform usage page's month as CSV (ClinForms staff only:
 * a fresh session of a platform administrator, else the ordinary 404). Every text cell is formula-safe (csvCell);
 * number cells are digits only. Each download is recorded (platform.usage_export). Fix 25/10/2026: a cross-site request
 * (another site making the administrator's browser fetch or open this URL – Sec-Fetch-Site) gets the same 404 and
 * writes no audit row.
 */
import { isCrossSiteRequest } from "@/server/admin/fetch-site";
import { platformActionAdmin } from "@/server/admin/guards";
import { appendPlatformAudit } from "@/server/admin/platform-console";
import { getDb } from "@/server/db";
import { platformUsage, platformUsageCsv, platformUsageCsvFileName } from "@/server/usage/view";
import { usageQuery } from "../params";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function GET(request: Request): Promise<Response> {
  if (isCrossSiteRequest(request.headers)) return notFound();
  const admin = await platformActionAdmin();
  if (!admin) return notFound();
  const query = usageQuery(new URL(request.url).searchParams);
  const db = getDb();
  const usage = await platformUsage(db, query.period, query.rate);
  await appendPlatformAudit({ db }, admin, {
    action: "platform.usage_export",
    targetType: "usage",
    targetId: query.period,
    detail: { rows: usage.rows.length, rate: query.rate },
  });
  return new Response(platformUsageCsv(usage), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${platformUsageCsvFileName(query.period)}"`,
      "cache-control": "no-store",
    },
  });
}
