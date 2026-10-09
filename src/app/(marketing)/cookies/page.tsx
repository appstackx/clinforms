import type { Metadata } from "next";
import Link from "next/link";
import { CONSENT_COOKIE } from "@/components/consent/consent";
import { CookieSettingsButton } from "@/components/consent/cookie-settings-button";
import { LegalPage, LegalTable } from "@/components/marketing/legal-page";
import { COMPANY, LEGAL_LAST_UPDATED } from "@/lib/site";
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
      lastUpdated={LEGAL_LAST_UPDATED}
      intro={
        <p>
          Cookies and browser storage are small pieces of data a website keeps in your browser. {PRODUCT.name} uses only
          what it needs to work, plus analytics if – and only if – you allow it. We do not use advertising cookies or
          third-party cookies.
        </p>
      }
    >
      <h2 id="your-choice">Your choice</h2>
      <p>
        When analytics is in use, the banner on your first visit lets you accept or reject it. You can change your mind at
        any time: <CookieSettingsButton className="font-medium text-teal-800 underline underline-offset-2 hover:text-teal-900" />.
        If your browser sends a Do Not Track or Global Privacy Control signal, we treat it as a refusal and analytics stays
        off.
      </p>

      <h2 id="necessary">Strictly necessary</h2>
      <p>These are needed for the site and the service to work, so they do not need your consent.</p>
      <LegalTable
        label="Strictly necessary cookies and storage"
        columns={COLUMNS}
        rows={[
          [<code key="n">{CONSENT_COOKIE}</code>, "Cookie (first-party)", "Remembers whether you accepted or rejected analytics", "6 months"],
          [
            <>
              <code>clinforms.*</code> (with a <code>__Secure-</code> prefix on secure connections)
            </>,
            "Cookies (first-party)",
            "Keep clinic users signed in, complete two-factor sign-in, and protect the session",
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

      <h2 id="analytics">Analytics (optional)</h2>
      <p>
        Only if you allow analytics, and only on this site, we use a product analytics service hosted in the EU to count
        visits to our public pages and a few product actions. It records no names, emails, form contents or patient
        information, and it does not record your screen or what you type. Requests go through our own domain.
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

      <h2 id="more">More information</h2>
      <p>
        Our <Link href="/privacy">privacy policy</Link> explains how we use personal data. Questions:{" "}
        <a href={`mailto:${COMPANY.contactEmail}`}>{COMPANY.contactEmail}</a>.
      </p>
    </LegalPage>
  );
}
