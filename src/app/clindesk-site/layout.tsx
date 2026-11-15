import type { Metadata, Viewport } from "next";
import { GoogleAdsTag } from "@/components/ads/google-ads-tag";
import { ClindeskCookieConsent } from "@/components/clindesk/cookie-consent";
import { SITE_FONT_VARIABLES } from "@/components/clindesk/fonts";
import { BRANDS, CLINIC_SYSTEM_NAME, brandViewport } from "@/lib/brand";
import { CLINDESK_SITE_URL } from "@/lib/clindesk/site";
import "@/components/clindesk/styles/site.css";
import "@/components/clindesk/styles/consent.css";

/*
 * ClinDesk's public website (clindesk.co.uk). Served ONLY on the clinic brand's hosts: src/middleware.ts rewrites
 * "/", "/features" … to this folder there and answers 404 for /clindesk-site/… on every host. Static pages; the
 * fill-ins come from content/clindesk-site.json (src/lib/clindesk/content.ts).
 *
 * Fonts: the design's Google Fonts, self-hosted by next/font and shared with ClinForms' site (src/components/clindesk/fonts.ts).
 *
 * Cookie choices: ClinDesk's own banner (first in the tab order) and the advertising measurement tag, which loads
 * nothing until the visitor accepts it (src/components/ads/google-ads.ts) – the only third-party request these pages
 * can make, apart from the tour video when it is played.
 */

/** Defaults for the site; each page sets its own title, description, canonical and cards (clindeskMetadata). */
export const metadata: Metadata = {
  metadataBase: new URL(CLINDESK_SITE_URL),
  applicationName: CLINIC_SYSTEM_NAME,
  robots: { index: true, follow: true },
};

/** ClinDesk's theme colour (the root layout's is ClinForms'). */
export const viewport: Viewport = brandViewport(BRANDS.clinic);

export default function ClindeskSiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={SITE_FONT_VARIABLES}>
      <ClindeskCookieConsent />
      {children}
      <GoogleAdsTag />
    </div>
  );
}
