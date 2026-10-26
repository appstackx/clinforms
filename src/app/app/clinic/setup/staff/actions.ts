"use server";
/**
 * Set-up → Staff and access. Owners and administrators who cover the whole clinic. Roles and invitations go
 * through ClinForms' own member actions (one implementation for the whole product: the same checks – only owners
 * make owners, the last owner stays – and the same audit entries). Site access and the diary link are the clinic
 * system's own (audited by the repositories).
 */
import { revalidatePath } from "next/cache";
import { changeRole, inviteMember } from "@/app/app/(clinic)/settings/members/actions";
import { SETUP_PATH } from "@/modules/pms/reporting/catalogue";
import { all, checkbox, text, type FormResult } from "@/modules/pms/reporting/forms";
import { canBeSiteLimited, clinicRoleLabel } from "@/modules/pms/reporting/staff";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { CONFLICT, NOT_FOUND, NOT_WHOLE_CLINIC, failed } from "@/server/pms/reporting/action-results";
import { coversWholeClinic, siteScopeOf } from "@/server/pms/reporting/scope";
import { clinicMember } from "@/server/pms/reporting/staff";
import { findPractitionerByUser, getPractitioner, updatePractitioner } from "@/server/repos/pms/directory";
import { setStaffAccess } from "@/server/repos/pms/reporting/staff-access";

const PATH = `${SETUP_PATH}/staff`;

export type InviteStaffResult = FormResult & { link?: string | null };

export async function saveSiteAccessAction(_prev: FormResult | null, form: FormData): Promise<FormResult> {
  const actor = await clinicActionActor({ permission: "settings.manage" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!coversWholeClinic(await siteScopeOf(actor))) return NOT_WHOLE_CLINIC;
  const member = await clinicMember(actor, text(form, "userId") ?? "");
  if (!member) return NOT_FOUND;
  if (!canBeSiteLimited(member.role)) return { ok: false, error: "Owners always work at every site." };
  if (member.userId === actor.userId) return { ok: false, error: "Ask another owner or administrator to change your own site access." };
  const rev = Number(text(form, "rev"));
  const input = { allSites: checkbox(form, "allSites"), siteIds: all(form, "siteIds") };
  if (!input.allSites && input.siteIds.length === 0) return { ok: false, error: "Choose at least one site, or every site.", fieldErrors: { siteIds: "Choose at least one site, or every site" } };
  try {
    const saved = await setStaffAccess(actor.repo(), actor.tenantId, member.userId, Number.isInteger(rev) && rev >= 0 ? rev : 0, input, actor.actor);
    if (!saved.ok) return saved.reason === "conflict" ? CONFLICT : NOT_FOUND;
    revalidatePath(PATH);
    return { ok: true, message: input.allSites ? `${member.name} works at every site.` : `${member.name} works at ${input.siteIds.length} ${input.siteIds.length === 1 ? "site" : "sites"}.` };
  } catch (err) {
    return failed(err, "staff_access.set");
  }
}

export async function changeClinicRoleAction(prev: FormResult | null, form: FormData): Promise<FormResult> {
  const actor = await clinicActionActor({ permission: "settings.manage" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!coversWholeClinic(await siteScopeOf(actor))) return NOT_WHOLE_CLINIC;
  const result = await changeRole(prev && prev.ok ? { ok: true } : null, form);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath(PATH);
  return { ok: true, message: `Role changed to ${clinicRoleLabel(text(form, "role")).toLowerCase()}.` };
}

export async function inviteStaffAction(_prev: InviteStaffResult | null, form: FormData): Promise<InviteStaffResult> {
  const actor = await clinicActionActor({ permission: "settings.manage" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!coversWholeClinic(await siteScopeOf(actor))) return NOT_WHOLE_CLINIC;
  const result = await inviteMember(null, form);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath(PATH);
  return {
    ok: true,
    message: result.sent ? `Invitation emailed to ${result.email}.` : `Invitation for ${result.email} created. Email is not set up: copy the link and pass it on yourself.`,
    link: result.sent ? null : result.link,
  };
}

export async function linkPractitionerAction(_prev: FormResult | null, form: FormData): Promise<FormResult> {
  const actor = await clinicActionActor({ permission: "settings.manage" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!coversWholeClinic(await siteScopeOf(actor))) return NOT_WHOLE_CLINIC;
  const member = await clinicMember(actor, text(form, "userId") ?? "");
  if (!member) return NOT_FOUND;
  const ctx = actor.repo();
  const wanted = text(form, "practitionerId") ?? "";
  try {
    const current = await findPractitionerByUser(ctx, actor.tenantId, member.userId);
    if (current && current.id === wanted) return { ok: true, message: "No change." };
    const target = wanted ? await getPractitioner(ctx, actor.tenantId, wanted) : null;
    if (wanted && !target) return NOT_FOUND;
    if (target?.userId && target.userId !== member.userId) return { ok: false, error: `${target.displayName} is already linked to another member.` };
    if (current) await updatePractitioner(ctx, actor.tenantId, current.id, { userId: null }, actor.actor);
    if (target) await updatePractitioner(ctx, actor.tenantId, target.id, { userId: member.userId }, actor.actor);
    revalidatePath(PATH);
    return { ok: true, message: target ? `${member.name} is linked to ${target.displayName}.` : `${member.name} is no longer linked to a practitioner.` };
  } catch (err) {
    return failed(err, "practitioner.link");
  }
}
