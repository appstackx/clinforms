import { BillingSetup } from "@/components/pms/reporting/setup-pages";
import { requireClinicActor } from "@/server/pms/actor";
import { billingSettingsFor } from "@/server/pms/reporting/setup";
import { gatedMetadata } from "@/server/pms/page-gate";

export const dynamic = "force-dynamic";
export const generateMetadata = gatedMetadata({ title: "Billing settings" }, "settings.setup");

/** /app/clinic/setup/billing – Set-up → Billing settings (VAT, numbers, terms, charges, bank details – K2-BILL-013). */
export default async function BillingSetupPage() {
  const actor = await requireClinicActor({ permission: "settings.setup" });
  const r = await billingSettingsFor(actor);
  if (!r.ok) return <p role="alert">{r.error}</p>;
  return <BillingSetup settings={r.value} />;
}
