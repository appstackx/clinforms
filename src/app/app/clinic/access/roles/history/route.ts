/**
 * Export log: the access change history (role grid and member access) as CSV – when, who, what. No patient data is
 * ever in it. "Manage members and permissions" only.
 */
import { formatUkDateTime, historyCsv } from "@/modules/pms/core/access";
import { accessHistoryFor, nameResolver } from "@/server/pms/access-screens";
import { clinicRoute } from "@/server/pms/http";
import { pmsNow } from "../../../../../../modules/pms/core/clock";

export const dynamic = "force-dynamic";

export const GET = clinicRoute({ permission: "settings.members" }, async (_req, actor) => {
  const r = await accessHistoryFor(actor);
  if (!r.ok) return Response.json({ error: { code: "FORBIDDEN", message: r.error } }, { status: 403 });
  const csv = historyCsv(r.value.changes, nameResolver(r.value.members), formatUkDateTime);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="access-change-log-${pmsNow().toISOString().slice(0, 10)}.csv"`,
    },
  });
});
