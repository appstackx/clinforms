/**
 * Package checks for pages, server actions and route handlers (Node). The rule itself is pure
 * (src/modules/pms/core/entitlements.ts); the rows are in clinic_entitlements.
 *
 *   requireEntitlement("clinic")      – a page or layout: the 404 page unless the active clinic has the package
 *   clinicPackages(tenantId)          – both packages for the navigation, FAIL-SAFE for ClinForms: if the table
 *                                       cannot be read (a deployment ahead of its migration) Reports stays on and
 *                                       the clinic system stays off, so ClinForms behaves exactly as before.
 */
import "server-only";
import { notFound } from "next/navigation";
import { packageIsOn, type PackageId } from "../../modules/pms/core/entitlements";
import { getDb } from "../db";
import { logAuthEvent } from "../email/log";
import { requireAppContext, type AppContext } from "../auth/session";
import { listEntitlements } from "../repos/pms/entitlements";
import { pmsNow } from "../../modules/pms/core/clock";

export interface ClinicPackages {
  reports: boolean;
  clinic: boolean;
}

/** Both packages of a clinic (one query); never throws (see the file comment). */
export async function clinicPackages(tenantId: string): Promise<ClinicPackages> {
  try {
    const rows = await listEntitlements({ db: getDb() }, tenantId);
    const now = pmsNow();
    const row = (pkg: PackageId) => rows.find((e) => e.package === pkg) ?? null;
    return { reports: packageIsOn("reports", row("reports"), now), clinic: packageIsOn("clinic", row("clinic"), now) };
  } catch (err) {
    logAuthEvent("pms.entitlements_unreadable", { error: err instanceof Error ? err.name : "error" });
    return { reports: true, clinic: false };
  }
}

/** Whether one package is on; a failed read counts as OFF for the clinic system and ON for Reports. */
export async function hasPackage(tenantId: string, pkg: PackageId): Promise<boolean> {
  return (await clinicPackages(tenantId))[pkg];
}

/**
 * For pages and layouts: signed in, two-step on, a member of the active clinic (else the usual redirects) AND
 * the package on (else the 404 page – a clinic without the package does not learn that the area exists).
 */
export async function requireEntitlement(pkg: PackageId): Promise<AppContext> {
  const ctx = await requireAppContext();
  if (!(await hasPackage(ctx.membership.tenantId, pkg))) notFound();
  return ctx;
}
