import type { Metadata } from "next";
import { InsurerCodesSetup } from "@/components/pms/billing/insurer-codes-setup";
import { requireClinicActor } from "@/server/pms/actor";
import { insurerCodesFor } from "@/server/pms/billing/healthcode-setup";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Insurer treatment codes" };

/** /app/clinic/setup/insurer-codes[?insurer=] – Set-up → Insurer treatment codes (HC09, settings.setup). */
export default async function InsurerCodesPage({ searchParams }: { searchParams: { insurer?: string } }) {
  const actor = await requireClinicActor({ permission: "settings.setup" });
  const r = await insurerCodesFor(actor, searchParams.insurer ?? null);
  if (!r.ok) return <p role="alert">{r.error}</p>;
  return <InsurerCodesSetup view={r.value} />;
}
