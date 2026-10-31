import { redirect } from "next/navigation";
import { requireAppContext } from "@/server/auth/session";
import { currentBrand } from "@/server/brand";
import { hasPackage } from "@/server/pms/entitlements";

export const dynamic = "force-dynamic";

/**
 * /app/start – where sign-in, two-step set-up, an accepted invitation and a clinic switch land on the clinic brand's
 * host (src/server/brand.ts landingPath; ClinForms' hosts land on /app as before). Signed in with two-step and a
 * member of the active clinic (else the usual redirects): the clinic area when the clinic has the clinic package,
 * else the ClinForms overview.
 */
export default async function AppStartPage() {
  const { membership } = await requireAppContext();
  const brand = currentBrand();
  redirect(brand.id === "clinic" && (await hasPackage(membership.tenantId, "clinic")) ? brand.appHome : "/app");
}
