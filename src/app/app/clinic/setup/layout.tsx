import { AppNav, type NavItem } from "@/components/account/app-nav";
import { SETUP_PATH } from "@/modules/pms/reporting/catalogue";
import { SETUP_SECTIONS } from "@/modules/pms/reporting/setup-sections";
import { requireClinicActor } from "@/server/pms/actor";

export const dynamic = "force-dynamic";

/** /app/clinic/setup – the set-up screens' own navigation. Each page and action checks access for itself. */
export default async function SetupLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireClinicActor({ permission: "directory.edit" });
  const items: NavItem[] = [{ href: SETUP_PATH, label: "Overview", exact: true }, ...SETUP_SECTIONS.filter((s) => actor.can(s.permission)).map((s) => ({ href: s.href, label: s.title }))];
  return (
    <>
      <div className="mb-6 border-b border-slate-200 pb-2">
        <AppNav items={items} label="Set-up" />
      </div>
      {children}
    </>
  );
}
