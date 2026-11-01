/**
 * Brands by hostname – ONE config for every name the product shows (browser-safe, no env).
 *
 * - "clinforms" (clinforms.co.uk, previews, localhost): the public site is about reports; the app at /app is
 *   ClinForms, and a clinic with the "clinic" package also sees the clinic area, labelled CLINIC_SYSTEM_NAME.
 * - "clinic" (clindesk.co.uk, the clinic system's own domain): same deployment, same code, same app pages; the
 *   name and the start page differ, and the public pages are ClinDesk's own website (src/app/clindesk-site, served
 *   by host in src/middleware.ts). www.clindesk.co.uk redirects to the apex (next.config.mjs). For a local look,
 *   http://clinic.localhost:<port> uses it.
 *
 * Product rules (docs/clinic-system/contract.md §2): the clinic system's name is CLINIC_SYSTEM_NAME only:
 * never "TM3", never a competitor's name, never "Practice" (a Reports plan).
 */

/** Name of the clinic system (package, area label and, on its own domain, the product and website name). */
export const CLINIC_SYSTEM_NAME = "ClinDesk";

/** ClinForms' own product name (equals the module's PRODUCT.name; checked by src/lib/brand.test.ts). */
export const CLINFORMS_NAME = "ClinForms";

export type BrandId = "clinforms" | "clinic";

export interface Brand {
  id: BrandId;
  /** Shown in the header next to the mark and in page titles. */
  productName: string;
  /** Exact host names (lower case, no port) served under this brand. */
  hosts: readonly string[];
  /** Host names for local looks only (any port). */
  devHosts: readonly string[];
  /**
   * Which public website this brand's hosts serve: "clinforms" = ClinForms' site (src/app/(marketing)), served as
   * before the clinic system (the middleware never runs on its pages); "clindesk" = ClinDesk's site
   * (src/app/clindesk-site), rewritten by host in src/middleware.ts.
   */
  publicSite: "clinforms" | "clindesk";
  /** Canonical origin of this brand's public website (canonical links, sitemap, robots). */
  siteUrl: string;
  /** Whether the consent-gated product analytics may run on this brand's hosts (ClinDesk: no product analytics). */
  analytics: boolean;
  /**
   * Whether the consent-gated advertising measurement tag (src/components/ads/google-ads.ts) may load on this brand's
   * PUBLIC website pages – never in the app, the demo, the sign-in or patient pages. Both brands: yes.
   */
  ads: boolean;
  /** Where a signed-in member lands. */
  appHome: string;
  /**
   * The contact address the app, the sign-in pages and this brand's emails show ("Questions about your package: …",
   * trial banners, reset pages). ClinForms' equals COMPANY.contactEmail (src/lib/site.ts, checked by brand.test.ts).
   */
  contactEmail: string;
  /**
   * The tab icon (and home-screen icon) on this brand's hosts: null = the app's own icon (src/app/icon.svg, set by the
   * root layout); otherwise the icons every app, sign-in and error page on the brand's hosts names (brandIcons). The
   * middleware also serves `icon` for /icon.svg and `apple` for /apple-touch-icon.png on the brand's hosts, so a page
   * that names no icon of its own (the 404 page) shows the brand's too.
   */
  icons: { icon: string; apple: string } | null;
}

export const BRANDS: Readonly<Record<BrandId, Brand>> = {
  clinforms: {
    id: "clinforms",
    productName: CLINFORMS_NAME,
    hosts: ["clinforms.co.uk", "www.clinforms.co.uk"],
    devHosts: ["localhost", "127.0.0.1"],
    publicSite: "clinforms",
    siteUrl: "https://clinforms.co.uk",
    analytics: true,
    ads: true,
    appHome: "/app",
    contactEmail: "hello@clinforms.co.uk",
    icons: null,
  },
  clinic: {
    id: "clinic",
    productName: CLINIC_SYSTEM_NAME,
    hosts: ["clindesk.co.uk", "www.clindesk.co.uk"],
    devHosts: ["clinic.localhost"],
    publicSite: "clindesk",
    siteUrl: "https://clindesk.co.uk",
    analytics: false,
    ads: true,
    appHome: "/app/clinic",
    contactEmail: "hello@clindesk.co.uk",
    icons: { icon: "/clindesk/favicon.svg", apple: "/clindesk/apple-touch-icon.png" },
  },
};

/** The brand of ClinForms' public website (its static pages are built once, for this brand). */
export const PUBLIC_SITE_BRAND: Brand = BRANDS.clinforms;

/** Lower-case host without port ("Clinic.Localhost:3180" → "clinic.localhost"). */
export function hostName(host: string | null | undefined): string {
  if (typeof host !== "string") return "";
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.split(":")[0];
}

/** The brand for a request's Host header. Unknown hosts (previews, other origins) get ClinForms. */
export function brandForHost(host: string | null | undefined): Brand {
  const name = hostName(host);
  for (const brand of Object.values(BRANDS)) {
    if (brand.hosts.includes(name) || brand.devHosts.includes(name)) return brand;
  }
  return BRANDS.clinforms;
}

/** The contact address for a brand (default ClinForms'). */
export function brandContactEmail(brand: Pick<Brand, "contactEmail"> | BrandId | null | undefined): string {
  if (!brand) return BRANDS.clinforms.contactEmail;
  return typeof brand === "string" ? BRANDS[brand].contactEmail : brand.contactEmail;
}

/**
 * Next's `icons` metadata for a brand's pages: undefined for a brand without its own icons (the page keeps the root
 * layout's src/app/icon.svg, exactly as before), else the brand's SVG tab icon and 180×180 home-screen icon.
 */
export function brandIcons(brand: Pick<Brand, "icons">):
  | { icon: { url: string; type: string }[]; apple: { url: string; sizes: string }[] }
  | undefined {
  if (!brand.icons) return undefined;
  return { icon: [{ url: brand.icons.icon, type: "image/svg+xml" }], apple: [{ url: brand.icons.apple, sizes: "180x180" }] };
}

/** The host every request on a brand's alias hosts is sent to (www.clindesk.co.uk → clindesk.co.uk). */
export const CLINDESK_APEX_HOST = "clindesk.co.uk";
export const CLINDESK_WWW_HOST = "www.clindesk.co.uk";

/** Package names shown to clinics and platform staff. */
export const PACKAGE_LABELS = {
  reports: "Reports",
  clinic: CLINIC_SYSTEM_NAME,
} as const;
