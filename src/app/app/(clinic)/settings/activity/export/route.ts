/**
 * GET /app/settings/activity/export – the entries shown on the activity page, as CSV: ids and action codes only
 * (no names, emails or details). Same scope as the page (clinicians and staff: only their own entries), same
 * filters, and the page's first and last entry as inclusive bounds (`from`, `to`), so the file holds exactly what
 * was on screen. Each download is itself recorded (audit.export).
 */
import { ACCOUNT_ERRORS } from "@/lib/account-copy";
import {
  activityCsv,
  activityCsvFileName,
  activityQuery,
  activityScope,
  loadActivityPage,
  loadActivityRange,
  parseActivityParams,
} from "@/server/admin/activity";
import { actionContext, auditAction } from "@/server/auth/session";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const ctx = await actionContext();
  if ("error" in ctx) {
    return new Response(ACCOUNT_ERRORS.forbidden, { status: 403, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  const { membership, session } = ctx;
  const scope = activityScope({ tenantId: membership.tenantId, organizationId: membership.organizationId, role: membership.role, userId: session.user.id });
  const params = parseActivityParams(new URL(request.url).searchParams);
  const query = activityQuery(scope, params);
  const db = getDb();
  const entries =
    params.from && params.to
      ? await loadActivityRange({ db }, query, { newest: params.from, oldest: params.to })
      : (await loadActivityPage({ db }, query)).entries;
  await auditAction(ctx, {
    action: "audit.export",
    detail: { rows: entries.length, scope: scope.everyone ? "clinic" : "own", filtered: Boolean(query.action || (scope.everyone && query.userId)) },
  });
  return new Response(activityCsv(entries), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${activityCsvFileName(membership.tenantId)}"`,
      "cache-control": "no-store",
    },
  });
}
