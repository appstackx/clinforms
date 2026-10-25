import { AppNav, type NavItem } from "@/components/account/app-nav";
import { BrandMark } from "@/components/account/shell";
import { SubmitButton } from "@/components/account/form-controls";
import { roleLabel } from "@/lib/account-copy";
import { WORDING } from "@/modules/medreport/core/wording";
import { isManager } from "@/server/auth/roles";
import { TrialBannerBar } from "@/components/account/trial-banner";
import { noteClinicVisit } from "@/server/admin/clinic-plan";
import { requireAppContext } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getClinicProfile } from "@/server/repos/clinic-profile";
import { SignOutForm } from "../session-forms";

export const dynamic = "force-dynamic";

export default async function ClinicLayout({ children }: { children: React.ReactNode }) {
  const { session, membership } = await requireAppContext();
  const manager = isManager(membership.role);
  // 10/2026: the clinic's trial – an owner's first visit starts a trial that waits for it; the banner says what is left.
  const trial = await noteClinicVisit(getDb(), { tenantId: membership.tenantId, userId: session.user.id, sessionId: session.session.id, role: membership.role });
  // A demo clinic (clinic_profile.demo_clinic, set by ClinForms staff only): the same banner as the Studio.
  const demoClinic = (await getClinicProfile({ db: getDb() }, membership.tenantId).catch(() => null))?.demoClinic === true;
  const items: NavItem[] = [
    { href: "/app", label: "Overview" },
    { href: "/app/studio", label: "Studio" },
    { href: "/app/settings/clinic", label: "Clinic" },
    { href: "/app/settings/members", label: "Members" },
    { href: "/app/settings/security", label: "Security" },
    ...(manager ? [{ href: "/app/settings/api-keys", label: "API keys" }] : []),
    // Every role: owners and administrators see the whole clinic's activity, everyone else their own.
    { href: "/app/settings/activity", label: "Activity" },
  ];
  return (
    <>
      {demoClinic ? (
        <div role="note" data-demo-clinic-banner="" className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-[13px] font-medium text-amber-950">
          {WORDING.demoClinic.banner}
        </div>
      ) : null}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <BrandMark compact />
            <span className="hidden text-slate-300 sm:inline" aria-hidden>
              /
            </span>
            <span className="truncate text-sm font-medium text-slate-800">{membership.clinicName}</span>
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{roleLabel(membership.role)}</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-sm text-slate-600 md:inline">{session.user.email}</span>
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
      <TrialBannerBar access={trial} />
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </>
  );
}
