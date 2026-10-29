import { PatientInvoices } from "@/components/pms/billing/patient-billing";
import { requireClinicActor } from "@/server/pms/actor";
import { patientInvoicesFor } from "@/server/pms/billing/views";
import { gatedMetadata } from "@/server/pms/page-gate";

export const dynamic = "force-dynamic";
export const generateMetadata = gatedMetadata({ title: "Invoices" }, "billing.view");

/**
 * A patient's record → Invoices (billing's tab): their invoices (to them and to their insurers), what they owe,
 * Take payment (billing.pay; ?pay=1 opens it – the record's "Take payment" button). billing.view.
 */
export default async function PatientInvoicesPage({ params, searchParams }: { params: { patientId: string }; searchParams: { pay?: string } }) {
  const actor = await requireClinicActor({ permission: "billing.view" });
  const r = await patientInvoicesFor(actor, params.patientId);
  if (!r.ok) return <p role="alert">{r.error}</p>;
  return <PatientInvoices patientId={params.patientId} rows={r.value.rows} balancePence={r.value.balancePence} canPay={actor.can("billing.pay")} openPay={searchParams.pay === "1"} />;
}
