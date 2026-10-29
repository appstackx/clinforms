import { RemittanceForm } from "@/components/pms/billing/remittance-form";
import { ukToday } from "@/modules/pms/core/text";
import { requireClinicActor } from "@/server/pms/actor";
import { payerAccountsFor } from "@/server/pms/billing/views";
import { gatedMetadata } from "@/server/pms/page-gate";

export const dynamic = "force-dynamic";
export const generateMetadata = gatedMetadata({ title: "Allocate an insurer payment" }, "billing.pay");

/**
 * /app/clinic/billing/remittances/new (design round 3 "Remittance allocation"): one insurer payment across their
 * open invoices, short payments left, written off or moved to the patient. billing.pay; writing off and moving
 * need billing.refund (the choices are switched off without it, and the server checks again).
 */
export default async function NewRemittancePage({ searchParams }: { searchParams: { payer?: string } }) {
  const actor = await requireClinicActor({ permission: "billing.pay" });
  const payers = await payerAccountsFor(actor);
  const list = payers.ok ? payers.value : [];
  const initial = typeof searchParams.payer === "string" && list.some((p) => p.id === searchParams.payer) ? searchParams.payer : null;
  return <RemittanceForm payers={list} initialPayer={initial} today={ukToday()} canWriteOff={actor.can("billing.refund")} />;
}
