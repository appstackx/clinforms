import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/account/shell";
import { safeNextPath } from "@/server/auth/config";
import { getServerSession, hasTwoFactor } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: { next?: string } }) {
  const next = safeNextPath(searchParams.next);
  const session = await getServerSession();
  if (session && hasTwoFactor(session)) redirect(next);
  return (
    <AuthShell
      title="Sign in"
      subtitle="Sign in to your clinic's account."
      footer={<>Accounts are created by invitation from your clinic.</>}
    >
      <LoginForm next={next} />
    </AuthShell>
  );
}
