import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell, Notice, TextLink } from "@/components/account/shell";
import { safeNextPath } from "@/server/auth/config";
import { getServerSession, hasTwoFactor } from "@/server/auth/session";
import { LoginForm } from "./login-form";
import { currentBrand, landingPath } from "@/server/brand";
import { SIGNUP_PATH } from "@/lib/self-signup";
import { signupBrandForPage } from "@/server/signup/request";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: { next?: string; moved?: string } }) {
  const next = safeNextPath(searchParams.next, landingPath());
  // Fresh (not Better Auth's 5-minute cookie cache): a session revoked meanwhile (password reset, "sign out other
  // devices") must show the form, not bounce between /login and /app.
  const session = await getServerSession({ fresh: true });
  if (session && hasTwoFactor(session)) redirect(next);
  return (
    <AuthShell brand={currentBrand()}
      title="Sign in"
      subtitle="Sign in to your clinic's account."
      footer={
        signupBrandForPage() ? (
          // Self-serve sign-up switched on for this host (CLINFORMS_SELF_SIGNUP, docs/auth.md §1b).
          <>
            New to {currentBrand().productName}? <TextLink href={SIGNUP_PATH}>Start a free trial</TextLink>
          </>
        ) : (
          <>
            Accounts are created by invitation from your clinic. New to {currentBrand().productName}?{" "}
            <TextLink href="/request-access">Request access</TextLink>
          </>
        )
      }
    >
      {/* 01/11/2026: sent here from the other brand's host (src/server/auth/brand-handoff.ts) – sessions are per site. */}
      {searchParams.moved === "1" ? (
        <div className="mb-4" data-testid="login-moved">
          <Notice>Your clinic uses {currentBrand().productName} at this address. Please sign in here – the same email and password.</Notice>
        </div>
      ) : null}
      <LoginForm next={next} productName={currentBrand().productName} />
    </AuthShell>
  );
}
