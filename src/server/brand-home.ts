/**
 * The clinic's own brand for pages (server components only) and the host hand-off (src/server/auth/brand-handoff.ts).
 * Never throws for the brand (clinicLinkBrand counts an unreadable clinic as ClinForms).
 */
import "server-only";
import { redirect } from "next/navigation";
import { CLINFORMS_NAME, type BrandId } from "../lib/brand";
import { clinicLinkBrand } from "./auth/brand-links";
import { brandHandoffUrl, brandSignInUrl, packageAreaOf } from "./auth/brand-handoff";
import { baseUrlSetting } from "./auth/config";
import { findMembership } from "./auth/membership";
import { activeOrganizationId, currentPath, getServerSession } from "./auth/session";
import { currentBrand } from "./brand";
import { getDb } from "./db";
import { clinicPackages, type ClinicPackages } from "./pms/entitlements";

/** The clinic's own brand (clinic package, else the brand it was created for, else ClinForms). */
export function clinicBrand(tenantId: string): Promise<BrandId> {
  return clinicLinkBrand(getDb(), tenantId);
}

function setting() {
  try {
    return baseUrlSetting();
  } catch {
    return null;
  }
}

/**
 * For the /app layouts and /app/start: a clinic opened on the other brand's host is sent to its own host's sign-in
 * page (redirect – never returns then). Returns the clinic's brand otherwise.
 */
export async function requireClinicOnItsHost(tenantId: string): Promise<BrandId> {
  const brand = await clinicBrand(tenantId);
  const s = setting();
  if (!s) return brand;
  const to = brandHandoffUrl({ hostBrand: currentBrand().id, clinicBrand: brand, setting: s, path: currentPath() });
  if (to) redirect(to);
  return brand;
}

/**
 * Whether the clinic sees the reports pages of the account area (Plan & usage, API keys, the forms checklist): it has
 * Reports, or it is a ClinForms clinic (a lapsed ClinForms plan still shows its usage). A ClinDesk clinic without the
 * Reports add-on sees none of them (Khuram's R1).
 */
export async function hasReportsArea(tenantId: string): Promise<boolean> {
  const [packages, brand] = await Promise.all([clinicPackages(tenantId), clinicBrand(tenantId)]);
  return packages.reports || brand === "clinforms";
}

/** The sign-in page on a brand's own host, when this deployment serves it and it is not the current host's brand. */
export function otherBrandSignIn(brand: BrandId): string | null {
  if (currentBrand().id === brand) return null;
  const s = setting();
  return s ? brandSignInUrl(s, brand) : null;
}

/**
 * The packages of the signed-in member's active clinic, for page metadata (generateMetadata runs beside the layouts'
 * checks, so it reads for itself). null when nobody is signed in or there is no active clinic.
 */
export async function activeClinicPackages(): Promise<ClinicPackages | null> {
  try {
    const session = await getServerSession();
    const orgId = session ? activeOrganizationId(session) : null;
    const membership = session && orgId ? await findMembership(getDb(), orgId, session.user.id) : null;
    return membership ? await clinicPackages(membership.tenantId) : null;
  } catch {
    return null;
  }
}

/** The tab title of a 404 on the current host ("Page not found · ClinDesk"). */
export function notFoundTitle(): string {
  return `Page not found · ${currentBrand().productName}`;
}

/** The name after "·" in the Studio's tab titles: ClinForms' hosts "ClinForms", the clinic brand's "ClinDesk" (R1). */
export function studioTitleName(): string {
  const brand = currentBrand();
  return brand.id === "clinic" ? brand.productName : CLINFORMS_NAME;
}

/** Whether `path` (/app/clinic… or /app/studio…) needs a package the signed-in member's active clinic does not have. */
export async function packageMissingForPath(path: string | null | undefined): Promise<boolean> {
  const area = packageAreaOf(path);
  if (!area) return false;
  const packages = await activeClinicPackages();
  return Boolean(packages && !packages[area]);
}
