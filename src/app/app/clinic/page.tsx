import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Dashboard } from "@/components/pms/reporting/dashboard";
import { SITE_COOKIE } from "@/components/pms/shell/site-cookie";
import { requireClinicActor } from "@/server/pms/actor";
import { dashboardFor } from "@/server/pms/reporting/dashboard";
import { getPmsSettings } from "@/server/repos/pms/settings";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Today" };

/**
 * /app/clinic – the clinic system's start page: "Today" per role (design round 3 dashboard, 1440 and 375 px). Replaces
 * the foundation's simple Overview. Every tile is read within the member's sites and permissions
 * (src/server/pms/reporting/dashboard.ts); reception's arrivals follow the shell's chosen site.
 */
export default async function ClinicTodayPage() {
  const actor = await requireClinicActor();
  const [view, settings] = await Promise.all([dashboardFor(actor, { siteChoice: cookies().get(SITE_COOKIE)?.value ?? null }), getPmsSettings(actor.repo(), actor.tenantId)]);
  return <Dashboard view={view} demo={settings.isDemo} />;
}
