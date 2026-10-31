import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell, TextLink } from "@/components/account/shell";
import { safeNextPath } from "@/server/auth/config";
import { getServerSession, hasTwoFactor } from "@/server/auth/session";
import { LoginForm } from "./login-form";
import { currentBrand, landingPath } from "@/server/brand";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: { next?: string } }) {
  const next = safeNextPath(searchParams.next, landingPath());
  // Fresh (not Better Auth's 5-minute cookie cache): a session revoked meanwhile (password reset, "sign out other
  // devices") must show the form, not bounce between /login and /app.
  const session = await getServerSession({ fresh: true });
  if (session && hasTwoFactor(session)) redirect(next);
  return (
    <AuthShell productName={currentBrand().productName}
      title="Sign in"
      subtitle="Sign in to your clinic's account."
      footer={
        <>
          Accounts are created by invitation from your clinic. New to {currentBrand().productName}?{" "}
          <TextLink href="/request-access">Request access</TextLink>
        </>
      }
    >
      <LoginForm next={next} productName={currentBrand().productName} />
    </AuthShell>
  );
}
