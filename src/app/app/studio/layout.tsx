import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { DemoClinicBanner } from "@/components/account/demo-clinic-banner";
import { TrialBannerBar } from "@/components/account/trial-banner";
import { BillingBannerBar } from "@/components/account/billing-banner";
import { billingBannerFor } from "@/server/billing/banner";
import { ProductSwitchBar } from "@/components/pms/shell/product-switch";
import { ClinicSystemMark } from "@/components/clindesk/logo";
import { CLINFORMS_NAME, CLINIC_SYSTEM_NAME, REPORTS_ADDON_NAME } from "@/lib/brand";
import { StudioShell } from "@/modules/medreport/ui/components/shared/studio-shell";
import type { StudioBrand } from "@/modules/medreport/ui/host-hooks";
import { getAuth } from "@/server/auth/auth";
import { currentPath, requestHeaders } from "@/server/auth/session";
import { resolveStudioAccess } from "@/server/auth/studio-access";
import { getDb } from "@/server/db";
import { clinicPackages } from "@/server/pms/entitlements";
import { currentBrand } from "@/server/brand";
import { activeClinicPackages, notFoundTitle, requireClinicOnItsHost, studioTitleName } from "@/server/brand-home";
import { TenantHost } from "./tenant-host";
import { trialBannerState } from "@/server/trial/view";

export const dynamic = "force-dynamic";

/**
 * Tab titles by host (01/11/2026, R1/R3): "… · ClinForms" on ClinForms' hosts, "… · ClinDesk" on the clinic brand's
 * (the Studio is its Reports add-on). A clinic without Reports gets the 404 page – titled as one (a template without
 * "%s" names every page below it the same).
 */
export async function generateMetadata(): Promise<Metadata> {
  const robots = { index: false, follow: false };
  const packages = await activeClinicPackages();
  if (packages && !packages.reports) return { title: { default: notFoundTitle(), template: notFoundTitle() }, robots };
  return { title: { default: "Studio", template: `%s · ${studioTitleName()}` }, robots };
}

/**
 * /app/studio – a clinic's own Studio: the same screens as the public demo at /reports, in tenant mode
 * (src/app/app/studio/tenant-host.tsx). Checked on the server on every request
 * (src/server/auth/studio-access.ts): no session → /login, no two-step verification → /two-factor, no
 * active clinic → /app/select-clinic; Reports package switched off → the 404 page. The Edge middleware only
 * redirects requests without a session cookie.
 * A demo clinic (made-up data only, set by ClinForms staff) shows the demo banner above the Studio on every page.
 * A clinic that also has the clinic system (10/2026) gets the product switch above the Studio; nothing changes for any
 * other clinic.
 */
/**
 * The brand the Studio's own chrome is shown under (01/11/2026, F4): none on ClinForms' hosts (ClinForms' mark and name,
 * as before); on the clinic brand's host the clinic system's mark, "Reports" in the header, "<clinic system> Reports"
 * in the footer and the clinic system's name where the Studio's copy names the product.
 */
function studioBrandFor(brand: ReturnType<typeof currentBrand>): StudioBrand | undefined {
  if (brand.id !== "clinic") return undefined;
  return {
    productName: brand.productName,
    studioName: REPORTS_ADDON_NAME,
    footerName: `${brand.productName} ${REPORTS_ADDON_NAME}`,
    mark: <ClinicSystemMark className="h-8 w-8 shrink-0" />,
  };
}

export default async function TenantStudioLayout({ children }: { children: React.ReactNode }) {
  const access = await resolveStudioAccess({ auth: getAuth(), db: getDb(), headers: requestHeaders(), path: currentPath() });
  if (access.kind === "redirect") redirect(access.to);
  const { context } = access;
  // 01/11/2026: a clinic is used on its own brand's host (src/server/auth/brand-handoff.ts).
  await requireClinicOnItsHost(context.tenantId);
  // A clinic with the Reports package switched off (a clinic-system-only clinic) has no Studio.
  // Both packages in one read (src/server/pms/entitlements.ts, never throws: Reports on, clinic system off if unreadable).
  const manager = context.member.role === "owner" || context.member.role === "admin";
  // 13/11/2026: a self-serve free trial's banner adds its free reports and "Choose a plan" (src/server/trial/view.ts).
  const [packages, billing, trial] = await Promise.all([clinicPackages(context.tenantId), billingBannerFor(getDb(), context.tenantId, manager), trialBannerState(getDb(), context.tenantId, context.trial, manager)]);
  if (!packages.reports) notFound();
  const clinicSystem = packages.clinic;
  // The host brand's contact (src/lib/brand.ts): the trial banner and the Studio's "contact us" lines.
  const hostBrand = currentBrand();
  const contactEmail = hostBrand.contactEmail;
  const studioBrand = studioBrandFor(hostBrand);
  return (
    <>
      {clinicSystem ? <ProductSwitchBar clinicSystemName={CLINIC_SYSTEM_NAME} clinicHref="/app/clinic" reportsName={hostBrand.id === "clinic" ? REPORTS_ADDON_NAME : CLINFORMS_NAME} /> : null}
      {/* A demo clinic (made-up data only; clinic_plan.demo_clinic read on the server): the banner, and the header pill. */}
      <DemoClinicBanner on={context.demoClinic} />
      <TrialBannerBar access={trial} contactEmail={contactEmail} />
      <BillingBannerBar banner={billing} />
      <TenantHost
        supportEmail={contactEmail}
        {...(studioBrand ? { brand: studioBrand } : {})}
        clinic={{
          tenantId: context.tenantId,
          name: context.clinicName,
          draftingEnabled: context.draftingEnabled,
          clinicians: context.clinicians,
          ...(context.signers ? { signers: context.signers } : {}),
          demoClinic: context.demoClinic,
        }}
        member={{
          name: context.member.name,
          userId: context.member.userId,
          role: context.member.role,
          email: context.member.email,
          roleLabel: context.member.roleLabel,
          hcpc: context.member.hcpc,
          jobTitle: context.member.jobTitle,
          canSign: context.member.canSign,
        }}
      >
        <StudioShell>{children}</StudioShell>
      </TenantHost>
    </>
  );
}
