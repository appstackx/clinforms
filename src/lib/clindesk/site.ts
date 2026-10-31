/**
 * ClinDesk's public website (clindesk.co.uk): canonical origin, page list (sitemap, robots, tests) and the metadata
 * every page gets (title, description, canonical, Open Graph / Twitter card, icons). Browser-safe, no env.
 * Routing: src/middleware.ts serves these paths from src/app/clindesk-site on the clinic brand's hosts only.
 */
import type { Metadata } from "next";
import { BRANDS, CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { COMPANY } from "@/lib/site";

export const CLINDESK_SITE_URL = BRANDS.clinic.siteUrl;

/** Contact for sales, support, privacy and security questions (canonical company contact). */
export const CONTACT_EMAIL = COMPANY.contactEmail;

/** "Last updated" of the accessibility statement (ISO). Change it whenever its text changes. */
export const ACCESSIBILITY_LAST_UPDATED = "2026-10-30";

/** Date the site's pages last changed (sitemap lastModified). */
export const CLINDESK_SITE_UPDATED = "2026-10-30";

export interface ClindeskPage {
  path: string;
  /** Indexed and listed in the sitemap. */
  indexed: boolean;
  changeFrequency: "monthly" | "yearly";
  priority: number;
}

/** Every page of the site (the middleware's CLINDESK_SITE_PATHS also lists /robots.txt and /sitemap.xml). */
export const CLINDESK_PAGES: readonly ClindeskPage[] = [
  { path: "/", indexed: true, changeFrequency: "monthly", priority: 1 },
  { path: "/features", indexed: true, changeFrequency: "monthly", priority: 0.9 },
  { path: "/reports", indexed: true, changeFrequency: "monthly", priority: 0.8 },
  { path: "/pricing", indexed: true, changeFrequency: "monthly", priority: 0.9 },
  { path: "/switching", indexed: true, changeFrequency: "monthly", priority: 0.8 },
  { path: "/security", indexed: true, changeFrequency: "monthly", priority: 0.8 },
  { path: "/demo", indexed: true, changeFrequency: "monthly", priority: 0.9 },
  { path: "/demo/thanks", indexed: false, changeFrequency: "yearly", priority: 0 },
  { path: "/privacy", indexed: true, changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", indexed: true, changeFrequency: "yearly", priority: 0.3 },
  { path: "/cookies", indexed: true, changeFrequency: "yearly", priority: 0.3 },
  { path: "/accessibility", indexed: true, changeFrequency: "yearly", priority: 0.3 },
];

export function clindeskUrl(path: string): string {
  return path === "/" ? CLINDESK_SITE_URL : `${CLINDESK_SITE_URL}${path}`;
}

/** Open Graph / Twitter image (1200 × 630, public/clindesk/og.png). */
export const CLINDESK_OG_IMAGE = { url: "/clindesk/og.png", width: 1200, height: 630, alt: `${CLINIC_SYSTEM_NAME} – practice software for UK physio and MSK clinics` };

/** The metadata of one ClinDesk page. `title` is the full title (no template), as in the design. */
export function clindeskMetadata({ path, title, description, index = true }: { path: string; title: string; description: string; index?: boolean }): Metadata {
  return {
    metadataBase: new URL(CLINDESK_SITE_URL),
    title: { absolute: title },
    description,
    applicationName: CLINIC_SYSTEM_NAME,
    authors: [{ name: COMPANY.legalName, url: COMPANY.website }],
    alternates: { canonical: path },
    robots: index ? { index: true, follow: true } : { index: false, follow: true },
    icons: { icon: [{ url: "/clindesk/favicon.svg", type: "image/svg+xml" }], apple: [{ url: "/clindesk/apple-touch-icon.png", sizes: "180x180" }] },
    openGraph: {
      title,
      description,
      url: path,
      siteName: CLINIC_SYSTEM_NAME,
      locale: "en_GB",
      type: "website",
      images: [CLINDESK_OG_IMAGE],
    },
    twitter: { card: "summary_large_image", title, description, images: [CLINDESK_OG_IMAGE.url] },
  };
}
