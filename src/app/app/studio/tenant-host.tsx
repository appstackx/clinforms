"use client";

/**
 * Client-side host glue for a clinic's own Studio (/app/studio): the module's HostHooks in tenant mode.
 * The module never imports the app; this file (in src/app) is allowed to touch both.
 *
 * - basePath "/app/studio", mode "tenant": the screens link here and hide every demo-only control.
 * - storage "server": reports and form maps are kept for the clinic on the server (ui/store.ts reads it).
 * - clinic, member: worked out on the server by the layout (src/server/auth/studio-access.ts); the member is
 *   the default signer and the name on activity entries.
 * - track: the consent-gated, allow-listed analytics (src/components/analytics), tagged area "app".
 * - onSignOut: the shared sign-out, then /login loaded in full (fix wave 2: nothing in memory survives).
 * - No onDocumentFiled / onResetDemo / clinicRecordUrl: there is no simulated record or demo state here.
 */
import { useMemo, type ReactNode } from "react";
import { track } from "@/components/analytics";
import { HostHooksProvider, type HostHooks, type StudioClinic, type StudioMember } from "@/modules/medreport/ui/host-hooks";
import { signOutAndReload } from "../session-forms";

export const TENANT_STUDIO_BASE_PATH = "/app/studio";

/** The hooks a clinic's Studio runs with (exported for the render tests). */
export function tenantHooks(clinic: StudioClinic, member: StudioMember, options: { onSignOut?: () => Promise<void> | void } = {}): HostHooks {
  return {
    basePath: TENANT_STUDIO_BASE_PATH,
    mode: "tenant",
    storage: "server",
    clinic,
    member,
    accountHref: "/app",
    track: (event, props) => track(event, { ...props, area: "app" }),
    ...(options.onSignOut ? { onSignOut: options.onSignOut } : {}),
  };
}

export function TenantHost({ clinic, member, children }: { clinic: StudioClinic; member: StudioMember; children: ReactNode }) {
  const { tenantId, name, draftingEnabled } = clinic;
  const { name: memberName, userId, role, email, roleLabel, hcpc, jobTitle, canSign } = member;
  const hooks = useMemo(
    () =>
      tenantHooks(
        { tenantId, name, draftingEnabled },
        { name: memberName, userId, role, email, roleLabel, hcpc, jobTitle, canSign },
        { onSignOut: () => signOutAndReload() },
      ),
    [tenantId, name, draftingEnabled, memberName, userId, role, email, roleLabel, hcpc, jobTitle, canSign],
  );
  return <HostHooksProvider hooks={hooks}>{children}</HostHooksProvider>;
}
