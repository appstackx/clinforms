import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { reportsSection } from "@/components/pms/reporting/reports-nav";
import { ClinicShell } from "@/components/pms/shell/clinic-shell";
import { ClinicSystemMark } from "@/components/clindesk/logo";
import { accountAdminLinks, clinicRoleLabel, navForDeployment, shellNav, sitesSummary, withSetupAccountLinks } from "@/components/pms/shell/nav-model";
import { resolveSiteChoice, SITE_COOKIE } from "@/components/pms/shell/site-cookie";
import { ALL_SITES } from "@/components/pms/ui/site-switcher";
import { roleLabel } from "@/lib/account-copy";
import { CLINFORMS_NAME, CLINIC_SYSTEM_NAME, REPORTS_ADDON_NAME, brandViewport } from "@/lib/brand";
import { MANIFEST_PATH } from "@/lib/pwa/manifest";
import { listMemberships } from "@/server/auth/membership";
import { CLINIC_BASE_PATH } from "@/modules/pms/core/modules";
import { PMS_NAV } from "@/modules/pms/nav";
import { pagePermissionFor } from "@/modules/pms/core/page-permissions";
import { REPORTS_PATH, isReportId, reportAccess } from "@/modules/pms/reporting/catalogue";
import { currentBrand } from "@/server/brand";
import { currentInstallableApp } from "@/server/pwa";
import { activeClinicPackages, notFoundTitle, requireClinicOnItsHost } from "@/server/brand-home";
import { requireClinicActor } from "@/server/pms/actor";
import { requireAppContext } from "@/server/auth/session";
import { unansweredRepliesFor } from "@/server/pms/comms/views";
import { resolveDiarySiteScope } from "@/server/pms/diary/caller";
import { hasPackage } from "@/server/pms/entitlements";
import { listSites } from "@/server/repos/pms/directory";
import { patientExists } from "@/server/repos/pms/patients";
import { BillingBannerBar } from "@/components/account/billing-banner";
import { TrialBannerBar } from "@/components/account/trial-banner";
import { clinicShellTrial } from "@/server/trial/view";
import { billingBannerFor } from "@/server/billing/banner";
import { canManageBilling } from "@/server/billing/views";
import { getDb } from "@/server/db";
import { bulkEmailAvailable, mayUseBulkEmail } from "@/server/pms/comms/campaigns/service";
import { clinicApiAvailable, mayManageApi } from "@/server/pms/integration/api/screen";
import { xeroAvailable } from "@/server/pms/integration/xero/config";
import { mayManageXero } from "@/server/pms/integration/xero/screen";
import { exercisesAvailable, exercisesOnForClinic } from "@/server/pms/records/exercises-service";
import { cardPaymentsAvailable, mayManageCards } from "@/server/pms/billing/connect/screen";

export const dynamic = "force-dynamic";

/** /app/clinic/patients/<segment> pages that are not a patient's record. */
const PATIENT_LIST_SEGMENTS = new Set(["new", "export", "note-templates", "unsigned-notes"]);

/**
 * The host brand's theme colour (as /app's layout) and, for the installed app, the page drawn edge to edge
 * (viewport-fit=cover): the clinic shell pads itself by the safe areas, so nothing sits under a notch or the home bar.
 */
export function generateViewport(): Viewport {
  return { ...brandViewport(currentBrand()), viewportFit: "cover" };
}

/**
 * Tab titles "… · ClinDesk"; a clinic without the clinic package gets the 404 page, titled as one (01/11/2026, R3).
 * On a brand with an installable app (ClinDesk's hosts, 12/11/2026 xt05): the web app manifest and the iOS home-screen
 * tags – never on ClinForms' hosts (src/lib/pwa/manifest.ts).
 */
