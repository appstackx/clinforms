import type { Metadata } from "next";
import { PractitionersSetup } from "@/components/pms/reporting/setup-pages";
import { requireClinicActor } from "@/server/pms/actor";
import { practitionersScreenFor } from "@/server/pms/reporting/setup";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Practitioners" };

/** /app/clinic/setup/practitioners[?practitioner=] – Set-up → Practitioners, incl. linking a member's sign-in (settings.setup). */
export default async function PractitionersSetupPage({ searchParams }: { searchParams: { practitioner?: string } }) {
  const actor = await requireClinicActor({ permission: "settings.setup" });
  const isNew = searchParams.practitioner === "new";
  const r = await practitionersScreenFor(actor, isNew ? null : (searchParams.practitioner ?? null));
  if (!r.ok) return <p role="alert">{r.error}</p>;
  return <PractitionersSetup screen={r.value} isNew={isNew || r.value.practitioners.length === 0} />;
}
