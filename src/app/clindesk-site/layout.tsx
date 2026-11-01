import type { Metadata, Viewport } from "next";
import { Arimo, Bricolage_Grotesque, Courier_Prime, Figtree, Shantell_Sans, Source_Serif_4 } from "next/font/google";
import { GoogleAdsTag } from "@/components/ads/google-ads-tag";
import { ClindeskCookieConsent } from "@/components/clindesk/cookie-consent";
import { BRANDS, CLINIC_SYSTEM_NAME, brandViewport } from "@/lib/brand";
import { CLINDESK_SITE_URL } from "@/lib/clindesk/site";
import "@/components/clindesk/styles/site.css";
import "@/components/clindesk/styles/consent.css";

/*
 * ClinDesk's public website (clindesk.co.uk). Served ONLY on the clinic brand's hosts: src/middleware.ts rewrites
 * "/", "/features" … to this folder there and answers 404 for /clindesk-site/… on every host. Static pages; the
 * fill-ins come from content/clindesk-site.json (src/lib/clindesk/content.ts).
 *
 * Fonts (the design's Google Fonts) are self-hosted by next/font at build time – no font request to a third party from
 * the browser, font-display: swap. The display, text and pen fonts are preloaded; the fonts of the product scenes and
 * referrers' paper forms (Inter comes from the root layout) load when a page uses them.
 *
 * Cookie choices: ClinDesk's own banner (first in the tab order) and the advertising measurement tag, which loads
 * nothing until the visitor accepts it (src/components/ads/google-ads.ts) – the only third-party request these pages
 * can make, apart from the tour video when it is played.
 */
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], axes: ["opsz", "wdth"], display: "swap", variable: "--cd-font-bricolage" });
const figtree = Figtree({ subsets: ["latin"], style: ["normal", "italic"], display: "swap", variable: "--cd-font-figtree" });
const shantell = Shantell_Sans({ subsets: ["latin"], axes: ["BNCE", "INFM"], display: "swap", variable: "--cd-font-shantell" });
const serif = Source_Serif_4({ subsets: ["latin"], axes: ["opsz"], display: "swap", preload: false, variable: "--cd-font-serif" });
const arimo = Arimo({ subsets: ["latin"], weight: ["400", "700"], display: "swap", preload: false, variable: "--cd-font-arimo" });
const courier = Courier_Prime({ subsets: ["latin"], weight: ["400", "700"], display: "swap", preload: false, variable: "--cd-font-courier" });

const FONT_VARIABLES = [bricolage, figtree, shantell, serif, arimo, courier].map((f) => f.variable).join(" ");

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
    <div className={FONT_VARIABLES}>
      <ClindeskCookieConsent />
      {children}
      <GoogleAdsTag />
    </div>
  );
}
