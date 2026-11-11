import type { Metadata } from "next";
import { ProductsSetup } from "@/components/pms/billing/products";
import { requireClinicActor } from "@/server/pms/actor";
import { productsScreenFor } from "@/server/pms/billing/products";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Products" };

/** /app/clinic/setup/products[?product=] – Set-up → Products (PK05, settings.setup): what the clinic sells over the counter. */
export default async function ProductsSetupPage({ searchParams }: { searchParams: { product?: string } }) {
  const actor = await requireClinicActor({ permission: "settings.setup" });
  const r = await productsScreenFor(actor);
  if (!r.ok) return <p role="alert">{r.error}</p>;
  return <ProductsSetup screen={r.value} productId={searchParams.product ?? null} />;
}
