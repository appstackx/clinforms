import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/marketing/legal-page";
import { COMPANY, LEGAL_LAST_UPDATED, companyRegistrationLine } from "@/lib/site";
import { PRODUCT } from "@/modules/medreport/config.public";

const DESCRIPTION = `The terms on which ${COMPANY.legalName} provides ${PRODUCT.name} to physiotherapy clinics.`;

export const metadata: Metadata = {
  title: "Terms of service",
  description: DESCRIPTION,
  alternates: { canonical: "/terms" },
  openGraph: { title: `Terms of service · ${PRODUCT.name}`, description: DESCRIPTION, url: "/terms", siteName: PRODUCT.name, locale: "en_GB", type: "website" },
};

export default function TermsPage() {
  const registration = companyRegistrationLine();
  const email = COMPANY.contactEmail;
  return (
    <LegalPage
      title="Terms of service"
      lastUpdated={LEGAL_LAST_UPDATED}
      intro={
        <p>
          These terms apply when a clinic uses {PRODUCT.name}. They are a business-to-business agreement between{" "}
          {COMPANY.legalName} and the clinic, and they apply together with the clinic&rsquo;s order and our data processing
          agreement.
        </p>
      }
    >
      <h2 id="about">1. About these terms</h2>
      <p>
        {PRODUCT.name} is provided by {COMPANY.legalName} (&ldquo;we&rdquo;, &ldquo;us&rdquo;).
        {registration ? ` ${registration}` : null} In these terms, the &ldquo;clinic&rdquo; is the organisation named in the
        order, &ldquo;users&rdquo; are the people the clinic invites, the &ldquo;service&rdquo; is {PRODUCT.name} and its
        support, and &ldquo;clinic data&rdquo; is all information the clinic or its users put into the service, including
        patient information.
      </p>
      <p>
        The agreement is made up of the order (which sets out the subscription, fees and any agreed service levels), these
        terms and the data processing agreement (DPA). If they conflict, the DPA wins on anything about personal data,
        then the order, then these terms.
      </p>

      <h2 id="accounts">2. Accounts and users</h2>
      <ul>
        <li>
          Accounts are set up by invitation. The clinic&rsquo;s owner or administrators decide who is invited and what role
          each user has, and remove users who no longer need access.
        </li>
        <li>
          Every user must sign in with their own account and two-factor authentication. Users must keep their password and
          authenticator device secure and must not share accounts.
        </li>
        <li>
          The clinic is responsible for what its users do in the service and must tell us promptly at{" "}
          <a href={`mailto:${email}`}>{email}</a> if it suspects unauthorised access.
        </li>
      </ul>

      <h2 id="acceptable-use">3. Acceptable use</h2>
      <p>The clinic and its users must not:</p>
      <ul>
        <li>use the service unlawfully, or to process information the clinic has no right to process;</li>
        <li>upload malicious code, or try to break, probe or get around the service&rsquo;s security or limits;</li>
        <li>copy, resell or reverse engineer the service, or use it to build a competing product;</li>
        <li>put patient information into the public demo, which is for fictional data only;</li>
        <li>use the service in a way that could harm it or other customers, for example by overloading it.</li>
      </ul>
      <p>We may suspend access that breaks these rules or puts the service or other customers at risk, and will tell the clinic why.</p>

      <h2 id="clinical-responsibility">4. Clinical and professional responsibility</h2>
      <ul>
        <li>
          {PRODUCT.name} is a documentation tool. It drafts answers to referrers&rsquo; forms from the clinic&rsquo;s own
          records. It does not diagnose, recommend treatment or give medical or legal advice, and it is not a medical
          device.
        </li>
        <li>
          Drafted answers can be incomplete or wrong. The treating clinician must review every answer against the records,
          complete any gaps and add any opinion themselves before approving a form.
        </li>
        <li>
          The clinic and its clinicians are responsible for the content of every approved form, for any opinion it
          contains, and for sending it to the referrer. {PRODUCT.name} never sends a form to a referrer on its own.
        </li>
        <li>
          The clinic is responsible for having the right to use each referrer&rsquo;s form and for following any
          instructions the referrer gives about it.
        </li>
      </ul>

      <h2 id="data">5. Clinic data and data protection</h2>
      <ul>
        <li>The clinic owns its clinic data. We use it only to provide the service to the clinic, as the DPA sets out.</li>
        <li>
          For patient information the clinic is the controller and we are its processor. The DPA, which forms part of this
          agreement, sets out the instructions, security measures, sub-processors, breach notification and the return or
          deletion of data.
        </li>
        <li>
          We may use information about how the service is used, which does not identify patients, users or clinics, to
          run, secure and improve the service.
        </li>
        <li>
          When the agreement ends, we return the clinic&rsquo;s data if it asks within 30 days, and then delete it, except
          where the law requires us to keep it.
        </li>
      </ul>
      <p>
        Our <Link href="/privacy">privacy policy</Link> explains how we handle the personal data we control.
      </p>

      <h2 id="availability">6. Availability and support</h2>
      <ul>
        <li>
          We use reasonable care and skill to keep the service available and secure. Unless the order sets a service level,
          we do not promise that it will be uninterrupted or error-free.
        </li>
        <li>We try to carry out planned maintenance outside UK clinic hours and give notice of significant downtime.</li>
        <li>Support is by email at {email}, on UK working days.</li>
        <li>
          We may improve and change the service. We will not remove a feature the clinic relies on without reasonable
          notice.
        </li>
      </ul>

      <h2 id="fees">7. Fees</h2>
      <p>
        Fees are set out in the order and are charged per clinic. Unless the order says otherwise, invoices are payable
        within 30 days and fees exclude VAT. We may change fees for a renewal term by giving at least 60 days&rsquo;
        notice before it starts. If an invoice is unpaid 14 days after we have reminded the clinic, we may suspend the
        service until it is paid.
      </p>

      <h2 id="ip">8. Intellectual property</h2>
      <p>
        We own the service and everything we provide with it. The clinic owns its clinic data and the forms it completes;
        it gives us the right to use them only to provide the service. If the clinic sends us suggestions, we may use them
        freely.
      </p>

      <h2 id="confidentiality">9. Confidentiality</h2>
      <p>
        Each party keeps the other&rsquo;s confidential information confidential and uses it only for this agreement,
        except where it is already public or disclosure is required by law. This continues after the agreement ends.
      </p>

      <h2 id="liability">10. Liability</h2>
      <ul>
        <li>
          Nothing in these terms limits liability for death or personal injury caused by negligence, for fraud or
          fraudulent misrepresentation, or for anything else that cannot be limited by law.
        </li>
        <li>
          Neither party is liable for loss of profits, revenue, business or goodwill, or for any indirect or consequential
          loss.
        </li>
        <li>
          Subject to the points above, each party&rsquo;s total liability arising from the agreement in any 12-month
          period is limited to the fees paid and payable by the clinic in the 12 months before the event giving rise to the
          claim. The order or the DPA may set a different limit for data protection claims.
        </li>
        <li>
          We are not responsible for the clinical content of approved forms, for decisions made using them, or for
          problems caused by the clinic&rsquo;s own systems, records or instructions.
        </li>
      </ul>

      <h2 id="term">11. Term and termination</h2>
      <ul>
        <li>The agreement runs for the subscription term in the order and renews as the order says.</li>
        <li>
          Either party may end the agreement by written notice if the other materially breaches it and does not put the
          breach right within 30 days of being asked to, or if the other becomes insolvent.
        </li>
        <li>Sections that by their nature continue (such as confidentiality, liability and data return) survive the end of the agreement.</li>
      </ul>

      <h2 id="changes">12. Changes to these terms</h2>
      <p>
        We may update these terms. We will give clinics at least 30 days&rsquo; notice by email of changes that affect them
        materially; the new terms then apply from the start of the next subscription term unless the clinic agrees
        earlier.
      </p>

      <h2 id="general">13. General</h2>
      <ul>
        <li>Neither party is liable for delays caused by events beyond its reasonable control.</li>
        <li>Neither party may transfer the agreement without the other&rsquo;s consent, except to a successor of its whole business.</li>
        <li>Notices are given by email to the addresses in the order (for us: {email}).</li>
        <li>The agreement is the entire agreement about its subject. No one else has rights under it.</li>
        <li>If part of the agreement is unenforceable, the rest still applies. Not enforcing a right is not a waiver of it.</li>
      </ul>

      <h2 id="law">14. Governing law</h2>
      <p>
        The agreement and any dispute about it are governed by the law of England and Wales, and the courts of England and
        Wales have exclusive jurisdiction.
      </p>
    </LegalPage>
  );
}
