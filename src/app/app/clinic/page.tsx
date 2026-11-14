import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Dashboard } from "@/components/pms/reporting/dashboard";
import { SITE_COOKIE } from "@/components/pms/shell/site-cookie";
import { requireClinicActor } from "@/server/pms/actor";
import { dashboardFor } from "@/server/pms/reporting/dashboard";
import { getPmsSettings } from "@/server/repos/pms/settings";
import { SampleOfferCard } from "@/components/account/sample-offer";
import { getDb } from "@/server/db";
import { clinicAccessOf, readClinicPlan } from "@/server/repos/clinic-plan";
import { sampleOfferFor } from "@/server/trial/view";
import { RemoveSampleClinicCard, SampleRemovedNotice } from "@/components/account/remove-sample";
import { SAMPLE_REMOVED_PARAM } from "@/lib/trial-copy";
import { sampleRemovalOffer } from "@/server/trial/sample";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Today" };

/**
 * /app/clinic – the clinic system's start page: "Today" per role (design round 3 dashboard, 1440 and 375 px). Replaces
 * the foundation's simple Overview. Every tile is read within the member's sites and permissions
 * (src/server/pms/reporting/dashboard.ts); reception's arrivals follow the shell's chosen site.
 */
export default async function ClinicTodayPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const actor = await requireClinicActor();
  // 13/11/2026: a self-serve trial's owner is offered the separate sample clinic (src/server/trial/sample.ts).
  const [view, settings, plan] = await Promise.all([
    dashboardFor(actor, { siteChoice: cookies().get(SITE_COOKIE)?.value ?? null }),
    getPmsSettings(actor.repo(), actor.tenantId),
    readClinicPlan({ db: getDb() }, actor.tenantId).catch(() => null),
  ]);
  const offer = await sampleOfferFor(getDb(), actor.tenantId, actor.role, plan ? clinicAccessOf(plan) : null);
  // 14/11/2026: after paying, the owner may remove the sample clinic (owner only – re-checked by the action).
  const removable = await sampleRemovalOffer(getDb(), actor.tenantId, actor.userId, actor.role);
  return (
    <>
      {offer ? <SampleOfferCard creating={offer.trial.sampleState === "creating"} /> : null}
      {searchParams?.[SAMPLE_REMOVED_PARAM] === "removed" && !removable ? <SampleRemovedNotice /> : null}
      {removable ? <RemoveSampleClinicCard /> : null}
      <Dashboard view={view} demo={settings.isDemo} />
    </>
  );
}
