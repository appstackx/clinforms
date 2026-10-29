import { AuditTrail } from "@/components/pms/reporting/setup-audit";
import { parseAuditSearch } from "@/modules/pms/reporting/schemas";
import { requireClinicActor } from "@/server/pms/actor";
import { auditScreenFor } from "@/server/pms/reporting/audit-trail";
import { gatedMetadata } from "@/server/pms/page-gate";

export const dynamic = "force-dynamic";
export const generateMetadata = gatedMetadata({ title: "Audit trail" }, "settings.members");

/** /app/clinic/setup/audit – Set-up → Audit trail (settings.members; CSV with reports.export). K2-AUD-003. */
export default async function AuditTrailPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const actor = await requireClinicActor({ permission: "settings.members" });
  const params = parseAuditSearch(searchParams);
  const r = await auditScreenFor(actor, params);
  if (!r.ok) return <p role="alert">{r.error}</p>;
  return <AuditTrail screen={r.value} params={params} />;
}
