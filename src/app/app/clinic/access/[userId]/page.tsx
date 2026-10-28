import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MemberAccessForm } from "@/components/pms/access/member-access-form";
import { describeChangeItem, formatUkDateTime } from "@/modules/pms/core/access";
import { requireClinicActor } from "@/server/pms/actor";
import { loadMemberScreen } from "@/server/pms/access-screens";
import { saveMemberAccessAction, setMemberActiveAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Member access" };

/** Staff access → one member (design round 2). Owners and admins by default ("Manage members and permissions"). */
export default async function MemberAccessPage({ params }: { params: { userId: string } }) {
  const actor = await requireClinicActor({ permission: "settings.members" });
  const userId = decodeURIComponent(params.userId ?? "");
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(userId)) notFound();
  const screen = await loadMemberScreen(actor, userId);
  if (!screen.ok) notFound();
  const s = screen.value;
  const last = s.lastChange;
  return (
    <MemberAccessForm
      key={s.member.userId}
      member={{ userId: s.member.userId, name: s.member.name, email: s.member.email, role: s.member.role, twoStep: s.member.twoStep }}
      access={{ active: s.access.active, allSites: s.access.allSites, sites: s.access.sites, exceptions: s.access.exceptions, rev: s.access.rev }}
      overrides={s.overrides}
      sites={s.sites.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name }))}
      signing={{ registrationNumber: s.registrationNumber, title: s.professionTitle }}
      lastChanged={last ? `Last changed ${formatUkDateTime(last.at)} by ${last.who}: ${last.items.map(describeChangeItem).join("; ")}.` : null}
      readOnly={s.readOnly}
      assignable={s.assignable}
      rolesHref="/app/clinic/access/roles"
      staffHref="/app/clinic/access"
      save={saveMemberAccessAction}
      setActive={setMemberActiveAction}
    />
  );
}
