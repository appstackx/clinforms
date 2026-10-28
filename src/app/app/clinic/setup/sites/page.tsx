import type { Metadata } from "next";
import { SitesSetup } from "@/components/pms/reporting/setup-sites";
import { requireClinicActor } from "@/server/pms/actor";
import { sitesScreenFor } from "@/server/pms/reporting/setup";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sites and opening hours" };

/**
 * /app/clinic/setup/sites[?site=] – Set-up → Sites and hours (settings.setup): the sites the member works at, one
 * site's details, opening hours and closures. The hours are the ONE opening-hours source: the diary's rota windows,
 * free slots and online booking are clipped to them.
 */
export default async function SitesSetupPage({ searchParams }: { searchParams: { site?: string } }) {
  const actor = await requireClinicActor({ permission: "settings.setup" });
  const r = await sitesScreenFor(actor, typeof searchParams.site === "string" ? searchParams.site : null);
  if (!r.ok) return <p role="alert">{r.error}</p>;
  return <SitesSetup screen={r.value} />;
}
