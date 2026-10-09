import type { Metadata } from "next";
import { AuthShell, Notice, TextLink } from "@/components/account/shell";
import { emailProviderName } from "@/server/email";
import { NewPasswordForm, RequestResetForm } from "./forms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reset your password" };

export default function ResetPasswordPage({ searchParams }: { searchParams: { token?: string } }) {
  const token = typeof searchParams.token === "string" ? searchParams.token.slice(0, 200) : "";
  if (token) {
    return (
      <AuthShell title="Choose a new password" footer={<TextLink href="/login">Back to sign in</TextLink>}>
        <NewPasswordForm token={token} />
      </AuthShell>
    );
  }
  const emailOff = emailProviderName() === "none";
  return (
    <AuthShell title="Reset your password" footer={<TextLink href="/login">Back to sign in</TextLink>}>
      {emailOff ? (
        <Notice>
          Ask your clinic&apos;s owner or an administrator to create a password reset link for you (Settings → Members). You will still
          need your authenticator app to sign in.
        </Notice>
      ) : (
        <RequestResetForm />
      )}
    </AuthShell>
  );
}
