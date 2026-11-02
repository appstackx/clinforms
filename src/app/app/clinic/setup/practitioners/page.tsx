import type { Metadata } from "next";
import { PractitionersSetup } from "@/components/pms/reporting/setup-pages";
import { PractitionerInsurerNumbersCard } from "@/components/pms/billing/healthcode-setup";
import { requireClinicActor } from "@/server/pms/actor";
import { practitionerInsurerNumbersFor } from "@/server/pms/billing/healthcode-setup";
import { practitionersScreenFor } from "@/server/pms/reporting/setup";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Practitioners" };

/** /app/clinic/setup/practitioners[?practitioner=] – Set-up → Practitioners, incl. linking a member's sign-in (settings.setup). */
export default async function PractitionersSetupPage({ searchParams }: { searchParams: { practitioner?: string } }) {
  const actor = await requireClinicActor({ permission: "settings.setup" });
  const isNew = searchParams.practitioner === "new";
  const r = await practitionersScreenFor(actor, isNew ? null : (searchParams.practitioner ?? null));
  if (!r.ok) return <p role="alert">{r.error}</p>;
  // The practitioner's provider number with each insurer (HC08, docs/clinic-system/healthcode.md).
  const hc = isNew ? null : await practitionerInsurerNumbersFor(actor, r.value.selected?.id ?? null);
  const extra = hc?.ok && hc.value ? <PractitionerInsurerNumbersCard key={`pin-${hc.value.practitionerId}`} view={hc.value} /> : null;
  return <PractitionersSetup screen={r.value} isNew={isNew || r.value.practitioners.length === 0} extra={extra} />;
}
