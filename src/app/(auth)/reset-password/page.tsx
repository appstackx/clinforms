import type { Metadata } from "next";
import { AuthShell, Notice, TextLink } from "@/components/account/shell";
import { OWNER_RESET_COPY } from "@/lib/account-copy";
import { COMPANY } from "@/lib/site";
import { emailProviderName } from "@/server/email";
import { NewPasswordForm, RequestResetForm } from "./forms";
import { currentBrand } from "@/server/brand";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reset your password" };

export default function ResetPasswordPage({ searchParams }: { searchParams: { token?: string } }) {
  const token = typeof searchParams.token === "string" ? searchParams.token.slice(0, 200) : "";
  if (token) {
    return (
      <AuthShell productName={currentBrand().productName} title="Choose a new password" footer={<TextLink href="/login">Back to sign in</TextLink>}>
        <NewPasswordForm token={token} />
      </AuthShell>
    );
  }
  const emailOff = emailProviderName() === "none";
  return (
    <AuthShell productName={currentBrand().productName} title="Reset your password" footer={<TextLink href="/login">Back to sign in</TextLink>}>
      {emailOff ? (
        <Notice>
          Ask your clinic&apos;s owner or an administrator to create a password reset link for you (Settings → Members). You will still
          need your authenticator app to sign in. {OWNER_RESET_COPY.soleOwner(COMPANY.contactEmail)}
        </Notice>
      ) : (
        <RequestResetForm />
      )}
    </AuthShell>
  );
}
