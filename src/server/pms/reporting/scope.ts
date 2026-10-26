/**
 * Site access of the signed-in member (src/modules/pms/reporting/staff.ts) and the checks the reporting and
 * set-up screens make with it. Other modules may use siteScopeOf() to show a limited member only their sites.
 */
import "server-only";
import { scopeAllows, type SiteScope } from "../../../modules/pms/reporting/staff";
import { getSiteScope } from "../../repos/pms/reporting/staff-access";
import type { ClinicActor } from "../actor";

/** Where the member may work (owners: every site; no stored access: every site). */
export async function siteScopeOf(actor: Pick<ClinicActor, "repo" | "tenantId" | "userId" | "role">): Promise<SiteScope> {
  return getSiteScope(actor.repo(), actor.tenantId, actor.userId, actor.role);
}

/** Clinic-wide set-up (appointment types, prices, staff, record keeping, the audit trail) needs every site. */
export function coversWholeClinic(scope: SiteScope): boolean {
  return scope.all;
}

/** A site-specific change (the site's details, rooms, opening hours, closures) needs that site in scope. */
export function mayManageSite(scope: SiteScope, siteId: string | null): boolean {
  return siteId === null ? scope.all : scopeAllows(scope, siteId);
}
