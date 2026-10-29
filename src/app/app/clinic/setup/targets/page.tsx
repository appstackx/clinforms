import { TargetsSetup } from "@/components/pms/reporting/setup-pages";
import { requireClinicActor } from "@/server/pms/actor";
import { targetsFor } from "@/server/pms/reporting/setup";
import { gatedMetadata } from "@/server/pms/page-gate";

export const dynamic = "force-dynamic";
export const generateMetadata = gatedMetadata({ title: "Report targets" }, "settings.setup");

/** /app/clinic/setup/targets – Set-up → Report targets (utilisation and DNA). */
export default async function TargetsSetupPage() {
  const actor = await requireClinicActor({ permission: "settings.setup" });
  const r = await targetsFor(actor);
  if (!r.ok) return <p role="alert">{r.error}</p>;
  return <TargetsSetup settings={r.value} />;
}
