import Link from "next/link";
import { AppNav, type NavItem } from "@/components/account/app-nav";
import { listMemberships } from "@/server/auth/membership";
import { BrandMark } from "@/components/account/shell";
import { SubmitButton } from "@/components/account/form-controls";
import { roleLabel } from "@/lib/account-copy";
import { CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { isManager } from "@/server/auth/roles";
import { DemoClinicBanner } from "@/components/account/demo-clinic-banner";
import { TrialBannerBar } from "@/components/account/trial-banner";
import { BillingBannerBar } from "@/components/account/billing-banner";
import { billingBannerFor } from "@/server/billing/banner";
import { isDemoClinic, noteClinicVisit } from "@/server/admin/clinic-plan";
import { requireAppContext } from "@/server/auth/session";
import { currentBrand } from "@/server/brand";
import { requireClinicOnItsHost } from "@/server/brand-home";
import { clinicPackages } from "@/server/pms/entitlements";
import { getDb } from "@/server/db";
import { trialBannerState } from "@/server/trial/view";
import { SignOutForm } from "../session-forms";

export const dynamic = "force-dynamic";

export default async function ClinicLayout({ children }: { children: React.ReactNode }) {
  const { session, membership } = await requireAppContext();
  // 01/11/2026: a clinic is used on its own brand's host (src/server/auth/brand-handoff.ts) – never returns otherwise.
  const ownBrand = await requireClinicOnItsHost(membership.tenantId);
  const manager = isManager(membership.role);
  const brand = currentBrand();
  // 10/2026: the clinic's trial – an owner's first visit starts a trial that waits for it; the banner says what is left.
  // A demo clinic (clinic_plan.demo_clinic, set by ClinForms staff only): the same banner as the Studio.
  // Packages (src/server/pms/entitlements.ts, never throws): a clinic without the clinic system sees exactly what it
  // saw before. Read alongside the other two (one round-trip less).
  const [trial, demoClinic, packages, billing, memberships] = await Promise.all([
    noteClinicVisit(getDb(), { tenantId: membership.tenantId, userId: session.user.id, sessionId: session.session.id, role: membership.role }),
    isDemoClinic(getDb(), membership.tenantId),
    clinicPackages(membership.tenantId),
    billingBannerFor(getDb(), membership.tenantId, manager),
    listMemberships(getDb(), session.user.id).catch(() => []),
  ]);
  // 13/11/2026: a self-serve free trial's banner adds its free reports and "Choose a plan" (owners and admins).
  const trialBanner = await trialBannerState(getDb(), membership.tenantId, trial, manager);
  // 01/11/2026 (Khuram's R1): the reports pages (Plan & usage, API keys) only for a clinic that has Reports or is a
  // ClinForms clinic – a ClinDesk clinic without the add-on sees none of them.
  const reportsArea = packages.reports || ownBrand === "clinforms";
  const items: NavItem[] = [
    { href: "/app", label: "Overview" },
    // 01/11/2026: the way into the clinic system, said plainly ("Open ClinDesk").
    ...(packages.clinic ? [{ href: "/app/clinic", label: `Open ${CLINIC_SYSTEM_NAME}` }] : []),
    ...(packages.reports ? [{ href: "/app/studio", label: "Studio" }] : []),
    { href: "/app/settings/clinic", label: "Clinic" },
    { href: "/app/settings/members", label: "Members" },
    { href: "/app/settings/security", label: "Security" },
    // 25/10/2026: every role – owners and administrators see the package and full usage, everyone else "X of N".
    ...(reportsArea ? [{ href: "/app/settings/plan", label: "Plan & usage" }] : []),
    ...(manager ? [{ href: "/app/settings/billing", label: "Plan and billing" }] : []), // 31/10/2026: the plan and paying for it
    ...(manager && reportsArea ? [{ href: "/app/settings/api-keys", label: "API keys" }] : []),
    // Every role: owners and administrators see the whole clinic's activity, everyone else their own.
    { href: "/app/settings/activity", label: "Activity" },
  ];
  return (
    <>
      <DemoClinicBanner on={demoClinic} />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <BrandMark compact name={brand.productName} brand={brand.id} />
            <span className="hidden text-slate-300 sm:inline" aria-hidden>
              /
            </span>
            <span className="truncate text-sm font-medium text-slate-800">{membership.clinicName}</span>
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{roleLabel(membership.role)}</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-sm text-slate-600 md:inline">{session.user.email}</span>
            {memberships.length > 1 ? (
              <Link href="/app/select-clinic" className="text-sm font-medium text-teal-700 underline-offset-4 hover:underline">
                Switch clinic
              </Link>
            ) : null}
            <SignOutForm>
              <SubmitButton variant="secondary" className="h-8 px-3 text-xs" pendingText="Signing out…">
                Sign out
              </SubmitButton>
            </SignOutForm>
          </div>
        </div>
        <div className="mx-auto max-w-5xl px-4 pb-2">
          <AppNav items={items} />
        </div>
      </header>
      <TrialBannerBar access={trialBanner} contactEmail={brand.contactEmail} />
      <BillingBannerBar banner={billing} />
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </>
  );
}