export async function generateMetadata(): Promise<Metadata> {
  const robots = { index: false, follow: false };
  const packages = await activeClinicPackages();
  if (packages && !packages.clinic) return { title: { default: notFoundTitle(), template: notFoundTitle() }, robots };
  const app = currentInstallableApp(); // the host brand's app, unless switched off (CLINFORMS_PWA=off)
  return {
    title: { default: CLINIC_SYSTEM_NAME, template: `%s · ${CLINIC_SYSTEM_NAME}` },
    robots,
    ...(app ? { manifest: MANIFEST_PATH, appleWebApp: { capable: true, title: app.shortName, statusBarStyle: "default" as const } } : {}),
  };
}

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
  // 01/11/2026: a clinic is used on its own brand's host (src/server/auth/brand-handoff.ts) – checked before the
  // package, so a ClinForms clinic on the clinic brand's host is sent home rather than shown a 404.
  await requireClinicOnItsHost((await requireAppContext()).membership.tenantId);
  const actor = await requireClinicActor();
  // A page the member may not open answers a real 404 on a full page load – checked here, above the sections'
  // loading skeletons, which would otherwise stream status 200 first (src/modules/pms/core/page-permissions.ts).
  const path = headers().get("x-clinforms-path");
  const needs = pagePermissionFor(path);
  if (needs && !needs.some((p) => actor.can(p))) notFound();
  // Bulk email (xt02): without the platform switch the pages do not exist; reception never opens them (a real 404
  // here too – the Messages section's skeleton would stream 200 first).
  if (path && /^\/app\/clinic\/messages\/campaigns(?:[/?#]|$)/.test(path) && (!bulkEmailAvailable() || !mayUseBulkEmail(actor))) notFound();
  // API keys (xt03): without the platform switch the page does not exist; only the owner opens it.
  const apiOn = clinicApiAvailable();
  if (path && /^\/app\/clinic\/setup\/api(?:[/?#]|$)/.test(path) && (!apiOn || !mayManageApi(actor))) notFound();
  // Xero (xe03–xe05): without the platform switch the page does not exist; owners and admins only.
  const xeroOn = xeroAvailable();
  if (path && /^\/app\/clinic\/setup\/xero(?:[/?#]|$)/.test(path) && (!xeroOn || !mayManageXero(actor))) notFound();
  // Exercise programmes (ex03–ex05): without the platform switch the pages do not exist; the record's pages also need
  // the clinic's own setting (Set-up → Exercises stays open to switch it on).
  const exercisesOn = exercisesAvailable();
  if (path && /^\/app\/clinic\/setup\/exercises(?:[/?#]|$)/.test(path) && !exercisesOn) notFound();
  if (path && /^\/app\/clinic\/patients\/[^/]+\/exercises(?:[/?#]|$)/.test(path) && !(await exercisesOnForClinic(actor.repo(), actor.tenantId).catch(() => false))) notFound();
  // Card payments: without the platform switch the pages do not exist; only the owner opens Set-up → Card payments.
  const cardsOn = cardPaymentsAvailable();
  if (path && /^\/app\/clinic\/setup\/card-payments(?:[/?#]|$)/.test(path) && (!cardsOn || !mayManageCards(actor))) notFound();
  if (path && /^\/app\/clinic\/billing\/payouts(?:[/?#]|$)/.test(path) && !cardsOn) notFound();
  const report = path?.split(/[?#]/)[0].match(new RegExp(`^${REPORTS_PATH}/([a-z]+)$`))?.[1];
  if (report && report !== "export" && (!isReportId(report) || reportAccess(report, (p) => actor.can(p)) === null)) notFound();
  const brand = currentBrand();
  const ctx = actor.repo();
  // 01/11/2026: an unknown patient answers a real 404 too (the record's loading skeleton would stream 200 first).
  const patientId = path?.split(/[?#]/)[0].match(/^\/app\/clinic\/patients\/([^/]+)(?:\/|$)/)?.[1];
  if (patientId && !PATIENT_LIST_SEGMENTS.has(patientId) && !(await Promise.resolve()
      .then(() => patientExists(ctx, actor.tenantId, decodeURIComponent(patientId)))
      .catch(() => true))) notFound();
  // 01/11/2026: the Studio is offered on either host when the clinic has Reports (the clinic brand calls it the
  // "Reports" add-on – never the ClinForms name on its host).
  // 13/11/2026: a SELF-SERVE trial (starts at the owner's first visit – here, for a ClinDesk clinic, whose owner lands
  // in the clinic system) and its banner; nothing for any other clinic.
  const [reports, sites, scope, replies, billing, memberships, trial] = await Promise.all([
    hasPackage(actor.tenantId, "reports"),
    listSites(ctx, actor.tenantId),
    resolveDiarySiteScope(actor),
    unansweredRepliesFor(actor),
    billingBannerFor(getDb(), actor.tenantId, actor.role === "owner" || actor.role === "admin"),
    listMemberships(getDb(), actor.userId).catch(() => []),
    // Self-serve trial clinics only (src/server/trial/view.ts): every other clinic gets null – no visit noted, no banner.
    clinicShellTrial(getDb(), { tenantId: actor.tenantId, userId: actor.userId, sessionId: actor.sessionId, role: actor.role }, canManageBilling(actor.role)),
  ]);
  // Owners and admins: the way back to the clinic account (Plan and billing, members, security …) – the billing rule.
  const account = accountAdminLinks(canManageBilling(actor.role));
  // A member of more than one clinic: the way to the clinic chooser (01/11/2026).
  const menu = memberships.length > 1 ? [...account.menu, { id: "account.switch", href: "/app/select-clinic", label: "Switch clinic", icon: "overview" as const, exact: true }] : account.menu;
  const mySites = scope ? sites.filter((s) => scope.has(s.id)) : sites;
  const siteValue = resolveSiteChoice(cookies().get(SITE_COOKIE)?.value, mySites.map((s) => s.id), ALL_SITES);
  return (
    <ClinicShell
      productName={brand.id === "clinforms" ? CLINIC_SYSTEM_NAME : brand.productName}
      mark={<ClinicSystemMark className="h-7 w-7" />}
      homeHref={CLINIC_BASE_PATH}
      clinicName={actor.clinicName}
      user={{ name: actor.name, email: actor.email, roleLabel: clinicRoleLabel(actor.role, roleLabel(actor.role)), sitesSummary: sitesSummary(mySites.length, sites.length) }}
      nav={withSetupAccountLinks(shellNav(navForDeployment(PMS_NAV, { clinicApi: apiOn, xero: xeroOn && mayManageXero(actor), exercises: exercisesOn, cardPayments: cardsOn }), actor.can, { "comms.messages": { count: replies, label: "replies to answer" } }, reportsSection(actor.can)), account.setup)}
      sites={{ options: mySites.map((s, i) => ({ id: s.id, name: s.name, note: i === 0 ? "Default" : undefined })), value: siteValue, total: sites.length }}
      searchHref={actor.can("patients.view") ? `${CLINIC_BASE_PATH}/patients` : null}
      clinForms={reports ? { href: "/app/studio", label: brand.id === "clinic" ? REPORTS_ADDON_NAME : CLINFORMS_NAME } : null}
      accountHref="/app/clinic/account"
      adminLinks={menu}
      installableApp={currentInstallableApp() !== null}
    >
      {trial ? <TrialBannerBar access={trial} contactEmail={brand.contactEmail} className="mb-4 rounded-md border" /> : null}
      <BillingBannerBar banner={billing} className="mb-4 rounded-md border" />
      {children}
    </ClinicShell>
  );
}
