import type { Metadata } from "next";
import { StockView } from "@/components/pms/billing/products";
import { requireClinicActor } from "@/server/pms/actor";
import { stockScreenFor } from "@/server/pms/billing/products";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Stock" };

/**
 * /app/clinic/billing/stock[?site=] (PK05): products on hand at a site of the member's, their value and low-stock flags,
 * receive and adjust stock (billing.edit), the latest changes. billing.view.
 */
export default async function StockPage({ searchParams }: { searchParams: { site?: string } }) {
  const actor = await requireClinicActor({ permission: "billing.view" });
  const r = await stockScreenFor(actor, searchParams.site ?? null);
  if (!r.ok) return <p role="alert">{r.error}</p>;
  return <StockView screen={r.value} />;
}
