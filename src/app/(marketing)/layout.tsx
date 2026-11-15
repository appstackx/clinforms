import type { Metadata } from "next";
import { GoogleAdsTag } from "@/components/ads/google-ads-tag";
import { SITE_FONT_VARIABLES } from "@/components/clindesk/fonts";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { PUBLIC_SITE_BRAND } from "@/lib/brand";
import "@/components/clindesk/styles/site.css";
import "@/components/marketing/styles/cf-site.css";

/**
 * The public website (/, /request-access, /security and the legal pages): indexable. Static, so it is built for one
 * brand – the public site's (src/lib/brand.ts); hosts of a brand without a public site are sent to sign-in by the
 * middleware.
 *
 * Look: the design system shared with the clinic brand's website (the site.css and fonts imported above – tokens,
 * type, buttons, header, footer) so both public sites read as one family, plus ClinForms' own sections and drawings
 * (src/components/marketing/styles/cf-site.css, public/clinforms/site/). Everything sits under .cd-site; pages that keep
 * the app's Tailwind styling (legal text, the request form, the video player) wrap it in ProseFrame (.cd-prose).
 *
 * The advertising measurement tag (src/components/ads) is mounted here and in the clinic brand's site layout ONLY: it loads
 * nothing until the visitor accepts advertising cookies, and never runs in the app, the demo or the sign-in pages.
 */
export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={SITE_FONT_VARIABLES}>
      <div className="cd-site site cf-site">
        <a className="skip" href="#main">
          Skip to content
        </a>
        <SiteHeader brand={PUBLIC_SITE_BRAND} />
        <main id="main">{children}</main>
        <SiteFooter brand={PUBLIC_SITE_BRAND} />
      </div>
      <GoogleAdsTag />
    </div>
  );
}
