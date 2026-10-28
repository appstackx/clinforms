import type { Metadata } from "next";
import { ServicesSetup } from "@/components/pms/reporting/setup-pages";
import { requireClinicActor } from "@/server/pms/actor";
import { servicesScreenFor } from "@/server/pms/reporting/setup";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Services" };

/** /app/clinic/setup/services[?service=] – Set-up → Services: duration, price, bookable online (settings.setup). */
export default async function ServicesSetupPage({ searchParams }: { searchParams: { service?: string } }) {
  const actor = await requireClinicActor({ permission: "settings.setup" });
  const r = await servicesScreenFor(actor);
  if (!r.ok) return <p role="alert">{r.error}</p>;
  return <ServicesSetup services={r.value.services} serviceId={searchParams.service ?? null} />;
}
