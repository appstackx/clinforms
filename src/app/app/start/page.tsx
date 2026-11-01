import { redirect } from "next/navigation";
import { isManager } from "@/server/auth/roles";
import { requireAppContext } from "@/server/auth/session";
import { requireClinicOnItsHost } from "@/server/brand-home";
import { BRANDS } from "@/lib/brand";
import { clinicPackages } from "@/server/pms/entitlements";

export const dynamic = "force-dynamic";

/**
 * /app/start – where sign-in, two-step set-up, an accepted invitation and a clinic switch land on the clinic brand's
 * host (src/server/brand.ts landingPath; ClinForms' hosts land on /app as before). Signed in with two-step and a
 * member of the active clinic (else the usual redirects). A clinic of the other brand is sent to its own host first
 * (src/server/auth/brand-handoff.ts). Then: the clinic area when the clinic has the clinic package; a clinic created
 * for the clinic brand that has no plan yet → Plan and billing for owners and admins (ClinDesk plans), the overview
 * for everyone else; otherwise the overview.
 */
export default async function AppStartPage() {
  const { membership } = await requireAppContext();
  const brand = await requireClinicOnItsHost(membership.tenantId);
  const packages = await clinicPackages(membership.tenantId);
  if (packages.clinic) redirect(BRANDS.clinic.appHome);
  if (brand === "clinic" && !packages.reports && isManager(membership.role)) redirect("/app/settings/billing");
  redirect("/app");
}
