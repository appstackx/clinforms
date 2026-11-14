import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CardPaymentsSetup } from "@/components/pms/billing/card-payments-setup";
import { requireClinicActor } from "@/server/pms/actor";
import { cardSetupFor, mayManageCards, refreshAccountFor } from "@/server/pms/billing/connect/service";
import { cardPaymentsAvailable } from "@/server/pms/billing/connect/screen";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Card payments" };

/**
 * /app/clinic/setup/card-payments – Set-up → Card payments (docs/clinic-system/card-payments.md): the clinic's own
 * payment account (connect / continue at the provider, status), on/off, missed-appointment policy, card readers and
 * membership plans. The owner only; behind CLINFORMS_CARD_PAYMENTS=on (off = the 404 page, no navigation entry).
 * ?returned=1 = back from the provider's onboarding: the account is read again first.
 */
export default async function CardPaymentsSetupPage({ searchParams }: { searchParams: { returned?: string; error?: string } }) {
  if (!cardPaymentsAvailable()) notFound();
  const actor = await requireClinicActor({ permission: "settings.owner" });
  if (!mayManageCards(actor)) notFound();
  const returned = searchParams.returned === "1";
  if (returned) await refreshAccountFor(actor);
  const view = await cardSetupFor(actor);
  if (!view.ok) notFound();
  return <CardPaymentsSetup view={view.value} returned={returned} failed={Boolean(searchParams.error)} />;
}
