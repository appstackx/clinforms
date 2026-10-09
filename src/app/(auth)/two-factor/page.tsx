import type { Metadata } from "next";
import { AuthShell } from "@/components/account/shell";
import { hasTwoFactor, requireSignedIn } from "@/server/auth/session";
import { TwoFactorSetup } from "./setup";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Two-step verification" };

export default async function TwoFactorPage() {
  const session = await requireSignedIn({ allowWithoutTwoFactor: true });
  const enabled = hasTwoFactor(session);
  return (
    <AuthShell title="Two-step verification" subtitle={enabled ? undefined : "Required for every clinic member before using ClinForms."}>
      <TwoFactorSetup email={session.user.email} enabled={enabled} />
    </AuthShell>
  );
}
