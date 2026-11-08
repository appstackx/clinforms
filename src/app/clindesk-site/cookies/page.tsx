import { DEMO_SENT_KEY } from "@/components/ads/google-ads";
import { Fill } from "@/components/clindesk/fill";
import { CONSENT_COOKIE, STATS_COOKIE } from "@/components/consent/consent";
import { StatsToggle } from "@/components/consent/stats-toggle";
import { CookieSettingsButton } from "@/components/consent/cookie-settings-button";
import { AdsCookiesSection } from "@/components/marketing/ads-cookies";
import { LegalFrame } from "@/components/clindesk/legal-frame";
import { LegalPage, LegalTable } from "@/components/marketing/legal-page";
import { CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { CLINDESK_PRIVACY_COOKIES_LAST_UPDATED, CONTACT_EMAIL, clindeskMetadata } from "@/lib/clindesk/site";
import { SESSION_COOKIE_NAMES } from "@/lib/session-cookie";
import { COMPANY } from "@/lib/site";
import { PORTAL_TIMINGS } from "@/modules/pms/portal/policy";

/**
 * /cookies on clindesk.co.uk – ClinDesk's own cookie policy. Since 08/11/2026 the public website runs cookieless usage
 * statistics for every visitor unless turned off (src/components/analytics; opt-out cookie STATS_COOKIE), and asks for
 * two optional purposes: analytics cookies and advertising measurement (src/components/clindesk/cookie-consent.tsx,
 * src/components/ads/google-ads.ts). The cookies listed are the ones the code sets (names checked against the code by
 * src/server/site/clindesk-site.test.ts):
 * - the consent cookie (src/components/consent/consent.ts) and, with advertising consent, the demo form's
 *   short-lived note in session storage (DEMO_SENT_KEY) and the tag's cookies (src/components/marketing/ads-cookies.tsx);
 * - sign-in: Better Auth with the prefix of src/lib/session-cookie.ts;
 * - pms_site: the clinic area's site choice (src/components/pms/shell/site-cookie.ts, 12 months);
 * - clinic_portal, clinic_manage, pms_device: the patient pages (src/server/pms/portal/portal-auth.ts,
 *   public-page.ts, device-flow.ts).
 * The human check (only where its keys are set) is loaded from its provider; what it stores is a fill-in.
 */
export const metadata = clindeskMetadata({
  path: "/cookies",
  title: `Cookie policy – ${CLINIC_SYSTEM_NAME}`,
  description: `The cookies the ${CLINIC_SYSTEM_NAME} website, application and patient pages use.`,
});

const COLUMNS = ["Name", "Type", "Purpose", "Duration"];

/** "clinforms" from "__Secure-clinforms.session_token" / "clinforms.session_token" (one entry per prefix). */
const SIGN_IN_PREFIXES = Array.from(new Set(SESSION_COOKIE_NAMES.map((n) => n.replace(/^__Secure-/, "").split(".")[0])));

export default function ClindeskCookiesPage() {
  const t = PORTAL_TIMINGS;
  return (
    <LegalFrame>
      <LegalPage
        title="Cookie policy"
        lastUpdated={CLINDESK_PRIVACY_COOKIES_LAST_UPDATED}
        intro={
          <p>
            Cookies are small pieces of data a website keeps in your browser. {CLINIC_SYSTEM_NAME} uses the cookies it
            needs to work and – only if you allow them – analytics cookies and Google&rsquo;s advertising cookies on this
            website&rsquo;s public pages. We also count visits and clicks on the public pages to improve the website,
            without cookies or anything stored on your device; you can turn that off with one click. The application
            clinics sign in to and a clinic&rsquo;s patient pages never use advertising cookies or these statistics.
          </p>
        }
      >
        <h2 id="statistics">Usage statistics (on unless you turn them off)</h2>
        <p>
          To improve this website we count visits and clicks on its public pages: which pages are viewed, the website you
          came from, the campaign tags in the link you followed (such as utm_source), whether you arrived from an advert
          (yes or no only), and clicks on &ldquo;Book a demo&rdquo;, the demo form (started and sent – never what you
          type) and links to our forms website. We do this under the UK&rsquo;s exemption for statistics used only to
          improve our own website, so we don&rsquo;t ask first – but we tell you here and you can turn it off at any time.
        </p>
        <p>
          No cookies are set and nothing is stored on your device: each page view is counted on its own. The statistics
          are never used for advertising and never shared. Our provider, PostHog (EU region), processes them for us only,
          through our own web address.
        </p>
        <p>
          <StatsToggle className="cd-inline-btn" /> You can also use the banner or{" "}
          <CookieSettingsButton className="cd-inline-btn" />. A Do Not Track or Global Privacy Control signal from your
          browser turns them off too.
        </p>

        <h2 id="your-choice">Your choice</h2>
        <p>
          The banner on your first visit lets you accept or reject analytics and advertising cookies; nothing optional
          runs until you accept. You can change your mind at any time: <CookieSettingsButton className="cd-inline-btn" />.
          If your browser sends a Do Not Track or Global Privacy Control signal, we treat it as a refusal and analytics
          and advertising cookies stay off.
        </p>

        <h2 id="necessary">Strictly necessary</h2>
        <p>
          These are needed for the website, the application clinics sign in to and a clinic&rsquo;s patient pages to
          work, so they do not need your consent. They are all first-party: set by {CLINIC_SYSTEM_NAME}, not by anyone
          else.
        </p>
        <LegalTable
          label="Strictly necessary cookies"
          columns={COLUMNS}
          rows={[
            [<code key="n">{CONSENT_COOKIE}</code>, "Cookie", "Remembers whether you accepted or rejected analytics and advertising cookies", "6 months"],
            [<code key="s">{STATS_COOKIE}</code>, "Cookie", "Only if you turn usage statistics off: remembers that choice", "12 months"],
            [
              <>
                {SIGN_IN_PREFIXES.map((p, i) => (
                  <span key={p}>
                    {i > 0 ? ", " : null}
                    <code>{p}.*</code>
                  </span>
                ))}{" "}
                (with a <code>__Secure-</code> prefix on secure connections)
              </>,
              "Cookies",
              "Keep clinic users signed in, complete two-step verification, and protect the session",
              "Until you sign out or the session expires",
            ],
            [
              <code key="n">pms_site</code>,
              "Cookie",
              "Remembers which of the clinic's sites a signed-in user last chose to look at",
              "12 months",
            ],
            [
              <code key="n">clinic_portal</code>,
              "Cookie",
              "Keeps a patient signed in to their clinic's patient portal",
              `Until the patient signs out, or at most ${t.sessionHours} hours (the session ends after ${t.idleMinutes} minutes without use)`,
            ],
            [
              <code key="n">clinic_manage</code>,
              "Cookie",
              <>Lets a patient who opened a &ldquo;manage this booking&rdquo; link change or cancel that booking</>,
              "Until a day after the appointment",
            ],
            [
              <code key="n">pms_device</code>,
              "Cookie",
              "On a clinic's own tablet or computer: links it to the one form a patient is completing in the clinic",
              `Until that form expires (at most ${t.handoffMinutes} minutes)`,
            ],
          ]}
        />

        <h2 id="analytics">Analytics cookies (optional)</h2>
        <p>
          Only if you allow analytics cookies, the same usage statistics keep a random identifier in your browser, so a
          returning visit is recognised. It records no names, emails, form contents or patient information, and it does
          not record your screen or what you type.
        </p>
        <LegalTable
          label="Analytics storage"
          columns={COLUMNS}
          rows={[
            [
              <code key="n">ph_*</code>,
              "Local storage",
              "A random identifier so that visits can be counted without knowing who you are",
              "Removed when you reject or withdraw consent, or turn statistics off; otherwise until you clear your browser data",
            ],
          ]}
        />

        <AdsCookiesSection
          conversion="book a demo"
          settings={<CookieSettingsButton className="cd-inline-btn" />}
          extraRows={[
            [
              <code key="n">{DEMO_SENT_KEY}</code>,
              `${CLINIC_SYSTEM_NAME} (session storage on this website)`,
              "Only with advertising consent: notes for a few minutes that you just sent the demo form, so that the thank-you page counts the request once",
              "Removed when the thank-you page opens; at most 10 minutes, and never after you close the tab",
            ],
          ]}
        />

        <h2 id="human-check">Human check</h2>
        <p>
          Where a clinic&rsquo;s online booking page or patient portal sign-in uses a human check, the check is loaded from
          our provider of that service, only on those pages, to tell people from automated programs. What it stores in
          your browser: <Fill k="legal.humanCheckStorage" />.
        </p>

        <h2 id="more">More information</h2>
        <p>
          {CLINIC_SYSTEM_NAME} is run by {COMPANY.legalName}. Our <a href="/privacy">privacy policy</a> explains how we use personal data. Questions:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </LegalPage>
    </LegalFrame>
  );
}
