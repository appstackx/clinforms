import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StudioShell } from "@/modules/medreport/ui/components/shared/studio-shell";
import { getAuth } from "@/server/auth/auth";
import { currentPath, requestHeaders } from "@/server/auth/session";
import { resolveStudioAccess } from "@/server/auth/studio-access";
import { getDb } from "@/server/db";
import { TenantHost } from "./tenant-host";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Studio", template: "%s · ClinForms" },
  robots: { index: false, follow: false },
};

/**
 * /app/studio – a clinic's own Studio: the same screens as the public demo at /reports, in tenant mode
 * (src/app/app/studio/tenant-host.tsx). Checked on the server on every request
 * (src/server/auth/studio-access.ts): no session → /login, no two-step verification → /two-factor, no
 * active clinic → /app/select-clinic. The Edge middleware only redirects requests without a session cookie.
 */
export default async function TenantStudioLayout({ children }: { children: React.ReactNode }) {
  const access = await resolveStudioAccess({ auth: getAuth(), db: getDb(), headers: requestHeaders(), path: currentPath() });
  if (access.kind === "redirect") redirect(access.to);
  const { context } = access;
  return (
    <TenantHost
      clinic={{ tenantId: context.tenantId, name: context.clinicName, draftingEnabled: context.draftingEnabled }}
      member={{
        name: context.member.name,
        userId: context.member.userId,
        role: context.member.role,
        email: context.member.email,
        roleLabel: context.member.roleLabel,
        hcpc: context.member.hcpc,
        jobTitle: context.member.jobTitle,
        canSign: context.member.canSign,
      }}
    >
      <StudioShell>{children}</StudioShell>
    </TenantHost>
  );
}
