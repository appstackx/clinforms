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

/**
 * What the clinic brand calls ClinForms inside its own app (01/11/2026, Khuram's R1): the "Reports" add-on – the
 * ClinForms name appears on ClinDesk's public website only as the "works on its own" link (no "powered by", 01/11/2026).
 */
export const REPORTS_ADDON_NAME = "Reports";

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
  /**
   * Whether the product analytics may run on this brand's hosts: cookieless usage statistics on the public website pages
   * (on by default, one-click opt-out – PECR Sched. A1 statistical purposes, 08/11/2026), with device storage only after
   * cookie consent (src/components/analytics). Both brands.
   */
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
  /**
   * The browser's theme colour (`<meta name="theme-color">`, the address bar on phones) on this brand's pages
   * (01/11/2026, V3): ClinForms' teal; the clinic brand's coral tape (#C4432B, the accent of its mark and website).
   */
  themeColor: string;
  /**
   * The installable staff app (12/11/2026, tracker xt05 "Phone app – installable web app first"): null = this brand's hosts
   * advertise no app (no manifest, no service worker, no install hint). Otherwise the web app manifest's names and splash
   * background (src/lib/pwa/manifest.ts); the app is the clinic area, so only the clinic brand has one – ClinForms' hosts
   * never advertise ClinDesk's app.
   */
  installableApp: { name: string; shortName: string; backgroundColor: string } | null;
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
    themeColor: "#0D9488",
    installableApp: null,
  },
  clinic: {
    id: "clinic",
    productName: CLINIC_SYSTEM_NAME,
    hosts: ["clindesk.co.uk", "www.clindesk.co.uk"],
    devHosts: ["clinic.localhost"],
    publicSite: "clindesk",
    siteUrl: "https://clindesk.co.uk",
    analytics: true,
    ads: true,
    appHome: "/app/clinic",
    contactEmail: "hello@clindesk.co.uk",
    icons: { icon: "/clindesk/favicon.svg", apple: "/clindesk/apple-touch-icon.png" },
    themeColor: "#C4432B",
    // The cream of the mark's tile (public/clindesk/favicon.svg) – the splash screen behind the icon.
    installableApp: { name: CLINIC_SYSTEM_NAME, shortName: CLINIC_SYSTEM_NAME, backgroundColor: "#FBF4E8" },
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

/**
 * Next's `viewport` for a brand's pages (its theme colour). The root layout sets ClinForms' statically (its public pages
 * are built once); the layouts that answer on either host (sign-in, /app, 404, patient pages, /reports) set the host
 * brand's with generateViewport, and ClinDesk's website its own.
 */
export function brandViewport(brand: Pick<Brand, "themeColor">): { themeColor: string } {
  return { themeColor: brand.themeColor };
}

/** One line about each product (page descriptions of the app, sign-in and error pages on the brand's hosts). */
export const BRAND_TAGLINES: Readonly<Record<BrandId, string>> = {
  clinforms: "Complete every referrer's own report form from your clinic notes",
  clinic: "Clinic management for UK physiotherapy and MSK clinics: diary, notes, billing and messages",
};

/**
 * The brand-wide part of Next's metadata for a brand's app, sign-in and error pages (01/11/2026, R3): the application
 * name (home-screen / pinned-app name), the share cards' site name and title, the description and the base URL – the
 * root layout sets ClinForms' for every page, so the clinic brand's pages override them with this.
 */
export function brandMetadata(brand: Pick<Brand, "id" | "productName" | "siteUrl">) {
  const description = BRAND_TAGLINES[brand.id];
  return {
    metadataBase: new URL(brand.siteUrl),
    applicationName: brand.productName,
    description,
    openGraph: { title: brand.productName, description, siteName: brand.productName, locale: "en_GB", type: "website" as const },
    twitter: { card: "summary" as const, title: brand.productName, description },
  };
}

/** The host every request on a brand's alias hosts is sent to (www.clindesk.co.uk → clindesk.co.uk). */
export const CLINDESK_APEX_HOST = "clindesk.co.uk";
export const CLINDESK_WWW_HOST = "www.clindesk.co.uk";

/** Package names shown to clinics and platform staff. */
export const PACKAGE_LABELS = {
  reports: "Reports",
  clinic: CLINIC_SYSTEM_NAME,
} as const;
