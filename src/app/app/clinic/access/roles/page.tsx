import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RolesGrid } from "@/components/pms/access/roles-grid";
import { describeChangeItem, formatUkDateTime, overridesFor } from "@/modules/pms/core/access";
import { ACCESS_PERMISSION_DEFS, PMS_ROLES, rolePermission } from "@/modules/pms/core/permissions";
import { requireClinicActor } from "@/server/pms/actor";
import { loadRolesScreen } from "@/server/pms/access-screens";
import { saveRoles } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Roles and permissions" };

/** Set-up → Roles and permissions (design round 2). Owners and admins by default ("Manage members and permissions"). */
export default async function RolesPage() {
  const actor = await requireClinicActor({ permission: "settings.members" });
  const screen = await loadRolesScreen(actor);
  if (!screen.ok) notFound();
  const saved: Record<string, boolean> = {};
  for (const r of PMS_ROLES) {
    const o = overridesFor(r, screen.value.overrides);
    for (const d of ACCESS_PERMISSION_DEFS) saved[`${d.id}|${r}`] = rolePermission(r, d.id, o);
  }
  return (
    <RolesGrid
      saved={saved}
      counts={screen.value.counts}
      history={screen.value.history.map((h) => ({ when: formatUkDateTime(h.at), who: h.who, items: h.items.map(describeChangeItem) }))}
      memberAccessHref="/app/clinic/access"
      exportHref="/app/clinic/access/roles/history"
      save={saveRoles}
    />
  );
}
