import type { Metadata } from "next";
import Link from "next/link";
import { Notice, PageHeader } from "@/components/account/shell";
import { SETUP_COPY } from "@/modules/pms/reporting/copy";
import { SETUP_SECTIONS } from "@/modules/pms/reporting/setup-sections";
import { clinicRoleLabel } from "@/modules/pms/reporting/staff";
import { requireClinicActor } from "@/server/pms/actor";
import { siteScopeOf } from "@/server/pms/reporting/scope";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Clinic set-up" };

export default async function SetupOverviewPage() {
  const actor = await requireClinicActor({ permission: "directory.edit" });
  const scope = await siteScopeOf(actor);
  const sections = SETUP_SECTIONS.filter((s) => actor.can(s.permission));
  return (
    <>
      <PageHeader title={SETUP_COPY.title} description={SETUP_COPY.intro} />
      {!actor.can("settings.manage") ? (
        <div className="mb-4">
          <Notice>As {clinicRoleLabel(actor.role).toLowerCase()} you can keep the referrers and payers up to date. An owner or administrator looks after the rest of the set-up.</Notice>
        </div>
      ) : !scope.all ? (
        <div className="mb-4">
          <Notice>You work at some sites only: you can change those sites, their rooms, hours and closures. {SETUP_COPY.unscopedOnly}</Notice>
        </div>
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((s) => (
          <li key={s.id}>
            <Link href={s.href} className="block h-full rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm hover:border-teal-300 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">
              <span className="block text-sm font-semibold text-slate-900">{s.title}</span>
              <span className="mt-1 block text-sm text-slate-600">{s.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-slate-600">{SETUP_COPY.inactiveNote}</p>
    </>
  );
}
