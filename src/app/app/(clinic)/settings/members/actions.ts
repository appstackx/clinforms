"use server";
/**
 * Settings → Members (owners and administrators): invite, cancel invitations, change roles, remove members,
 * signing details (job title, HCPC number, may sign) and password reset links. Better Auth enforces the
 * organization rules (only owners make owners, the last owner stays); we check the same before calling it.
 */
import { revalidatePath } from "next/cache";
import { ACCOUNT_ERRORS } from "@/lib/account-copy";
import { isValidHcpc, normaliseHcpc } from "@/lib/hcpc";
import { getAuth } from "@/server/auth/auth";
import { appOrigin, authSecret, baseUrlSetting } from "@/server/auth/config";
import { INVITATION_TTL_SECONDS } from "@/server/auth/create-auth";
import { authErrorMessage } from "@/server/auth/errors";
import { inviteLink, normaliseEmail } from "@/server/auth/platform";
import { assignableRoles, parseMemberRole } from "@/server/auth/roles";
import { actionContext, auditAction, requestHeaders, type ActionResult, type AppContext } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { authBool } from "@/server/db/schema";
import { captureOutbox, emailProviderName, linkToShare } from "@/server/email";
import { upsertMemberProfile } from "@/server/repos/member-profile";

const PATH = "/app/settings/members";

async function manager(): Promise<AppContext | { ok: false; error: string }> {
  const ctx = await actionContext({ manage: true });
  return "error" in ctx ? { ok: false, error: ACCOUNT_ERRORS.forbidden } : ctx;
}

/** A member of the ACTIVE clinic by member id (never trust an id from the form for another clinic). */
async function memberOfClinic(ctx: AppContext, memberId: string) {
  return getDb()
    .selectFrom("member")
    .innerJoin("user", "user.id", "member.userId")
    .select(["member.id", "member.userId", "member.role", "user.email", "user.name"])
    .where("member.id", "=", memberId)
    .where("member.organizationId", "=", ctx.membership.organizationId)
    .executeTakeFirst();
}

export type InviteResult = ActionResult<{ email: string; link: string | null; sent: boolean; expiresAt: string }>;

export async function inviteMember(_prev: InviteResult | null, form: FormData): Promise<InviteResult> {
  const ctx = await manager();
  if ("ok" in ctx) return ctx;
  let email: string;
  try {
    email = normaliseEmail(String(form.get("email") ?? ""));
  } catch {
    return { ok: false, error: ACCOUNT_ERRORS.invalidEmail };
  }
  const role = parseMemberRole(form.get("role"));
  if (!role || !assignableRoles(ctx.membership.role).includes(role)) return { ok: false, error: ACCOUNT_ERRORS.forbidden };
  try {
    const { result, outbox } = await captureOutbox(() =>
      getAuth().api.createInvitation({ body: { email, role, organizationId: ctx.membership.organizationId }, headers: requestHeaders() }),
    );
    const captured = outbox.find((m) => m.message.kind === "invitation");
    const link = linkToShare(captured) ?? (captured ? null : inviteLink(appOrigin(baseUrlSetting(), requestHeaders()), result.id, authSecret()));
    revalidatePath(PATH);
    return {
      ok: true,
      email,
      link,
      sent: captured?.result.status === "sent",
      expiresAt: new Date(Date.now() + INVITATION_TTL_SECONDS * 1000).toISOString(),
    };
  } catch (err) {
    return { ok: false, error: authErrorMessage(err, "invite_member") };
  }
}

export async function cancelInvitation(form: FormData): Promise<void> {
  const ctx = await manager();
  if ("ok" in ctx) return;
  const invitationId = String(form.get("invitationId") ?? "");
  const invitation = await getDb()
    .selectFrom("invitation")
    .select("id")
    .where("id", "=", invitationId)
    .where("organizationId", "=", ctx.membership.organizationId)
    .executeTakeFirst();
  if (!invitation) return;
  try {
    await getAuth().api.cancelInvitation({ body: { invitationId }, headers: requestHeaders() });
  } catch {
    // shown as still open after the refresh
  }
  revalidatePath(PATH);
}

export async function changeRole(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const ctx = await manager();
  if ("ok" in ctx) return ctx;
  const target = await memberOfClinic(ctx, String(form.get("memberId") ?? ""));
  const role = parseMemberRole(form.get("role"));
  if (!target || !role) return { ok: false, error: ACCOUNT_ERRORS.generic };
  const allowed = assignableRoles(ctx.membership.role);
  if (!allowed.includes(role) || (target.role === "owner" && ctx.membership.role !== "owner")) return { ok: false, error: ACCOUNT_ERRORS.forbidden };
  try {
    await getAuth().api.updateMemberRole({ body: { memberId: target.id, role, organizationId: ctx.membership.organizationId }, headers: requestHeaders() });
  } catch (err) {
    return { ok: false, error: authErrorMessage(err, "change_role") };
  }
  if (role === "staff") {
    // Staff never sign: take away the signing permission with the role.
    await upsertMemberProfileKeeping(ctx, target.userId, { canSign: false });
  }
  revalidatePath(PATH);
  return { ok: true };
}

