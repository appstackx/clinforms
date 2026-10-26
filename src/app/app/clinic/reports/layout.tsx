import { AppNav, type NavItem } from "@/components/account/app-nav";
import { REPORTS, REPORT_IDS, REPORTS_PATH } from "@/modules/pms/reporting/catalogue";
import { requireClinicActor } from "@/server/pms/actor";

export const dynamic = "force-dynamic";

/** /app/clinic/reports – the reports' own navigation. Each page checks access for itself as well. */
export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireClinicActor({ permission: "reports.view" });
  const items: NavItem[] = [
    { href: REPORTS_PATH, label: "Overview", exact: true },
    ...REPORT_IDS.filter((id) => actor.can(REPORTS[id].permission)).map((id) => ({ href: REPORTS[id].href, label: REPORTS[id].title })),
  ];
  return (
    <>
      <div className="mb-6 border-b border-slate-200 pb-2">
        <AppNav items={items} label="Reports" />
      </div>
      {children}
    </>
  );
}
