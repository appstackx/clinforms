import type { Metadata } from "next";
import Link from "next/link";
import { AppNav, type NavItem } from "@/components/account/app-nav";
import { BrandMark } from "@/components/account/shell";
import { SubmitButton } from "@/components/account/form-controls";
import { roleLabel } from "@/lib/account-copy";
import { CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { visibleNav } from "@/modules/pms/core/nav";
import { PMS_NAV } from "@/modules/pms/nav";
import { currentBrand } from "@/server/brand";
import { requireClinicActor } from "@/server/pms/actor";
import { hasPackage } from "@/server/pms/entitlements";
import { SignOutForm } from "../session-forms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: CLINIC_SYSTEM_NAME, template: `%s · ${CLINIC_SYSTEM_NAME}` },
  robots: { index: false, follow: false },
};

/**
 * /app/clinic – the clinic system's shell. Checked on the server on every request (src/server/pms/actor.ts): signed
 * in with two-step verification, a member of the active clinic, and the clinic has the "clinic" package – else the
 * usual sign-in redirects or the 404 page. The navigation comes from each module's nav/<module>.ts, filtered by the
 * member's role. Every page and action below checks again for itself (layouts do not guard server actions).
 */
export default async function ClinicSystemLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireClinicActor();
  const brand = currentBrand();
  const reports = brand.id === "clinforms" && (await hasPackage(actor.tenantId, "reports"));
  const entries = visibleNav(PMS_NAV, actor.can);
  const main: NavItem[] = entries.filter((e) => e.group === "main").map((e) => ({ href: e.href, label: e.label, exact: e.module === "foundation" }));
  const manage: NavItem[] = entries.filter((e) => e.group === "manage").map((e) => ({ href: e.href, label: e.label }));
  return (
    <>
      <a
        href="#clinic-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow"
      >
        Skip to content
      </a>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Link href={brand.id === "clinforms" ? "/app" : "/app/clinic"} className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700" aria-label={`${brand.productName} home`}>
              <BrandMark compact name={brand.productName} />
            </Link>
            <span className="hidden text-slate-300 sm:inline" aria-hidden>
              /
            </span>
            <span className="truncate text-sm font-medium text-slate-800">{actor.clinicName}</span>
            {brand.id === "clinforms" ? (
              <span className="hidden shrink-0 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800 sm:inline">{CLINIC_SYSTEM_NAME}</span>
            ) : null}
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{roleLabel(actor.role)}</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {reports ? (
              <Link href="/app" className="hidden rounded text-sm font-medium text-teal-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 md:inline">
                Clinic account
              </Link>
            ) : null}
            <span className="hidden text-sm text-slate-600 lg:inline">{actor.email}</span>
            <SignOutForm>
              <SubmitButton variant="secondary" className="h-8 px-3 text-xs" pendingText="Signing out…">
                Sign out
              </SubmitButton>
            </SignOutForm>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-4 pb-2">
          <AppNav items={main} label={CLINIC_SYSTEM_NAME} />
          {manage.length > 0 ? (
            <div className="mt-1 flex items-center gap-2 border-t border-slate-100 pt-1">
              <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">Set-up</span>
              <AppNav items={manage} label="Clinic set-up" />
            </div>
          ) : null}
        </div>
      </header>
      <main id="clinic-main" className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        {children}
      </main>
    </>
  );
}
