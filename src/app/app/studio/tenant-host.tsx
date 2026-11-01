"use client";

/**
 * Client-side host glue for a clinic's own Studio (/app/studio): the module's HostHooks in tenant mode.
 * The module never imports the app; this file (in src/app) is allowed to touch both.
 *
 * - basePath "/app/studio", mode "tenant": the screens link here and hide every demo-only control.
 * - storage "server": reports and form maps are kept for the clinic on the server (ui/store.ts reads it).
 * - clinic, member: worked out on the server by the layout (src/server/auth/studio-access.ts); the member is
 *   the default signer and the name on activity entries. `clinic.demoClinic` (a demo clinic, made-up data only) comes
 *   from the clinic's plan on the server too, never from the browser.
 * - track: the consent-gated, allow-listed analytics (src/components/analytics), tagged area "app".
 * - onSignOut: the shared sign-out, then /login loaded in full (fix wave 2: nothing in memory survives).
 * - No onDocumentFiled / onResetDemo: there is no simulated record or demo state here.
 * - clinicRecordUrl (10/2026): only for a form opened from the clinic system's own record (connector "native"):
 *   the case it was opened from. Every other report has no clinic record to link to (null, as before).
 */
import { useMemo, type ReactNode } from "react";
import { track } from "@/components/analytics";
import { COMPANY } from "@/lib/site";
import { HostHooksProvider, type HostHooks, type StudioBrand, type StudioClinic, type StudioMember } from "@/modules/medreport/ui/host-hooks";
import { signOutAndReload } from "../session-forms";

export const TENANT_STUDIO_BASE_PATH = "/app/studio";

/** The hooks a clinic's Studio runs with (exported for the render tests). */
export function tenantHooks(
  clinic: StudioClinic,
  member: StudioMember,
  options: { onSignOut?: () => Promise<void> | void; supportEmail?: string; brand?: StudioBrand } = {},
): HostHooks {
  return {
    basePath: TENANT_STUDIO_BASE_PATH,
    mode: "tenant",
    storage: "server",
    clinic,
    member,
    accountHref: "/app",
    clinicRecordUrl: ({ connectorId, patientId, episodeId }) =>
      connectorId === "native" && episodeId ? `/app/clinic/patients/${encodeURIComponent(patientId)}/cases/${encodeURIComponent(episodeId)}` : null,
    // The host brand's contact (set by the layout from src/lib/brand.ts); default ClinForms'.
    supportEmail: options.supportEmail ?? COMPANY.contactEmail,
    track: (event, props) => track(event, { ...props, area: "app" }),
    ...(options.onSignOut ? { onSignOut: options.onSignOut } : {}),
    // The host brand's chrome (F4; set by the layout): none on ClinForms' hosts.
    ...(options.brand ? { brand: options.brand } : {}),
  };
}

export function TenantHost({
  clinic,
  member,
  supportEmail,
  brand,
  children,
}: {
  clinic: StudioClinic;
  member: StudioMember;
  supportEmail?: string;
  brand?: StudioBrand;
  children: ReactNode;
}) {
  const { tenantId, name, draftingEnabled, clinicians, signers, demoClinic } = clinic;
  const { name: memberName, userId, role, email, roleLabel, hcpc, jobTitle, canSign } = member;
  const hooks = useMemo(
    () =>
      tenantHooks(
        { tenantId, name, draftingEnabled, ...(clinicians ? { clinicians } : {}), ...(signers ? { signers } : {}), ...(demoClinic ? { demoClinic: true } : {}) },
        { name: memberName, userId, role, email, roleLabel, hcpc, jobTitle, canSign },
        { onSignOut: () => signOutAndReload(), ...(supportEmail ? { supportEmail } : {}), ...(brand ? { brand } : {}) },
      ),
    [tenantId, name, draftingEnabled, clinicians, signers, demoClinic, memberName, userId, role, email, roleLabel, hcpc, jobTitle, canSign, supportEmail, brand],
  );
  return <HostHooksProvider hooks={hooks}>{children}</HostHooksProvider>;
}
