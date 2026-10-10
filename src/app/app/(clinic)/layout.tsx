import { AppNav, type NavItem } from "@/components/account/app-nav";
import { BrandMark } from "@/components/account/shell";
import { SubmitButton } from "@/components/account/form-controls";
import { roleLabel } from "@/lib/account-copy";
import { isManager } from "@/server/auth/roles";
import { requireAppContext } from "@/server/auth/session";
import { SignOutForm } from "../session-forms";

export const dynamic = "force-dynamic";

export default async function ClinicLayout({ children }: { children: React.ReactNode }) {
  const { session, membership } = await requireAppContext();
  const manager = isManager(membership.role);
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
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </>
  );
}
