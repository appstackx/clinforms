"use server";
/**
 * Staff access → one member: save their access (role, exceptions, sites) and switch their clinic-system access off
 * or on. "Manage members and permissions" first (contract §6); the server layer checks it again, refuses changes to
 * the owner and to one's own access, and the repository refuses (and audits) a locked exception.
 *
 * A role change goes through Better Auth (the same call and rules as ClinForms settings → Members: owners and admins
 * only, never to or from "owner" here); reception never signs, so their ClinForms signing permission is taken away
 * with the role, as ClinForms does.
 */
import { revalidatePath } from "next/cache";
import { formatUkDateTime, type MemberSite } from "@/modules/pms/core/access";
import { isPmsRole, type AccessPermission, type PmsRole } from "@/modules/pms/core/permissions";
import { getAuth } from "@/server/auth/auth";
import { authErrorMessage } from "@/server/auth/errors";
import { requestHeaders } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { authBool } from "@/server/db/schema";
import { listClinicMembers, roleChangeAllowed, saveMemberAccessFor, saveSigningDetailsFor, setMemberActiveFor, type SigningView } from "@/server/pms/access-screens";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { upsertMemberProfile } from "@/server/repos/member-profile";

type Done = { ok: true; message: string } | { ok: false; error: string };

export async function saveMemberAccessAction(input: {
  userId: string;
  role: PmsRole;
  exceptions: Partial<Record<AccessPermission, boolean>>;
  allSites: boolean;
  sites: MemberSite[];
  expectedRev: number;
}): Promise<Done> {
  const actor = await clinicActionActor({ permission: "settings.members" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!input || typeof input.userId !== "string" || !isPmsRole(input.role) || !Number.isInteger(input.expectedRev)) return { ok: false, error: "Some details need checking." };
  const member = (await listClinicMembers(actor)).find((m) => m.userId === input.userId);
  if (!member) return { ok: false, error: "This person is not a member of this clinic." };
  let roleChange: { from: PmsRole; to: PmsRole } | null = null;
  if (member.role !== input.role) {
    const check = await roleChangeAllowed(actor, input.userId, input.role);
    if (!check.ok) return { ok: false, error: "You do not have permission to change this person's role." };
    try {
      await getAuth().api.updateMemberRole({ body: { memberId: member.memberId, role: input.role, organizationId: actor.organizationId }, headers: requestHeaders() });
    } catch (err) {
      return { ok: false, error: authErrorMessage(err, "change_role") };
    }
    if (input.role === "staff") await clearCanSign(actor.organizationId, input.userId);
    roleChange = { from: member.role, to: input.role };
  }
  const r = await saveMemberAccessFor(actor, input.userId, { exceptions: input.exceptions ?? {}, allSites: input.allSites === true, sites: Array.isArray(input.sites) ? input.sites : [] }, input.expectedRev, roleChange);
  if (!r.ok) return { ok: false, error: roleChange ? `The role was changed, but the rest was not saved: ${r.error}` : r.error };
  revalidatePath("/app/clinic", "layout");
  const time = formatUkDateTime(new Date().toISOString()).slice(11);
  if (r.value.changed === 0 && !roleChange) return { ok: true, message: "Nothing to save – their access was already like this." };
  return { ok: true, message: `Saved ${time} by ${actor.name || actor.email}. They will see the changes next time a page loads.` };
}

export async function setMemberActiveAction(userId: string, active: boolean): Promise<Done> {
  const actor = await clinicActionActor({ permission: "settings.members" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await setMemberActiveFor(actor, String(userId), active === true);
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/app/clinic", "layout");
  return { ok: true, message: active ? "Clinic-system access switched back on." : "Deactivated: they can no longer open anything in the clinic system." };
}

async function clearCanSign(organizationId: string, userId: string): Promise<void> {
  const db = getDb();
  const row = await db.selectFrom("member_profile").selectAll().where("organization_id", "=", organizationId).where("user_id", "=", userId).executeTakeFirst();
  if (!row || !authBool(row.can_sign)) return;
  await upsertMemberProfile({ db }, organizationId, userId, { jobTitle: row.job_title, hcpcNumber: row.hcpc_number, canSign: false });
}

/**
 * Member access → "Signing details": register, registration number and "may sign" on the member's practitioner
 * record (created when they have none). Owners and administrators (settings.members); validated and audited in the
 * server layer (HCPC: PH + digits; PH-DEMO-NN only in a demo clinic).
 */
export async function saveSigningDetailsAction(input: { userId: string; registrationBody: string; registrationNumber: string; maySign: boolean }): Promise<
  { ok: true; message: string; signing: SigningView } | { ok: false; error: string; fieldErrors?: Record<string, string> }
> {
  const actor = await clinicActionActor({ permission: "settings.members" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!input || typeof input.userId !== "string") return { ok: false, error: "Some details need checking." };
  const r = await saveSigningDetailsFor(actor, input.userId, { registrationBody: String(input.registrationBody ?? ""), registrationNumber: String(input.registrationNumber ?? ""), maySign: input.maySign === true });
  if (!r.ok) return { ok: false, error: r.error, fieldErrors: r.fieldErrors };
  revalidatePath("/app/clinic", "layout");
  return { ok: true, message: "Signing details saved.", signing: r.value };
}