async function upsertMemberProfileKeeping(ctx: AppContext, userId: string, change: { canSign: boolean }): Promise<void> {
  const db = getDb();
  const row = await db
    .selectFrom("member_profile")
    .selectAll()
    .where("organization_id", "=", ctx.membership.organizationId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  if (!row || !authBool(row.can_sign)) return;
  await upsertMemberProfile({ db }, ctx.membership.organizationId, userId, { jobTitle: row.job_title, hcpcNumber: row.hcpc_number, canSign: change.canSign });
}

export async function removeMember(form: FormData): Promise<void> {
  const ctx = await manager();
  if ("ok" in ctx) return;
  const target = await memberOfClinic(ctx, String(form.get("memberId") ?? ""));
  if (!target) return;
  if (target.role === "owner" && ctx.membership.role !== "owner") return;
  try {
    await getAuth().api.removeMember({ body: { memberIdOrEmail: target.id, organizationId: ctx.membership.organizationId }, headers: requestHeaders() });
  } catch {
    // e.g. the last owner: still listed after the refresh
  }
  revalidatePath(PATH);
}

export async function saveMemberProfile(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const ctx = await manager();
  if ("ok" in ctx) return ctx;
  const target = await memberOfClinic(ctx, String(form.get("memberId") ?? ""));
  if (!target) return { ok: false, error: ACCOUNT_ERRORS.generic };
  if (target.role === "owner" && ctx.membership.role !== "owner" && target.userId !== ctx.session.user.id) {
    return { ok: false, error: ACCOUNT_ERRORS.forbidden };
  }
  const jobTitle = String(form.get("jobTitle") ?? "").trim().slice(0, 120) || null;
  const rawHcpc = String(form.get("hcpcNumber") ?? "").trim();
  const hcpcNumber = rawHcpc ? normaliseHcpc(rawHcpc) : null;
  const canSign = form.get("canSign") === "on";
  if (hcpcNumber && !isValidHcpc(hcpcNumber)) return { ok: false, error: ACCOUNT_ERRORS.invalidHcpc };
  if (canSign && !hcpcNumber) return { ok: false, error: ACCOUNT_ERRORS.canSignNeedsHcpc };
  if (canSign && target.role === "staff") return { ok: false, error: ACCOUNT_ERRORS.staffCannotSign };
  await upsertMemberProfile({ db: getDb() }, ctx.membership.organizationId, target.userId, { jobTitle, hcpcNumber, canSign });
  await auditAction(ctx, {
    action: "member.profile_update",
    targetType: "member",
    targetId: target.id,
    detail: { canSign, hasHcpc: Boolean(hcpcNumber), hasJobTitle: Boolean(jobTitle) },
  });
  revalidatePath(PATH);
  return { ok: true };
}

export type ResetLinkResult = ActionResult<{ link: string | null; sent: boolean }>;

export async function createResetLink(_prev: ResetLinkResult | null, form: FormData): Promise<ResetLinkResult> {
  const ctx = await manager();
  if ("ok" in ctx) return ctx;
  const target = await memberOfClinic(ctx, String(form.get("memberId") ?? ""));
  if (!target) return { ok: false, error: ACCOUNT_ERRORS.generic };
  if (target.role === "owner" && ctx.membership.role !== "owner") return { ok: false, error: ACCOUNT_ERRORS.forbidden };
  // A password is account-wide. An account that also belongs to another clinic (where it may be an owner) must
  // never have its reset link handed to THIS clinic's administrator: it can only be emailed to the person.
  const elsewhere = await getDb()
    .selectFrom("member")
    .select("id")
    .where("userId", "=", target.userId)
    .where("organizationId", "!=", ctx.membership.organizationId)
    .executeTakeFirst();
  const refuse = async (reason: string): Promise<ResetLinkResult> => {
    await auditAction(ctx, { action: "auth.password_reset_link_refused", targetType: "user", targetId: target.userId, detail: { reason } });
    return { ok: false, error: ACCOUNT_ERRORS.resetOtherClinic };
  };
  if (elsewhere && emailProviderName() !== "mailersend") return refuse("other_clinic_email_off");
  try {
    const { outbox } = await captureOutbox(() => getAuth().api.requestPasswordReset({ body: { email: target.email }, headers: requestHeaders() }));
    const captured = outbox.find((m) => m.message.kind === "password_reset");
    if (!captured) return { ok: false, error: ACCOUNT_ERRORS.generic };
    if (elsewhere && captured.result.status !== "sent") return refuse("other_clinic_email_failed");
    await auditAction(ctx, { action: "auth.password_reset_link", targetType: "user", targetId: target.userId, detail: { delivery: captured.result.status } });
    return { ok: true, link: linkToShare(captured), sent: captured.result.status === "sent" };
  } catch (err) {
    return { ok: false, error: authErrorMessage(err, "reset_link") };
  }
}
