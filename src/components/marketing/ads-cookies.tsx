/**
 * The cookie policies' "Advertising (optional)" section, shared by ClinForms' and ClinDesk's /cookies (the tag and its
 * cookies are the same on both sites: src/components/ads/google-ads.ts). Cookie disclosure has to name the provider,
 * so this is the one customer-facing place (with the privacy policies and the banners) that names Google.
 *
 * The cookie names and lifetimes are what the tag sets (checked in a browser on 31/10/2026, scripts/e2e/google-ads.cjs:
 * _gcl_au, 90 days, on every page after consent; _gcl_aw, 90 days, after arriving with an advert click id; _gcl_gs is
 * Google's companion click cookie for some click types). Google's own cookies on its domains are Google's to describe;
 * the policy links to Google's pages.
 */
import type { ReactNode } from "react";
import { LegalTable } from "./legal-page";

/** First-party cookies the tag sets on our domain – removed when consent is withdrawn (google-ads.ts isGoogleAdsCookie). */
export const GOOGLE_ADS_FIRST_PARTY_COOKIES = ["_gcl_au", "_gcl_aw", "_gcl_gs"] as const;

export function AdsCookiesSection({
  conversion,
  extraRows = [],
  settings,
}: {
  /** What a conversion is on this site, e.g. "request access" / "book a demo". */
  conversion: string;
  /** Rows for storage only this site uses for the measurement. */
  extraRows?: ReactNode[][];
  /** The "Cookie settings" button (each site's own). */
  settings: ReactNode;
}) {
  return (
    <>
      <h2 id="advertising">Advertising (optional)</h2>
      <p>
        Only if you allow advertising cookies, and only on this website&rsquo;s public pages, we use Google&rsquo;s
        advertising tag (Google Ads, provided by Google Ireland Limited and Google LLC) to see whether people who clicked
        one of our adverts on Google went on to {conversion}. Nothing is loaded from Google until you accept. We send
        Google no names, emails, form contents or patient information, and the tag never runs in the application, the
        sign-in pages or a clinic&rsquo;s patient pages.
      </p>
      <p>
        Our two websites, clinforms.co.uk and clindesk.co.uk, share this measurement: when you have accepted advertising
        cookies, a link from one site to the other carries a short code (<code>_gl</code>) so that Google can tell it is
        the same visit. You can change your mind at any time: {settings}. When you withdraw consent we tell the tag to stop
        and remove its cookies from this website; Google&rsquo;s own cookies on its domains are removed with your
        browser&rsquo;s settings, and you can manage the adverts Google shows you at{" "}
        <a href="https://myadcenter.google.com/" rel="noopener noreferrer">
          myadcenter.google.com
        </a>
        . How Google uses this data:{" "}
        <a href="https://policies.google.com/technologies/partner-sites" rel="noopener noreferrer">
          policies.google.com/technologies/partner-sites
        </a>
        .
      </p>
      <LegalTable
        label="Advertising cookies"
        columns={["Name", "Provider", "Purpose", "Duration"]}
        rows={[
          [
            <code key="n">_gcl_au</code>,
            "Google (first-party cookie on this website)",
            `Lets Google count a visit that followed a click on one of our adverts, and whether it led you to ${conversion}`,
            "90 days",
          ],
          [
            <>
              <code>_gcl_aw</code>, <code>_gcl_gs</code>
            </>,
            "Google (first-party cookies on this website)",
            "Only if you arrived from one of our Google adverts: remember that advert click, so that a later request can be counted for it",
            "90 days",
          ],
          [
            <>
              Cookies on Google&rsquo;s own domains, such as <code>IDE</code> and <code>test_cookie</code> (doubleclick.net)
              and <code>NID</code> (google.com)
            </>,
            "Google (third-party cookies)",
            "Google's own advertising cookies: measure advert clicks and conversions, and – where your Google settings allow – which adverts you see",
            <>
              Set by Google: for example <code>IDE</code> up to 13 months, <code>test_cookie</code> 15 minutes,{" "}
              <code>NID</code> 6 months
            </>,
          ],
          ...extraRows,
        ]}
      />
    </>
  );
}
