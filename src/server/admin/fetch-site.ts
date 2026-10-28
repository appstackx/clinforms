/**
 * Cross-site requests to ClinForms staff GET endpoints that write an audit row (25/10/2026 – the platform usage CSV).
 * The session cookies are SameSite=Lax, so a top-level navigation from another site carries them: such a request is
 * answered like any unknown page (404) and writes nothing. A browser marks it with Sec-Fetch-Site; "same-origin" (our
 * own page or fetch) and "none" (typed into the address bar, a bookmark) are fine; a request without the header (an
 * older browser, a script with the admin's cookies) is let through – it is still a platform administrator's.
 */
export function isCrossSiteRequest(headers: Pick<Headers, "get">): boolean {
  const site = headers.get("sec-fetch-site")?.trim().toLowerCase();
  return Boolean(site) && site !== "same-origin" && site !== "none";
}
