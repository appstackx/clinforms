import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ClinicShell } from "@/components/pms/shell/clinic-shell";
import { clinicRoleLabel, shellNav, sitesSummary } from "@/components/pms/shell/nav-model";
import { resolveSiteChoice, SITE_COOKIE } from "@/components/pms/shell/site-cookie";
import { ALL_SITES } from "@/components/pms/ui/site-switcher";
import { roleLabel } from "@/lib/account-copy";
import { CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { CLINIC_BASE_PATH } from "@/modules/pms/core/modules";
import { PMS_NAV } from "@/modules/pms/nav";
import { currentBrand } from "@/server/brand";
import { requireClinicActor } from "@/server/pms/actor";
import { unansweredRepliesFor } from "@/server/pms/comms/views";
import { resolveDiarySiteScope } from "@/server/pms/diary/caller";
import { hasPackage } from "@/server/pms/entitlements";
import { listSites } from "@/server/repos/pms/directory";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: CLINIC_SYSTEM_NAME, template: `%s · ${CLINIC_SYSTEM_NAME}` },
  robots: { index: false, follow: false },
};

/**
 * /app/clinic – the clinic system's shell (design system v1, docs/clinic-system/design/). Checked on the server on
 * every request (src/server/pms/actor.ts): signed in with two-step verification, a member of the active clinic, and
 * the clinic has the "clinic" package – else the usual sign-in redirects or the 404 page. The navigation comes from
 * each module's nav/<module>.ts, filtered by the member's role. Every page and action below checks again for itself
 * (layouts do not guard server actions).
 *
 * Sites: the clinic's active sites, limited to the member's site scope (today every site – the diary's
 * resolveDiarySiteScope, until the foundation's shared read exists: handover §12 open 2). The chosen site is a
 * preference cookie, checked here against that list. Badges: Messages shows the replies waiting for an answer
 * (comms, M6 – messages.send, in the member's site scope).
 */
export default async function ClinicSystemLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireClinicActor();
  const brand = currentBrand();
  const ctx = actor.repo();
  const [reports, sites, scope, replies] = await Promise.all([
    brand.id === "clinforms" ? hasPackage(actor.tenantId, "reports") : Promise.resolve(false),
    listSites(ctx, actor.tenantId),
    resolveDiarySiteScope(actor),
    unansweredRepliesFor(actor),
  ]);
  const mySites = scope ? sites.filter((s) => scope.has(s.id)) : sites;
  const siteValue = resolveSiteChoice(cookies().get(SITE_COOKIE)?.value, mySites.map((s) => s.id), ALL_SITES);
  return (
    <ClinicShell
      productName={brand.id === "clinforms" ? CLINIC_SYSTEM_NAME : brand.productName}
      homeHref={CLINIC_BASE_PATH}
      clinicName={actor.clinicName}
      user={{ name: actor.name, email: actor.email, roleLabel: clinicRoleLabel(actor.role, roleLabel(actor.role)), sitesSummary: sitesSummary(mySites.length, sites.length) }}
      nav={shellNav(PMS_NAV, actor.can, { "comms.messages": { count: replies, label: "replies to answer" } })}
      sites={{ options: mySites.map((s, i) => ({ id: s.id, name: s.name, note: i === 0 ? "Default" : undefined })), value: siteValue, total: sites.length }}
      searchHref={actor.can("patients.view") ? `${CLINIC_BASE_PATH}/patients` : null}
      clinForms={reports ? { href: "/app", label: "ClinForms" } : null}
      accountHref="/app/clinic/account"
    >
      {children}
    </ClinicShell>
  );
}
