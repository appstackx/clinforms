import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalTable } from "@/components/marketing/legal-page";
import { COMPANY, PRIVACY_LAST_UPDATED, companyRegistrationLine } from "@/lib/site";
import { PRODUCT } from "@/modules/medreport/config.public";

const DESCRIPTION = `How ${COMPANY.legalName} handles personal data for the ${PRODUCT.name} website, clinic user accounts and the patient information clinics process with ${PRODUCT.name}.`;

export const metadata: Metadata = {
  title: "Privacy policy",
  description: DESCRIPTION,
  alternates: { canonical: "/privacy" },
  openGraph: { title: `Privacy policy · ${PRODUCT.name}`, description: DESCRIPTION, url: "/privacy", siteName: PRODUCT.name, locale: "en_GB", type: "website" },
};

export default function PrivacyPage() {
  const registration = companyRegistrationLine();
  const email = COMPANY.contactEmail;
  return (
    <LegalPage
      title="Privacy policy"
      lastUpdated={PRIVACY_LAST_UPDATED}
      intro={
        <p>
          This policy explains how {COMPANY.legalName} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) uses personal data in connection
          with {PRODUCT.name}: when you visit this website, when you ask us for access, when you use {PRODUCT.name} as a
          member of a clinic, and when a clinic uses {PRODUCT.name} to process its patients&rsquo; information.
        </p>
      }
    >
      <h2 id="who-we-are">1. Who we are</h2>
      <p>
        {PRODUCT.name} is a product of {COMPANY.legalName}.
        {registration ? ` ${registration}` : null} You can contact us about anything in this policy at{" "}
        <a href={`mailto:${email}`}>{email}</a>.
      </p>
      {COMPANY.icoRegistration ? (
        <p>We are registered with the Information Commissioner&rsquo;s Office under number {COMPANY.icoRegistration}.</p>
      ) : null}

      <h2 id="our-roles">2. Our two roles</h2>
      <ul>
        <li>
          <strong>Controller</strong> for the personal data of website visitors, people who request access, and the
          users of clinic accounts (for example their names, work emails and sign-in records). We decide how and why this
          data is used, as described below.
        </li>
        <li>
          <strong>Processor</strong> for the patient information that a clinic brings into {PRODUCT.name} (registration
          details, treatment notes, outcome measures and the referrer forms completed from them). The clinic is the
          controller. We process this information only on the clinic&rsquo;s documented instructions, under a data
          processing agreement (DPA) made under Article 28 of the UK GDPR, and only to provide the service to that clinic.
        </li>
      </ul>
      <p>
        If you are a patient of a clinic that uses {PRODUCT.name}, please contact your clinic about your information: it
        decides how your data is used and will deal with your request. We will help the clinic respond.
      </p>

      <h2 id="what-we-collect">3. Personal data we control, and why</h2>
      <LegalTable
        label="Personal data we control"
        columns={["What", "Why we use it", "Lawful basis", "How long we keep it"]}
        rows={[
          [
            <>
              <strong>Website visits:</strong> technical records of requests (IP address, browser type, the page requested,
              time)
            </>,
            "To deliver the website, keep it secure and investigate faults or misuse",
            "Legitimate interests (running a secure website)",
            "A limited period kept by our hosting provider for security and troubleshooting, then deleted",
          ],
          [
            <>
              <strong>Analytics</strong> (only if you allow it): pages of this public website you visit, the site you came
              from, approximate location derived from your IP address, browser and device type, and a few product actions
              without names or other content
            </>,
            "To understand which pages are useful and improve the website and the product",
            <>Consent – you can withdraw it at any time through &ldquo;Cookie settings&rdquo;</>,
            "Up to 12 months",
          ],
          [
            <>
              <strong>Demo video plays</strong> (only if you play or download our{" "}
              <Link href="/demo">product demo</Link>): your IP address, browser details, the time and the file requested
            </>,
            "To deliver the demo video to you, keep it available and count how often it is played",
            "Legitimate interests (showing our product to people who choose to watch it)",
            "We keep no copy. Our media delivery provider keeps its own records of requests; its dashboard shows us about the last month of them",
          ],
          [
            <>
              <strong>Access requests:</strong> clinic name, your name, work email, phone number (optional), number of sites
              and your message
            </>,
            `To reply to you, and to discuss and set up a ${PRODUCT.name} account for your clinic`,
            "Legitimate interests (responding to enquiries) and steps taken at your request before a contract",
            "Up to 24 months after our last contact, unless your clinic becomes a customer",
          ],
          [
            <>
              <strong>Clinic user accounts:</strong> name, work email, role, job title and professional registration number
              (for clinicians who approve forms), password (stored only as a one-way hash), two-step verification
              settings, sign-in sessions (including IP address and browser), and a record of account and security actions
              (such as sign-ins and changes to roles)
            </>,
            "To provide the service to your clinic, keep accounts secure, show who approved each form, and meet our obligations to the clinic",
            "Performance of our contract with your clinic, and legitimate interests (security and accountability)",
            <>
              While your clinic&rsquo;s account is active; then deleted within 90 days of the account closing, unless the
              clinic&rsquo;s instructions or the law require us to keep a record (such as who approved a form) for longer
            </>,
          ],
          [
            <>
              <strong>Service emails:</strong> invitations, password resets and security notices
            </>,
            "To operate your account",
            "Performance of our contract with your clinic",
            "Email delivery records are kept for a limited period by our email provider",
          ],
        ]}
      />
      <p>
        We do not sell personal data, we do not use it for advertising, and we do not make decisions about anyone based
        solely on automated processing that have legal or similarly significant effects.
      </p>

      <h3 id="demo-video">The demo video</h3>
      <p>
        Our <Link href="/demo">product demo</Link> is stored in the EU by our media delivery provider and played from
        media.clinforms.co.uk. Opening the page loads nothing from that provider: the poster image and the captions come
        from this website, and the video is fetched only when you press play or choose a chapter (or download the file).
        That request, like any request for a web page, carries your IP address and the details your browser sends with
        it, such as its type and language. It carries no cookies, the video sets none, and we do not ask who you are.
      </p>
      <p>
        The provider keeps a record of each request: for example the IP address, the time, the file, the browser type,
        the site it was played from and the country it came from. Its dashboard shows us a sample of these records for
        about the last month. The provider also asks browsers to report failed requests: after a play, some browsers
        keep that instruction for up to a week, and if a later request for the video fails they send the provider a
        short error report (the address requested, the kind of error, timings and the browser type), which reaches it
        from your IP address. Successful requests are not reported. We use these records only to keep the video
        available and to count how often it is played, and we do not try to work out who watched. If you allow
        analytics, we also count that the video was played and played to the end, with nothing that identifies you. Our
        lawful basis is our legitimate interest in showing our product to people who choose to watch it.
      </p>

      <h2 id="patient-data">4. Patient information we process for clinics</h2>
      <p>When a clinic uses {PRODUCT.name}, we process its patients&rsquo; information as its processor:</p>
      <ul>
        <li>
          <strong>Categories:</strong> identification and contact details, dates, referrer and claim references,
          treatment notes and outcome measures (health data, a special category under the UK GDPR), and the completed
          forms.
        </li>
        <li>
          <strong>Purpose:</strong> to complete the referrer forms the clinic chooses, for its clinicians to review and
          approve, and nothing else. Patient information is never used for marketing, never sold and never combined with
          other clinics&rsquo; data.
        </li>
        <li>
          <strong>Minimisation:</strong> before treatment notes are used to draft answers, names, dates of birth,
          addresses and contact details are removed. The clinic can see exactly what is sent.
        </li>
        <li>
          <strong>Security:</strong> the information is encrypted at rest with a key specific to each clinic. See{" "}
          <Link href="/security">Security</Link>.
        </li>
        <li>
          <strong>Retention:</strong> the clinic sets how long reports are kept. Automatic deletion of reports that have
          not changed for that period is being switched on (see <Link href="/security">Security</Link>). All of the clinic&rsquo;s data is returned or deleted when its agreement
          ends, as the DPA sets out.
        </li>
      </ul>

      <h2 id="sub-processors">5. Who helps us provide the service</h2>
      <p>
        We use a small number of carefully chosen service providers (sub-processors). Each acts only on our instructions
        under a written contract with data protection terms:
      </p>
      <ul>
        <li>
          <strong>Application hosting</strong> – runs the website and the application (London region).
        </li>
        <li>
          <strong>Database and file storage</strong> – stores clinic data, encrypted at rest (EU).
        </li>
        <li>
          <strong>Drafting service</strong> – receives minimised extracts of treatment notes to draft answers for the
          clinician to review. It may not use clinic data to develop or improve its own services.
        </li>
        <li>
          <strong>Email delivery</strong> – sends invitations, password resets and notifications.
        </li>
        <li>
          <strong>Product analytics</strong> – only for visitors and users who allow analytics (EU).
        </li>
        <li>
          <strong>Media delivery</strong> – stores our product demo video in the EU and delivers it when a visitor presses
          play on the demo page. It receives no clinic data and no account data.
        </li>
      </ul>
      <p>
        The full list of sub-processors, with their locations and the safeguards that apply, is part of our DPA and is
        available on request at <a href={`mailto:${email}`}>{email}</a>. We tell clinics before we add or replace a
        sub-processor that handles patient information, so they can object.
      </p>

      <h2 id="transfers">6. Where data is stored and international transfers</h2>
      <p>
        The application runs in the UK (London) and clinic data is stored in the EU, which the UK recognises as providing
        adequate protection. Where a service provider processes personal data outside the UK, we make sure the transfer is
        protected as the UK GDPR requires – for example by UK adequacy regulations, the UK International Data Transfer
        Agreement or the UK Addendum to the EU Standard Contractual Clauses – and we describe these transfers in the DPA.
      </p>
      <p>
        The demo video is stored in the EU. When you play it, it is delivered from our media delivery provider&rsquo;s
        global network, usually from a data centre near you, which may be outside the UK and the EU. The provider is
        based in the United States, and its records of requests (and any error reports) may be kept there; as with our
        other providers, that transfer is protected as described above.
      </p>

      <h2 id="rights">7. Your rights</h2>
      <p>Under the UK GDPR you have the right to:</p>
      <ul>
        <li>access the personal data we hold about you and receive a copy;</li>
        <li>have inaccurate data corrected, and incomplete data completed;</li>
        <li>have your data erased, or its use restricted, in certain circumstances;</li>
        <li>object to our use of your data where we rely on legitimate interests;</li>
        <li>receive data you gave us in a portable format, in certain circumstances;</li>
        <li>withdraw consent at any time, where we rely on consent (for analytics, use &ldquo;Cookie settings&rdquo;).</li>
      </ul>
      <p>
        To use any of these rights, email <a href={`mailto:${email}`}>{email}</a>. We will reply within one month, and may
        need to confirm your identity first. For patient information we process for a clinic, we will pass your request to
        the clinic and help it respond.
      </p>

      <h2 id="complaints">8. Complaints</h2>
      <p>
        If you have a concern, please contact us first and we will try to resolve it. You also have the right to complain
        to the Information Commissioner&rsquo;s Office (ICO), the UK data protection regulator:{" "}
        <a href="https://ico.org.uk/make-a-complaint/" rel="noopener noreferrer">
          ico.org.uk/make-a-complaint
        </a>{" "}
        or 0303 123 1113.
      </p>

      <h2 id="cookies">9. Cookies</h2>
      <p>
        We use strictly necessary cookies and browser storage to run the site, and analytics only if you allow it. See our{" "}
        <Link href="/cookies">cookie policy</Link>.
      </p>

      <h2 id="changes">10. Changes to this policy</h2>
      <p>
        We will update this policy when how we use personal data changes, and show the date of the latest version at the
        top. If a change affects clinics materially, we will tell them in advance.
      </p>
    </LegalPage>
  );
}
