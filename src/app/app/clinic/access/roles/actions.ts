"use server";
/**
 * Set-up → Roles and permissions: save the changed cells. "Manage members and permissions" first (contract §6); the
 * server layer (src/server/pms/access-screens.ts) checks it again and the repository refuses (and audits) a locked
 * cell.
 */
import { revalidatePath } from "next/cache";
import { formatUkDateTime } from "@/modules/pms/core/access";
import type { AccessPermission, PmsRole } from "@/modules/pms/core/permissions";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { saveRolesFor } from "@/server/pms/access-screens";
import { pmsNow } from "../../../../../modules/pms/core/clock";

export async function saveRoles(changes: { role: PmsRole; permission: AccessPermission; allowed: boolean }[]): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const actor = await clinicActionActor({ permission: "settings.members" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await saveRolesFor(actor, Array.isArray(changes) ? changes : []);
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/app/clinic", "layout");
  const n = r.value.changed;
  const time = formatUkDateTime(pmsNow().toISOString()).slice(11);
  return { ok: true, message: n === 0 ? "Nothing to save – the roles were already like this." : `${n} ${n === 1 ? "change" : "changes"} saved at ${time} by ${actor.name || actor.email}.` };
}
