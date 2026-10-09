import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell, Notice } from "@/components/account/shell";
import { hasTwoFactor, requireSignedIn } from "@/server/auth/session";
import { TwoFactorSetup } from "./setup";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Two-step verification" };

export default async function TwoFactorPage() {
  const session = await requireSignedIn({ allowWithoutTwoFactor: true });
  if (hasTwoFactor(session)) {
    return (
      <AuthShell title="Two-step verification">
        <div className="space-y-4">
          <Notice tone="success">Two-step verification is on for {session.user.email}.</Notice>
          <p className="text-sm text-slate-600">
            You can make new backup codes and see where you are signed in under Settings → Security.
          </p>
          <Link href="/app" className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-teal-600 px-4 text-sm font-semibold text-white hover:bg-teal-700">
            Continue
          </Link>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Set up two-step verification" subtitle="Required for every clinic member before using ClinForms.">
      <TwoFactorSetup email={session.user.email} />
    </AuthShell>
  );
}
