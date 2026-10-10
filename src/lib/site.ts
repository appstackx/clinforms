/**
 * Public website configuration: canonical URL, company details and the public page list (sitemap,
 * robots, analytics). Browser-safe and environment-free (no process.env here).
 *
 * Company details that are not confirmed yet stay `undefined`: the footer and the legal pages render a
 * line only when its value is set, so nothing unverified is ever published.
 */

/** Canonical origin of the public site (metadataBase, canonical links, sitemap, robots). */
export const SITE_URL = "https://clinforms.co.uk" as const;

export interface CompanyDetails {
  /** Legal entity that provides ClinForms. */
  legalName: string;
  /** Trading brand. */
  brand: string;
  /** Company website. */
  website: string;
  /** Contact for sales, support, privacy and security questions. */
  contactEmail: string;
  /** Companies House registration number – set once confirmed. */
  registeredNumber?: string;
  /** Where the company is registered, e.g. "England and Wales" – set once confirmed. */
  registeredIn?: string;
  /** Registered office address, one line – set once confirmed. */
  registeredAddress?: string;
  /** ICO data protection fee registration number – set once confirmed. */
  icoRegistration?: string;
}

export const COMPANY: CompanyDetails = {
  legalName: "AppstackX Ltd",
  brand: "AppStackX",
  website: "https://appstackx.co.uk",
  contactEmail: "khuram@appstackx.co.uk",
  // Unknown today: leave unset until confirmed (lines that need them are hidden).
  registeredNumber: undefined,
  registeredIn: undefined,
  registeredAddress: undefined,
  icoRegistration: undefined,
};

/** "Registered in England and Wales, company number 12345678. Registered office: …" – or null. */
export function companyRegistrationLine(company: CompanyDetails = COMPANY): string | null {
  const parts: string[] = [];
  if (company.registeredNumber) {
    parts.push(
      company.registeredIn
        ? `Registered in ${company.registeredIn}, company number ${company.registeredNumber}.`
        : `Company number ${company.registeredNumber}.`,
    );
  }
  if (company.registeredAddress) parts.push(`Registered office: ${company.registeredAddress}.`);
  return parts.length ? parts.join(" ") : null;
}

/** Date shown as "Last updated" on the legal pages (ISO). Change it whenever their text changes. */
export const LEGAL_LAST_UPDATED = "2026-10-09";

/** The privacy policy's own "Last updated" (ISO): it changed on its own for the demo video (section 3). */
export const PRIVACY_LAST_UPDATED = "2026-10-10";

/** "9 October 2026" (UK long date) for an ISO date. */
export function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${d} ${months[m - 1]} ${y}`;
}

/** Public, indexable pages (sitemap; the only paths that get analytics pageviews). */
export const PUBLIC_PAGES = [
  { path: "/", changeFrequency: "monthly", priority: 1 },
  { path: "/demo", changeFrequency: "monthly", priority: 0.9 },
  { path: "/request-access", changeFrequency: "yearly", priority: 0.8 },
  { path: "/security", changeFrequency: "monthly", priority: 0.7 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.4 },
  { path: "/cookies", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
] as const;

/**
 * Sign-in pages (noindex; contract §4). Like the app area they never show the cookie banner: they are task pages
 * for invited clinic members (a fixed banner would cover the form), and a choice made on the public site still
 * applies there.
 */
export const AUTH_PATHS = ["/login", "/two-factor", "/accept-invite", "/reset-password"] as const;

/**
 * Areas that are never indexed and never show the cookie banner: the signed-in app, the public demo
 * (Studio and simulated clinic system) and the APIs. They still respect a consent given elsewhere.
 */
export const APP_AREA_PREFIXES = ["/app", "/reports", "/pms-sandbox", "/api"] as const;

/** True when `pathname` is `prefix` itself or below it ("/reports" and "/reports/x", not "/reportsx"). */
export function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isAppAreaPath(pathname: string): boolean {
  return APP_AREA_PREFIXES.some((prefix) => isUnder(pathname, prefix));
}

export function isAuthPath(pathname: string): boolean {
  return AUTH_PATHS.some((prefix) => isUnder(pathname, prefix));
}

/** Pages that may ask for cookie choices: everything except the app area, the demo, the APIs and sign-in pages. */
export function showsConsentBanner(pathname: string): boolean {
  return !isAppAreaPath(pathname) && !isAuthPath(pathname);
}

export function isPublicPagePath(pathname: string): boolean {
  return PUBLIC_PAGES.some((page) => page.path === pathname);
}

export function absoluteUrl(path: string): string {
  return path === "/" ? SITE_URL : `${SITE_URL}${path}`;
}
