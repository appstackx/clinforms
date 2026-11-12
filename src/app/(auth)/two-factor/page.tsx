import type { Metadata } from "next";
import { AuthShell } from "@/components/account/shell";
import { safeNextPath } from "@/server/auth/config";
import { hasTwoFactor, requireSignedIn } from "@/server/auth/session";
import { TwoFactorSetup } from "./setup";
import { currentBrand, landingPath } from "@/server/brand";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Two-step verification" };

export default async function TwoFactorPage({ searchParams }: { searchParams?: { next?: string } }) {
  const session = await requireSignedIn({ allowWithoutTwoFactor: true });
  const enabled = hasTwoFactor(session);
  const brand = currentBrand();
  return (
    <AuthShell brand={brand} title="Two-step verification" subtitle={enabled ? undefined : `Required for every clinic member before using ${brand.productName}.`}>
      <TwoFactorSetup email={session.user.email} enabled={enabled} productName={brand.productName} continueHref={safeNextPath(searchParams?.next, landingPath())} />
    </AuthShell>
  );
}
