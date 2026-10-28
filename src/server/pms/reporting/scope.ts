/**
 * Site access of the signed-in member for the reports, the dashboard and set-up. The sites come from the access
 * module (actor.siteIds – "works at" ∪ "can see"; null = every site); nothing is stored by reporting.
 */
import { scopeAllows, scopeFromSiteIds, type SiteScope } from "../../../modules/pms/reporting/site-scope";
import type { ClinicActor } from "../actor";

/** Where the member may look (owners and unlimited members: every site). */
export function siteScopeOf(actor: Pick<ClinicActor, "siteIds">): SiteScope {
  return scopeFromSiteIds(actor.siteIds);
}

/** Clinic-wide set-up (appointment types, prices, payers, templates, billing settings) needs every site. */
export function coversWholeClinic(scope: SiteScope): boolean {
  return scope.all;
}

/** A site-specific change (the site's details, rooms, opening hours, closures) needs that site in scope. */
export function mayManageSite(scope: SiteScope, siteId: string | null): boolean {
  return siteId === null ? scope.all : scopeAllows(scope, siteId);
}
