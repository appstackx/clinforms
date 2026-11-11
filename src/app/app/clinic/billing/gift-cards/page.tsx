import type { Metadata } from "next";
import { GiftCardsScreenView } from "@/components/pms/billing/gift-cards";
import { requireClinicActor } from "@/server/pms/actor";
import { giftCardsFor } from "@/server/pms/billing/gift-cards";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Gift cards" };

/**
 * /app/clinic/billing/gift-cards[?card=] (PK04): the clinic's gift cards, what they still hold, look one up by
 * its code (a server action – a code never goes in a URL) and see its history. billing.view. Cards are sold from a patient's Invoices tab and spent with Take payment.
 */
export default async function GiftCardsPage({ searchParams }: { searchParams: { card?: string } }) {
  const actor = await requireClinicActor({ permission: "billing.view" });
  const r = await giftCardsFor(actor, { cardId: searchParams.card ?? null });
  if (!r.ok) return <p role="alert">{r.error}</p>;
  return <GiftCardsScreenView screen={r.value} />;
}
