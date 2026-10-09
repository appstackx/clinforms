import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell, Notice } from "@/components/account/shell";
import { SubmitButton } from "@/components/account/form-controls";
import { roleLabel } from "@/lib/account-copy";
import { listMemberships } from "@/server/auth/membership";
import { requireSignedIn } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { signOutAction, switchClinicAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Choose a clinic" };

export default async function SelectClinicPage() {
  const session = await requireSignedIn();
  const db = getDb();
  const memberships = await listMemberships(db, session.user.id);
  const invitations = await db
    .selectFrom("invitation")
    .innerJoin("organization", "organization.id", "invitation.organizationId")
    .select(["invitation.id", "invitation.role", "organization.name"])
    .where("invitation.email", "=", session.user.email.toLowerCase())
    .where("invitation.status", "=", "pending")
    .where("invitation.expiresAt", ">", new Date().toISOString())
    .execute();
  return (
    <AuthShell
      title={memberships.length ? "Choose a clinic" : "No clinic yet"}
      footer={
        <form action={signOutAction}>
          <button type="submit" className="font-medium text-teal-700 underline-offset-4 hover:underline">
            Sign out
          </button>
        </form>
      }
    >
      <div className="space-y-4">
        {memberships.length === 0 && invitations.length === 0 ? (
          <Notice>You are not a member of any clinic. Ask your clinic&apos;s owner or an administrator for an invitation.</Notice>
        ) : null}
        {memberships.map((m) => (
          <form key={m.organizationId} action={switchClinicAction} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
            <input type="hidden" name="organizationId" value={m.organizationId} />
            <div>
              <p className="text-sm font-medium">{m.clinicName}</p>
              <p className="text-xs text-slate-500">{roleLabel(m.role)}</p>
            </div>
            <SubmitButton variant="secondary" pendingText="Opening…">
              Open
            </SubmitButton>
          </form>
        ))}
        {invitations.map((inv) => (
          <div key={inv.id} className="flex items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50/50 p-3">
            <div>
              <p className="text-sm font-medium">{inv.name}</p>
              <p className="text-xs text-slate-600">Invitation · {roleLabel(inv.role ?? "")}</p>
            </div>
            <Link href={`/accept-invite?token=${encodeURIComponent(inv.id)}`} className="text-sm font-semibold text-teal-700 hover:underline">
              View
            </Link>
          </div>
        ))}
      </div>
    </AuthShell>
  );
}
