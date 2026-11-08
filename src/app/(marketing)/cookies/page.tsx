import type { Metadata } from "next";
import Link from "next/link";
import { CONSENT_COOKIE, STATS_COOKIE } from "@/components/consent/consent";
import { StatsToggle } from "@/components/consent/stats-toggle";
import { CookieSettingsButton } from "@/components/consent/cookie-settings-button";
import { AdsCookiesSection } from "@/components/marketing/ads-cookies";
import { LegalPage, LegalTable } from "@/components/marketing/legal-page";
import { COMPANY, COOKIES_LAST_UPDATED } from "@/lib/site";
import { PRODUCT } from "@/modules/medreport/config.public";

const DESCRIPTION = `The cookies and browser storage the ${PRODUCT.name} website, application and demo use, and how to change your choice.`;

export const metadata: Metadata = {
  title: "Cookie policy",
  description: DESCRIPTION,
  alternates: { canonical: "/cookies" },
  openGraph: { title: `Cookie policy · ${PRODUCT.name}`, description: DESCRIPTION, url: "/cookies", siteName: PRODUCT.name, locale: "en_GB", type: "website" },
};

const COLUMNS = ["Name", "Type", "Purpose", "Duration"];

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookie policy"
      lastUpdated={COOKIES_LAST_UPDATED}
      intro={
        <p>
          Cookies and browser storage are small pieces of data a website keeps in your browser. {PRODUCT.name} uses only
          what it needs to work, plus – if, and only if, you allow them – analytics and Google&rsquo;s advertising
          cookies on this website&rsquo;s public pages. We also count visits and clicks on the public pages to improve
          the website, without cookies or anything stored on your device; you can turn that off with one click. The
          application, the demo and the sign-in pages never use advertising cookies.
        </p>
      }
    >
      <h2 id="statistics">Usage statistics (on unless you turn them off)</h2>
      <p>
        To improve this website we count visits and clicks on its public pages: which pages are viewed, the website you
        came from, the campaign tags in the link you followed (such as utm_source), whether you arrived from an advert
        (yes or no only), and clicks on &ldquo;Request access&rdquo;, our forms (started and sent – never what you type)
        and links to our clinic system&rsquo;s website. We do this under the UK&rsquo;s exemption for statistics used
        only to improve our own website, so we don&rsquo;t ask first – but we tell you here and you can turn it off at
        any time.
      </p>
      <p>
        No cookies are set and nothing is stored on your device: each page view is counted on its own. The statistics
        are never used for advertising and never shared. Our provider, PostHog (EU region), processes them for us only,
        through our own web address. It never runs in the application, the demo or the sign-in pages.
      </p>
      <p>
        <StatsToggle className="font-medium text-teal-800 underline underline-offset-2 hover:text-teal-900" /> You can
        also use the banner or{" "}
        <CookieSettingsButton className="font-medium text-teal-800 underline underline-offset-2 hover:text-teal-900" />. A
        Do Not Track or Global Privacy Control signal from your browser turns them off too.
      </p>

      <h2 id="your-choice">Your choice</h2>
      <p>
        The banner on your first visit lets you accept or reject the optional cookies (&ldquo;Manage&rdquo; lets you
        choose analytics and advertising separately). Nothing optional runs until you accept. You can change your mind at
        any time: <CookieSettingsButton className="font-medium text-teal-800 underline underline-offset-2 hover:text-teal-900" />.
        If your browser sends a Do Not Track or Global Privacy Control signal, we treat it as a refusal and analytics and
        advertising cookies stay off.
      </p>

      <h2 id="necessary">Strictly necessary</h2>
      <p>These are needed for the site and the service to work, so they do not need your consent.</p>
      <LegalTable
        label="Strictly necessary cookies and storage"
        columns={COLUMNS}
        rows={[
          [<code key="n">{CONSENT_COOKIE}</code>, "Cookie (first-party)", "Remembers whether you accepted or rejected analytics and advertising cookies", "6 months"],
          [<code key="s">{STATS_COOKIE}</code>, "Cookie (first-party)", "Only if you turn usage statistics off: remembers that choice", "12 months"],
          [
            <>
              <code>clinforms.*</code> (with a <code>__Secure-</code> prefix on secure connections)
            </>,
            "Cookies (first-party)",
            "Keep clinic users signed in, complete two-step verification, and protect the session",
            "Until you sign out or the session expires",
          ],
          [
            <code key="n">medreport.*</code>,
            "Local and session storage",
            "The public demo: keeps the fictional reports and referrer forms you work on, and the demo session, in your browser",
            "Until you reset the demo or clear your browser data (session items: until you close the tab)",
          ],
          [
            <code key="n">medreport-forms</code>,
            "IndexedDB",
            "The public demo: keeps the referrer form files you add, in your browser",
            "Until you reset the demo or clear your browser data",
          ],
          [
            <>
              <code>tm3sim.*</code>, <code>tm3sim</code>
            </>,
            "Local storage, IndexedDB",
            <>The demo&rsquo;s simulated clinic system: keeps the documents filed back to its fictional records</>,
            "Until you reset the demo or clear your browser data",
          ],
        ]}
      />
      <p>
        The demo&rsquo;s browser storage holds fictional data only and stays in your browser; the demo sends a record to our
        server only while it completes or renders a form for you.
      </p>

      <h2 id="analytics">Analytics cookies (optional)</h2>
      <p>
        Only if you allow analytics cookies, the same usage statistics may keep a random identifier in your browser, so
        a returning visit is recognised, and count a few product actions in the application. It records no names,
        emails, form contents or patient information, and it does not record your screen or what you type. Requests go
        through our own domain to PostHog&rsquo;s EU region.
      </p>
      <LegalTable
        label="Analytics storage"
        columns={COLUMNS}
        rows={[
          [
            <code key="n">ph_*</code>,
            "Local and session storage",
            "A random identifier so that visits can be counted without knowing who you are",
            "Removed when you reject or withdraw consent; otherwise until you clear your browser data",
          ],
        ]}
      />

      <AdsCookiesSection
        conversion="request access"
        settings={<CookieSettingsButton className="font-medium text-teal-800 underline underline-offset-2 hover:text-teal-900" />}
      />

      <h2 id="more">More information</h2>
      <p>
        Our <Link href="/privacy">privacy policy</Link> explains how we use personal data. Questions:{" "}
        <a href={`mailto:${COMPANY.contactEmail}`}>{COMPANY.contactEmail}</a>.
      </p>
    </LegalPage>
  );
}
