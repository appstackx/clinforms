import { Fill } from "@/components/clindesk/fill";
import { LegalFrame } from "@/components/clindesk/legal-frame";
import { LegalPage } from "@/components/marketing/legal-page";
import { CLINFORMS_NAME, CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { CLINDESK_LEGAL_LAST_UPDATED, CONTACT_EMAIL, clindeskMetadata } from "@/lib/clindesk/site";
import { COMPANY } from "@/lib/site";

/**
 * /terms on clindesk.co.uk – ClinDesk's own terms of service, adapted from ClinForms' (src/app/(marketing)/terms,
 * unchanged): the same structure and legal clauses, with the service described as the clinic system (diary, records,
 * billing, patient portal, messages) and the Reports add-on as optional. Points a lawyer or Khuram must settle are
 * fill-ins (content/clindesk-site.json), shown as "[to confirm]" until filled in.
 */
export const metadata = clindeskMetadata({
  path: "/terms",
  title: `Terms – ${CLINIC_SYSTEM_NAME}`,
  description: `The terms on which ${COMPANY.legalName} provides ${CLINIC_SYSTEM_NAME} to physiotherapy and MSK clinics.`,
});

export default function ClindeskTermsPage() {
  const email = CONTACT_EMAIL;
  return (
    <LegalFrame>
      <LegalPage
        title="Terms of service"
        lastUpdated={CLINDESK_LEGAL_LAST_UPDATED}
        intro={
          <p>
            These terms apply when a clinic uses {CLINIC_SYSTEM_NAME}. They are a business-to-business agreement between{" "}
            {COMPANY.legalName} and the clinic, and they apply together with the clinic&rsquo;s order and our data
            processing agreement. These terms apply from <Fill k="legal.termsEffectiveFrom" />.
          </p>
        }
      >
        <h2 id="about">1. About these terms</h2>
        <p>
          {CLINIC_SYSTEM_NAME} is provided by {COMPANY.legalName} (&ldquo;we&rdquo;, &ldquo;us&rdquo;), company number{" "}
          <Fill k="company.number" />, registered office <Fill k="company.registeredOffice" />. In these terms, the
          &ldquo;clinic&rdquo; is the organisation named in the order, &ldquo;users&rdquo; are the people the clinic
          invites, the &ldquo;service&rdquo; is {CLINIC_SYSTEM_NAME} – the clinic management system, with its diary,
          patient records, billing, patient portal and messages – its support, and the Reports add-on (powered by{" "}
          {CLINFORMS_NAME}) if the order includes it, and &ldquo;clinic data&rdquo; is all information the clinic, its
          users or its patients put into the service, including patient information.
        </p>
        <p>
          The agreement is made up of the order (which sets out the subscription, fees and any agreed service levels),
          these terms and the data processing agreement (DPA). If they conflict, the DPA wins on anything about personal
          data, then the order, then these terms.
        </p>

        <h2 id="accounts">2. Accounts and users</h2>
        <ul>
          <li>
            Accounts are set up by invitation. The clinic&rsquo;s owner or administrators decide who is invited, what role
            and which sites each user has, and remove users who no longer need access.
          </li>
          <li>
            Every user must sign in with their own account and two-step verification. Users must keep their password and
            authenticator device secure and must not share accounts.
          </li>
          <li>
            Patients who use the clinic&rsquo;s patient portal sign in with one-time links sent to the email address on
            their record. The clinic is responsible for keeping patients&rsquo; contact details correct.
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
          <li>send messages through the service that the recipient has not agreed to receive where the law requires agreement;</li>
          <li>upload malicious code, or try to break, probe or get around the service&rsquo;s security or limits;</li>
          <li>copy, resell or reverse engineer the service, or use it to build a competing product;</li>
          <li>use the service in a way that could harm it or other customers, for example by overloading it.</li>
        </ul>
        <p>We may suspend access that breaks these rules or puts the service or other customers at risk, and will tell the clinic why.</p>

        <h2 id="clinical-responsibility">4. Clinical and professional responsibility</h2>
        <ul>
          <li>
            {CLINIC_SYSTEM_NAME} is a tool for running a clinic and keeping its records. It does not diagnose, recommend
            treatment or give medical or legal advice. <Fill k="legal.medicalDeviceStatus" />
          </li>
          <li>
            The clinic and its clinicians are responsible for the clinical records they write and sign, for clinical
            decisions, and for the letters, forms and messages they send from the service.
          </li>
          <li>
            The clinic is responsible for the data it brings across from another system, for checking it after an import,
            and for having the right to contact each patient in the way it chooses.
          </li>
          <li>
            If the clinic has the Reports add-on: drafted answers to referrers&rsquo; forms can be incomplete or wrong. The
            treating clinician must review every answer against the records, complete any gaps and add any opinion
            themselves before approving a form. The clinic is responsible for the content of every approved form and for
            sending it to the referrer; the add-on never sends a form to a referrer on its own. The clinic is responsible
            for having the right to use each referrer&rsquo;s form and for following any instructions the referrer gives
            about it.
          </li>
        </ul>

        <h2 id="data">5. Clinic data and data protection</h2>
        <ul>
          <li>The clinic owns its clinic data. We use it only to provide the service to the clinic, as the DPA sets out.</li>
          <li>
            For patient information the clinic is the controller and we are its processor. The DPA, which forms part of
            this agreement, sets out the instructions, security measures, sub-processors, breach notification and the
            return or deletion of data.
          </li>
          <li>
            The clinic decides how long its records are kept. Clinical records are never deleted automatically while the
            agreement runs.
          </li>
          <li>
            We may use information about how the service is used, which does not identify patients, users or clinics, to
            run, secure and improve the service.
          </li>
          <li>
            When the agreement ends, we return the clinic&rsquo;s data and then delete it, except where the law requires us
            to keep it. How the data is returned: <Fill k="pricing.dataExport" />.
          </li>
        </ul>
        <p>
          Our <a href="/privacy">privacy policy</a> explains how we handle the personal data we control.
        </p>

        <h2 id="availability">6. Availability and support</h2>
        <ul>
          <li>
            We use reasonable care and skill to keep the service available and secure. Unless the order sets a service
            level, we do not promise that it will be uninterrupted or error-free.
          </li>
          <li>We try to carry out planned maintenance outside UK clinic hours and give notice of significant downtime.</li>
          <li>
            Support is by <Fill k="support.channels" /> (<Fill k="support.hours" />
            ).
          </li>
          <li>
            We may improve and change the service. We will not remove a feature the clinic relies on without reasonable
            notice.
          </li>
        </ul>

        <h2 id="fees">7. Fees and payments</h2>
        <p>
          Fees are set out in the order. Unless the order says otherwise, invoices are payable within 30 days and fees{" "}
          <Fill k="pricing.vat" /> VAT. We may change fees for a renewal term by giving at least 60 days&rsquo; notice
          before it starts. If an invoice is unpaid 14 days after we have reminded the clinic, we may suspend the service
          until it is paid.
        </p>
        <p>
          The clinic sets its own prices for patients and payers and is responsible for its invoices, VAT and claims to
          insurers. Card payments from patients are optional and are taken by our card payment provider.{" "}
          <Fill k="legal.paymentProviderTerms" />
        </p>

        <h2 id="ip">8. Intellectual property</h2>
        <p>
          We own the service and everything we provide with it. The clinic owns its clinic data and the records, letters
          and forms it creates; it gives us the right to use them only to provide the service. If the clinic sends us
          suggestions, we may use them freely.
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
            Neither party is liable for loss of profits, revenue, business or goodwill, or for any indirect or
            consequential loss.
          </li>
          <li>
            Subject to the points above, each party&rsquo;s total liability arising from the agreement in any 12-month
            period is limited to <Fill k="legal.liabilityCap" />. The order or the DPA may set a different limit for data
            protection claims.
          </li>
          <li>
            We are not responsible for the clinical content of records, letters or approved forms, for decisions made
            using them, for messages the clinic sends, or for problems caused by the clinic&rsquo;s own systems, records or
            instructions.
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
          We may update these terms. We will give clinics at least 30 days&rsquo; notice by email of changes that affect
          them materially; the new terms then apply from the start of the next subscription term unless the clinic agrees
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
          The agreement and any dispute about it are governed by the law of England and Wales, and the courts of England
          and Wales have exclusive jurisdiction.
        </p>
      </LegalPage>
    </LegalFrame>
  );
}
