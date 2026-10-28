/**
 * The member's chosen site in the clinic shell: a preference cookie (no data in it – a site id or "all"). The
 * layout reads it and checks it against the sites the member may use, so a stale or edited value falls back to the
 * first site. Screens that work per site (the diary) read the same cookie through the layout's choice.
 */
export const SITE_COOKIE = "pms_site";
export const SITE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** The choice that applies: the cookie's value if the member may use it, else the first site (null: no sites). */
export function resolveSiteChoice(cookieValue: string | undefined, siteIds: readonly string[], allValue: string): string | null {
  if (cookieValue === allValue && siteIds.length > 1) return allValue;
  if (cookieValue && siteIds.includes(cookieValue)) return cookieValue;
  return siteIds[0] ?? null;
}
