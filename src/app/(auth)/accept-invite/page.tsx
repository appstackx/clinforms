import type { Metadata } from "next";
import { AuthShell, Notice, TextLink } from "@/components/account/shell";
import { SubmitButton } from "@/components/account/form-controls";
import { ACCOUNT_ERRORS, roleLabel } from "@/lib/account-copy";
import { authSecret } from "@/server/auth/config";
import { findInvitationForLink } from "@/server/auth/membership";
import { getServerSession } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { ukDateTime } from "@/server/email/templates";
import { signOutForInvite } from "./actions";
import { CreateAccountForm, JoinForm } from "./forms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Accept your invitation" };

export default async function AcceptInvitePage({ searchParams }: { searchParams: { token?: string } }) {
  const token = String(searchParams.token ?? "");
  const invitation = token ? await findInvitationForLink(getDb(), authSecret(), token) : null;
  if (!invitation) {
    return (
      <AuthShell title="Invitation not available" footer={<TextLink href="/login">Sign in</TextLink>}>
        <Notice tone="warning">{ACCOUNT_ERRORS.inviteInvalid} Ask your clinic&apos;s owner or an administrator for a new invitation.</Notice>
      </AuthShell>
    );
  }
  const session = await getServerSession();
  const summary = (
    <p className="mb-4 text-sm text-slate-700">
      You have been invited to join <strong>{invitation.clinicName}</strong> as <strong>{roleLabel(invitation.role ?? "")}</strong>. This
      invitation expires on {ukDateTime(invitation.expiresAt)}.
    </p>
  );

  if (session && session.user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    return (
      <AuthShell title="Accept your invitation">
        {summary}
        <Notice tone="warning">
          You are signed in as {session.user.email}, but this invitation is for {invitation.email}.
        </Notice>
        <form action={signOutForInvite} className="mt-4">
          <input type="hidden" name="token" value={token} />
          <SubmitButton variant="secondary" className="w-full">
            Sign out and continue
          </SubmitButton>
        </form>
      </AuthShell>
    );
  }

  if (session) {
    return (
      <AuthShell title="Accept your invitation">
        {summary}
        <JoinForm token={token} clinicName={invitation.clinicName} />
      </AuthShell>
    );
  }

  if (invitation.accountExists) {
    return (
      <AuthShell title="Accept your invitation">
        {summary}
        <Notice>{ACCOUNT_ERRORS.inviteAccountExists}</Notice>
        <p className="mt-4 text-center text-sm">
          <TextLink href={`/login?next=${encodeURIComponent(`/accept-invite?token=${token}`)}`}>Sign in to accept</TextLink>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create your account" subtitle="Next you will set up two-step verification with an authenticator app.">
      {summary}
      <CreateAccountForm token={token} email={invitation.email} />
    </AuthShell>
  );
}
