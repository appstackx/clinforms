import { Fill } from "@/components/clindesk/fill";
import { LegalFrame } from "@/components/clindesk/legal-frame";
import { LegalPage, LegalTable } from "@/components/marketing/legal-page";
import { CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { CLINDESK_LEGAL_LAST_UPDATED, CONTACT_EMAIL, clindeskMetadata } from "@/lib/clindesk/site";
import { SESSION_COOKIE_NAMES } from "@/lib/session-cookie";
import { COMPANY } from "@/lib/site";
import { PORTAL_TIMINGS } from "@/modules/pms/portal/policy";

/**
 * /cookies on clindesk.co.uk – ClinDesk's own cookie policy. ClinDesk's hosts run no analytics and show no cookie
 * banner (src/lib/brand.ts analytics: false), and no page of this brand offers the consent dialog, so the consent
 * cookie is never set here. The cookies listed are the ones the code sets (names checked against the code by
 * src/server/site/clindesk-site.test.ts):
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
        lastUpdated={CLINDESK_LEGAL_LAST_UPDATED}
        intro={
          <p>
            Cookies are small pieces of data a website keeps in your browser. {CLINIC_SYSTEM_NAME} uses only the cookies
            it needs to work. We do not use analytics, advertising or tracking cookies, so there is no cookie banner and
            nothing to switch off.
          </p>
        }
      >
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
