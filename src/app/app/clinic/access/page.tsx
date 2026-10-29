import Link from "next/link";
import { notFound } from "next/navigation";
import { PMS_ROLE_LABELS } from "@/modules/pms/core/permissions";
import { requireClinicActor } from "@/server/pms/actor";
import { loadStaffList } from "@/server/pms/access-screens";
import { gatedMetadata } from "@/server/pms/page-gate";

export const dynamic = "force-dynamic";
export const generateMetadata = gatedMetadata({ title: "Staff access" }, "settings.members");

/**
 * Set-up → Staff access: the clinic's members with their role and the sites they can see; each opens their member
 * access. Members are invited and removed in ClinForms settings → Members (unchanged).
 */
export default async function StaffAccessPage() {
  const actor = await requireClinicActor({ permission: "settings.members" });
  const list = await loadStaffList(actor);
  if (!list.ok) notFound();
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4">
      <nav aria-label="Breadcrumb" className="flex gap-1.5 text-[13px] text-[#64748B]">
        <span>Set-up</span>
        <span aria-hidden>/</span>
        <span aria-current="page">Staff access</span>
      </nav>
      <div className="flex flex-col gap-0.5">
        <h1 className="m-0 text-[22px] font-semibold leading-[30px]">Staff access</h1>
        <p className="text-sm text-[#475569]">
          Role decides what someone can see. Site limits decide where.{" "}
          <Link href="/app/clinic/access/roles" className="text-primary-strong underline underline-offset-2">
            Edit roles and permissions
          </Link>
          . Invite or remove people in{" "}
          <Link href="/app/settings/members" className="text-primary-strong underline underline-offset-2">
            ClinForms settings → Members
          </Link>
          .
        </p>
      </div>
      <div className="relative overflow-x-auto rounded-2xl border border-border bg-white">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <caption className="sr-only">Members of the clinic, their role and the sites they can see</caption>
          <thead>
            <tr className="bg-[#F8FAFC] text-left text-xs font-semibold text-[#475569]">
              <th scope="col" className="px-4 py-2.5">Name</th>
              <th scope="col" className="px-3 py-2.5">Role</th>
              <th scope="col" className="px-3 py-2.5">Can see</th>
              <th scope="col" className="px-4 py-2.5">Access</th>
            </tr>
          </thead>
          <tbody>
            {list.value.members.map((m) => (
              <tr key={m.userId} className="border-t border-border">
                <td className="px-4 py-2.5">
                  <div className="flex flex-col">
                    <Link href={`/app/clinic/access/${encodeURIComponent(m.userId)}`} className="font-semibold text-primary-strong underline-offset-2 hover:underline">
                      {m.name}
                    </Link>
                    <span className="break-all text-xs text-[#64748B]">{m.email}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5">{PMS_ROLE_LABELS[m.role]}</td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {(m.sites ?? ["All sites"]).map((s) => (
                      <span key={s} className="inline-flex h-[22px] items-center whitespace-nowrap rounded-md bg-[#F1F5F9] px-2 text-xs font-medium text-[#334155]">
                        {s}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-[#475569]">
                  {m.access && !m.access.active ? "Deactivated" : Object.keys(m.access?.exceptions ?? {}).length > 0 ? `Role + ${Object.keys(m.access?.exceptions ?? {}).length} exception${Object.keys(m.access?.exceptions ?? {}).length === 1 ? "" : "s"}` : "Role defaults"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
