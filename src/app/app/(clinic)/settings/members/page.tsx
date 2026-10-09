import type { Metadata } from "next";
import { Notice, PageHeader, Panel } from "@/components/account/shell";
import { CopyButton, SubmitButton } from "@/components/account/form-controls";
import { roleLabel } from "@/lib/account-copy";
import { appOrigin, baseUrlSetting } from "@/server/auth/config";
import { listClinicMembers, listPendingInvitations } from "@/server/auth/membership";
import { inviteLink } from "@/server/auth/platform";
import { assignableRoles, isManager } from "@/server/auth/roles";
import { requestHeaders, requireAppContext } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { emailProviderName } from "@/server/email";
import { ukDateTime } from "@/server/email/templates";
import { cancelInvitation, removeMember } from "./actions";
import { InviteForm, ResetLinkForm, RoleForm, SigningForm } from "./forms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Members" };

export default async function MembersPage() {
  const { session, membership } = await requireAppContext();
  const db = getDb();
  const [members, invitations] = await Promise.all([
    listClinicMembers(db, membership.organizationId),
    listPendingInvitations(db, membership.organizationId),
  ]);
  const manager = isManager(membership.role);
  const roles = assignableRoles(membership.role);
  const emailOff = emailProviderName() === "none";
  const origin = appOrigin(baseUrlSetting(), requestHeaders());

  return (
    <>
      <PageHeader title="Members" description="Everyone who can sign in to this clinic's account, and their roles." />
      {manager ? (
        <Panel title="Invite someone" className="mb-6">
          {emailOff ? (
            <div className="mb-4">
              <Notice>Email is not set up yet: after inviting, copy the link shown and pass it on yourself.</Notice>
            </div>
          ) : null}
          <InviteForm roles={roles} emailOff={emailOff} />
        </Panel>
      ) : null}

      {manager && invitations.length > 0 ? (
        <Panel title="Open invitations" className="mb-6">
          <ul className="divide-y divide-slate-100">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{inv.email}</p>
                  <p className="text-xs text-slate-500">
                    {roleLabel(inv.role ?? "")} · expires {ukDateTime(inv.expiresAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <CopyButton value={inviteLink(origin, inv.id)} label="Copy link" />
                  <form action={cancelInvitation}>
                    <input type="hidden" name="invitationId" value={inv.id} />
                    <SubmitButton variant="danger" className="h-8 px-2.5 text-xs" pendingText="Cancelling…" confirmText={`Cancel the invitation for ${inv.email}?`}>
                      Cancel
                    </SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title={`Members (${members.length})`}>
        <ul className="divide-y divide-slate-100">
          {members.map((m) => {
            const isSelf = m.userId === session.user.id;
            const canManageThis = manager && (m.role !== "owner" || membership.role === "owner");
            return (
              <li key={m.memberId} className="py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {m.name} {isSelf ? <span className="text-xs font-normal text-slate-500">(you)</span> : null}
                    </p>
                    <p className="truncate text-xs text-slate-500">{m.email}</p>
                    <p className="mt-1 text-xs text-slate-600">
                      {[m.jobTitle, m.hcpcNumber ? `HCPC ${m.hcpcNumber}` : null, m.canSign ? "May sign" : null].filter(Boolean).join(" · ") ||
                        "No signing details yet"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{roleLabel(m.role ?? "")}</span>
                    {!m.twoFactorEnabled ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Two-step not set up</span>
                    ) : null}
                  </div>
                </div>
                {canManageThis && m.role ? (
                  <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <summary className="cursor-pointer text-sm font-medium text-teal-800">Manage</summary>
                    <div className="mt-3 space-y-5">
                      {!isSelf ? <RoleForm memberId={m.memberId} roles={roles} current={m.role} /> : null}
                      <SigningForm
                        memberId={m.memberId}
                        jobTitle={m.jobTitle ?? ""}
                        hcpcNumber={m.hcpcNumber ?? ""}
                        canSign={m.canSign}
                        staff={m.role === "staff"}
                      />
                      {!isSelf ? <ResetLinkForm memberId={m.memberId} emailOff={emailOff} /> : null}
                      {!isSelf ? (
                        <form action={removeMember}>
                          <input type="hidden" name="memberId" value={m.memberId} />
                          <SubmitButton variant="danger" pendingText="Removing…" confirmText={`Remove ${m.name} from ${membership.clinicName}?`}>
                            Remove from the clinic
                          </SubmitButton>
                        </form>
                      ) : null}
                    </div>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Panel>
    </>
  );
}
