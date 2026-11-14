import { redirect } from "next/navigation";
import { firstSetupEntry } from "@/components/pms/shell/nav-model";
import { PMS_NAV } from "@/modules/pms/nav";
import { requireClinicActor } from "@/server/pms/actor";
import { clinicApiAvailable } from "@/server/pms/integration/api/screen";
import { xeroAvailable } from "@/server/pms/integration/xero/config";
import { mayManageXero } from "@/server/pms/integration/xero/screen";
import { exercisesAvailable } from "@/server/pms/records/exercises-service";
import { cardPaymentsAvailable } from "@/server/pms/billing/connect/screen";
import { canOpenSetup } from "@/server/pms/reporting/setup";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * /app/clinic/setup – Set-up's start: the first set-up page (design order) this member may open. Entries switched off
 * on this deployment (API keys without CLINFORMS_CLINIC_API=on) are never chosen.
 */
export default async function SetupStartPage() {
  const actor = await requireClinicActor();
  if (!canOpenSetup(actor)) notFound();
  const first = firstSetupEntry(PMS_NAV, actor.can, { clinicApi: clinicApiAvailable(), xero: xeroAvailable() && mayManageXero(actor), exercises: exercisesAvailable(), cardPayments: cardPaymentsAvailable() });
  if (!first) notFound();
  redirect(first.href);
}
