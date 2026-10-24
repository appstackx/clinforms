/**
 * Brands by hostname – ONE config for every name the product shows (browser-safe, no env).
 *
 * - "clinforms" (clinforms.co.uk, previews, localhost): the public site is about reports; the app at /app is
 *   ClinForms, and a clinic with the "clinic" package also sees the clinic area, labelled CLINIC_SYSTEM_NAME.
 * - "clinic" (a future second domain for the clinic system, app only): same deployment, same code, same pages;
 *   only the name and the start page differ. Its hosts list stays empty until the domain exists (add the host
 *   names here – nothing else changes). For a local look, http://clinic.localhost:<port> uses it.
 *
 * Product rules (docs/clinic-system/contract.md §2): the clinic system's name is the placeholder below until a
 * real name is chosen – never "TM3", never a competitor's name, never "Practice" (a Reports plan).
 */

/** Placeholder name of the clinic system (package, area label and, on its own domain, the product name). */
export const CLINIC_SYSTEM_NAME = "Clinic system";

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
  /** Whether the public marketing site is served on this brand's hosts (else its pages redirect to sign-in). */
  publicSite: boolean;
  /** Where a signed-in member lands. */
  appHome: string;
}

export const BRANDS: Readonly<Record<BrandId, Brand>> = {
  clinforms: {
    id: "clinforms",
    productName: CLINFORMS_NAME,
    hosts: ["clinforms.co.uk", "www.clinforms.co.uk"],
    devHosts: ["localhost", "127.0.0.1"],
    publicSite: true,
    appHome: "/app",
  },
  clinic: {
    id: "clinic",
    productName: CLINIC_SYSTEM_NAME,
    hosts: [],
    devHosts: ["clinic.localhost"],
    publicSite: false,
    appHome: "/app/clinic",
  },
};

/** The brand of the public website (static pages are built once, for this brand). */
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

/** Package names shown to clinics and platform staff. */
export const PACKAGE_LABELS = {
  reports: "Reports",
  clinic: CLINIC_SYSTEM_NAME,
} as const;
