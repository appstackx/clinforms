import { PricesSetup } from "@/components/pms/reporting/setup-pages";
import { requireClinicActor } from "@/server/pms/actor";
import { pricesScreenFor } from "@/server/pms/reporting/setup";
import { gatedMetadata } from "@/server/pms/page-gate";

export const dynamic = "force-dynamic";
export const generateMetadata = gatedMetadata({ title: "Price lists" }, "settings.setup");

/** /app/clinic/setup/prices[?list=] – Set-up → Price lists, incl. insurers' own lists (settings.setup). */
export default async function PricesSetupPage({ searchParams }: { searchParams: { list?: string } }) {
  const actor = await requireClinicActor({ permission: "settings.setup" });
  const isNew = searchParams.list === "new";
  const r = await pricesScreenFor(actor, isNew ? null : (searchParams.list ?? null));
  if (!r.ok) return <p role="alert">{r.error}</p>;
  return <PricesSetup screen={r.value} isNew={isNew || r.value.lists.length === 0} />;
}
