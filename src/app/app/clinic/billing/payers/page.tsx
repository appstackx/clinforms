import type { Metadata } from "next";
import { PayerTerms } from "@/components/pms/billing/payer-terms";
import { requireClinicActor } from "@/server/pms/actor";
import { payerTermsFor } from "@/server/pms/billing/views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payer accounts" };

/**
 * /app/clinic/billing/payers: how each payer account bills the patient's part of an insured visit – excess per case
 * (default) or patient contribution per visit (Khuram's decision 28/10/2026). A minimal screen until Set-up has the
 * full payer-account editor (M8). billing.view sees it; changing needs settings.setup (the server checks again).
 */
export default async function PayerAccountsPage() {
  const actor = await requireClinicActor({ permission: "billing.view" });
  const r = await payerTermsFor(actor);
  return <PayerTerms accounts={r.ok ? r.value.accounts : []} canEdit={r.ok && r.value.canEdit} />;
}
