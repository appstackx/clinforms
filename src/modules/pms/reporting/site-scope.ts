/**
 * The sites a member may see, as the reports and set-up use them (pure). Site access itself belongs to the access
 * module ("works at" / "can see", migration 0103 – src/server/pms/access.ts): the actor carries it as `siteIds`
 * (null = every site). This file only turns it into filters. Owners always see every site (an access-module lock).
 */

/** Where a member may look: every site, or the listed sites only. */
export type SiteScope = { all: true } | { all: false; siteIds: readonly string[] };

export const ALL_SITES: SiteScope = { all: true };

/** The scope from the actor's `siteIds` (null = every site). */
export function scopeFromSiteIds(siteIds: ReadonlySet<string> | readonly string[] | null): SiteScope {
  if (siteIds === null) return ALL_SITES;
  return { all: false, siteIds: Array.from(siteIds) };
}

export function scopeAllows(scope: SiteScope, siteId: string | null | undefined): boolean {
  if (scope.all) return true;
  return typeof siteId === "string" && scope.siteIds.includes(siteId);
}

/** Only the sites a member may see, in the given order. */
export function sitesInScope<T extends { id: string }>(scope: SiteScope, sites: readonly T[]): T[] {
  return scope.all ? sites.slice() : sites.filter((s) => scope.siteIds.includes(s.id));
}

/**
 * The site filter a member may use: a requested site inside their scope, else (limited members) their sites,
 * else (every site) no filter. `null` = the whole clinic.
 */
export function siteFilterFor(scope: SiteScope, requested: string | null | undefined): readonly string[] | null {
  if (requested && scopeAllows(scope, requested)) return [requested];
  return scope.all ? null : scope.siteIds;
}
