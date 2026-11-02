import type { Metadata } from "next";
import { BillingSetup } from "@/components/pms/reporting/setup-pages";
import { HealthcodeSettingsCard } from "@/components/pms/billing/healthcode-setup";
import { requireClinicActor } from "@/server/pms/actor";
import { healthcodeSettingsFor } from "@/server/pms/billing/healthcode-setup";
import { billingSettingsFor } from "@/server/pms/reporting/setup";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Billing settings" };

/** /app/clinic/setup/billing – Set-up → Billing settings (VAT, numbers, terms, charges, bank details – K2-BILL-013;
 * Healthcode Site ID and payee provider number – HC07). */
export default async function BillingSetupPage() {
  const actor = await requireClinicActor({ permission: "settings.setup" });
  const r = await billingSettingsFor(actor);
  if (!r.ok) return <p role="alert">{r.error}</p>;
  const hc = await healthcodeSettingsFor(actor);
  return <BillingSetup settings={r.value} extra={hc.ok ? <HealthcodeSettingsCard view={hc.value} /> : null} />;
}
