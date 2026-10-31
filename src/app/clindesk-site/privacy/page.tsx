import { Fill } from "@/components/clindesk/fill";
import { LegalFrame } from "@/components/clindesk/legal-frame";
import { LegalPage, LegalTable } from "@/components/marketing/legal-page";
import { CLINFORMS_NAME, CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { CLINDESK_LEGAL_LAST_UPDATED, CONTACT_EMAIL, clindeskMetadata } from "@/lib/clindesk/site";
import { COMPANY } from "@/lib/site";

/**
 * /privacy on clindesk.co.uk – ClinDesk's own privacy policy, adapted from ClinForms' (src/app/(marketing)/privacy,
 * unchanged) for the clinic system. Every data category and service provider below is taken from the code:
 * - patient data: the clinic-system tables (src/server/db/pms-schema/*), free text encrypted per clinic
 *   (src/server/repos/pms/context.ts, src/server/crypto/envelope.ts);
 * - service email: src/server/email/providers.ts; patient email and text messages: src/server/pms/comms/providers
 *   (no live provider in this build – outbox only); card payments: src/server/pms/billing/payments (test mode only,
 *   off by default); human check: src/server/pms/portal/human-check.ts (off until its keys are set);
 * - the Reports add-on's drafting service: ClinForms' own (src/modules/medreport);
 * - no analytics and no demo video on this brand's hosts (src/lib/brand.ts analytics: false).
 * Open points are fill-ins (content/clindesk-site.json), shown as "[to confirm]" until Khuram fills them in.
 */
export const metadata = clindeskMetadata({
  path: "/privacy",
  title: `Privacy policy – ${CLINIC_SYSTEM_NAME}`,
  description: `How ${COMPANY.legalName} handles personal data for the ${CLINIC_SYSTEM_NAME} website, clinic user accounts and the patient information clinics keep in ${CLINIC_SYSTEM_NAME}.`,
});

export default function ClindeskPrivacyPage() {
  const email = CONTACT_EMAIL;
  return (
    <LegalFrame>
      <LegalPage
        title="Privacy policy"
        lastUpdated={CLINDESK_LEGAL_LAST_UPDATED}
        intro={
          <p>
            This policy explains how {COMPANY.legalName} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) uses personal data in
            connection with {CLINIC_SYSTEM_NAME}: when you visit this website, when you book a demo, when you use{" "}
            {CLINIC_SYSTEM_NAME} as a member of a clinic, and when a clinic uses {CLINIC_SYSTEM_NAME} to run its diary,
            patient records, billing, patient portal and messages.
          </p>
        }
      >
        <h2 id="who-we-are">1. Who we are</h2>
        <p>
          {CLINIC_SYSTEM_NAME} is a product of {COMPANY.legalName}, company number <Fill k="company.number" />, registered
          office <Fill k="company.registeredOffice" />. You can contact us about anything in this policy at{" "}
          <a href={`mailto:${email}`}>{email}</a>.
        </p>
        <p>
          ICO registration: <Fill k="security.icoRegistration" />.
        </p>

        <h2 id="our-roles">2. Our two roles</h2>
        <ul>
          <li>
            <strong>Controller</strong> for the personal data of website visitors, people who book a demo, and the users
            of clinic accounts (for example their names, work emails and sign-in records). We decide how and why this
            data is used, as described below.
          </li>
          <li>
            <strong>Processor</strong> for the information a clinic keeps in {CLINIC_SYSTEM_NAME} about its patients and
            the people it works with (section 4). The clinic is the controller. We process this information only on the
            clinic&rsquo;s documented instructions, under a data processing agreement (DPA) made under Article 28 of the
            UK GDPR, and only to provide the service to that clinic.
          </li>
        </ul>
        <p>
          If you are a patient of a clinic that uses {CLINIC_SYSTEM_NAME} – including if you book online, sign in to the
          clinic&rsquo;s patient portal or receive messages from the clinic – please contact your clinic about your
          information: it decides how your data is used and will deal with your request. We will help the clinic respond.
        </p>

        <h2 id="what-we-collect">3. Personal data we control, and why</h2>
        <LegalTable
          label="Personal data we control"
          columns={["What", "Why we use it", "Lawful basis", "How long we keep it"]}
          rows={[
            [
              <>
                <strong>Website visits:</strong> technical records of requests (IP address, browser type, the page
                requested, time)
              </>,
              "To deliver the website, keep it secure and investigate faults or misuse",
              "Legitimate interests (running a secure website)",
              "A limited period kept by our hosting provider for security and troubleshooting, then deleted",
            ],
            [
              <>
                <strong>Demo requests:</strong> your name, clinic or group name, work email, phone number (optional),
                number of sites and practitioners, your current system (optional) and what you would like to see
              </>,
              `To reply to you, arrange a demo and discuss setting up ${CLINIC_SYSTEM_NAME} for your clinic`,
              "Legitimate interests (responding to enquiries) and steps taken at your request before a contract",
              <>
                <Fill k="legal.demoRequestRetention" />
              </>,
            ],
            [
              <>
                <strong>Clinic user accounts:</strong> name, work email, role, the sites and permissions you are given,
                job title and professional registration number (where the clinic records them), password (stored only as a
                one-way hash), two-step verification settings, sign-in sessions (including IP address and browser), and a
                record of account and security actions (such as sign-ins and changes to roles)
              </>,
              "To provide the service to your clinic, keep accounts secure, show who did what in the record, and meet our obligations to the clinic",
              "Performance of our contract with your clinic, and legitimate interests (security and accountability)",
              <>
                While your clinic&rsquo;s account is active; after it closes: <Fill k="legal.accountRetention" />. A record
                the clinic&rsquo;s instructions or the law require (such as who signed a clinical note) may be kept for
                longer.
              </>,
            ],
            [
              <>
                <strong>Service emails:</strong> invitations, password resets and security notices to clinic users
              </>,
              "To operate your account",
              "Performance of our contract with your clinic",
              "Email delivery records are kept for a limited period by our email provider",
            ],
          ]}
        />
        <p>
          We do not sell personal data, we do not use it for advertising, and we do not make decisions about anyone based
          solely on automated processing that have legal or similarly significant effects. This website uses no analytics.
        </p>

        <h2 id="clinic-data">4. Information we process for clinics</h2>
        <p>When a clinic uses {CLINIC_SYSTEM_NAME}, we process this information as its processor:</p>
        <ul>
          <li>
            <strong>Patients:</strong> identification and contact details (name, date of birth, sex, address, phone
            numbers, email), occupation and employer, emergency contact, GP details, consent records and contact
            preferences (including for reminders and any marketing).
          </li>
          <li>
            <strong>Appointments:</strong> the diary, attendance, waiting lists and online bookings.
          </li>
          <li>
            <strong>Clinical records</strong> (health data, a special category under the UK GDPR): clinical notes and
            their amendments, body charts, outcome measures, clinical alerts, letters, documents and attachments.
          </li>
          <li>
            <strong>Cases and referrals:</strong> referrers, insurers and solicitors and their contact details, claim and
            authorisation references, and the sessions authorised.
          </li>
          <li>
            <strong>Billing:</strong> invoices, credit notes, payments and claims files for insurers. For a saved card we
            keep only the payment provider&rsquo;s reference, the card brand, the last four digits and the expiry date –
            never the full card number.
          </li>
          <li>
            <strong>Patient portal:</strong> portal accounts and sessions, sign-in links (stored only as a one-way hash),
            questionnaires and forms patients complete, and documents the clinic shares with them.
          </li>
          <li>
            <strong>Messages:</strong> the emails and text messages the clinic sends to patients and payers (such as
            reminders, sign-in links, invoices and payment links), their delivery status and replies.
          </li>
          <li>
            <strong>Staff and set-up:</strong> practitioners, rotas and availability, sites, rooms, services and prices.
          </li>
          <li>
            <strong>Audit trail:</strong> a record of who changed what and when, kept for{" "}
            <Fill k="security.auditRetention" />.
          </li>
          <li>
            <strong>Imports:</strong> records the clinic brings across from its previous system.
          </li>
          <li>
            <strong>Referrer reports</strong> (only for clinics with the Reports add-on, powered by {CLINFORMS_NAME}): the
            completed referrer forms, drafted from the clinic&rsquo;s signed notes.
          </li>
        </ul>
        <ul>
          <li>
            <strong>Purpose:</strong> to provide {CLINIC_SYSTEM_NAME} to the clinic, and nothing else. This information is
            never used for marketing by us, never sold and never combined with other clinics&rsquo; data. Reports are
            built only from the clinic&rsquo;s own data.
          </li>
          <li>
            <strong>Security:</strong> free-text fields, such as clinical notes, are encrypted at rest with a key specific
            to each clinic, and every member sees only what their role and sites allow. See{" "}
            <a href="/security">Security and data</a>.
          </li>
          <li>
            <strong>Retention:</strong> the clinic decides how long its records are kept, in line with{" "}
            <Fill k="security.retentionGuidance" />. Clinical records are never deleted automatically. Backups are kept for{" "}
            <Fill k="security.backupRetention" />. When the clinic&rsquo;s agreement ends, all of its data is returned or
            deleted, as the DPA sets out.
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
            <strong>Database and file storage</strong> – stores clinic data, with free text encrypted at rest (stored in{" "}
            <Fill k="security.region" />
            ).
          </li>
          <li>
            <strong>Email delivery</strong> – sends invitations, password resets and security notices to clinic users.
          </li>
          <li>
            <strong>Patient messaging</strong> (only where switched on) – sends the emails and text messages the clinic
            chooses to send to patients and payers. Until it is switched on, messages stay in the clinic&rsquo;s outbox and
            are not sent.
          </li>
          <li>
            <strong>Card payments</strong> (only where the clinic switches them on) – takes card payments for invoices
            through payment links or a saved card. Card details are entered with the provider, never in{" "}
            {CLINIC_SYSTEM_NAME}.
          </li>
          <li>
            <strong>Human check</strong> (only where switched on) – checks that a person, not an automated program, is
            using a clinic&rsquo;s online booking page or patient portal sign-in. It receives technical details from the
            visitor&rsquo;s browser and no clinic data.
          </li>
          <li>
            <strong>Drafting service</strong> (only for clinics with the Reports add-on) – receives minimised extracts of
            signed notes to draft answers for the clinician to review. It may not use clinic data to develop or improve its
            own services.
          </li>
        </ul>
        <p>
          The full list of sub-processors (<Fill k="security.subProcessorsDocument" />
          ), with their locations and the safeguards that apply, is part of our DPA and is available on request at{" "}
          <a href={`mailto:${email}`}>{email}</a>. We tell clinics before we add or replace a sub-processor that handles
          patient information, so they can object.
        </p>

        <h2 id="transfers">6. Where data is stored and international transfers</h2>
        <p>
          The application runs in the UK (London) and clinic data is stored in <Fill k="security.region" />. Where a
          service provider processes personal data outside the UK, we make sure the transfer is protected as the UK GDPR
          requires – for example by UK adequacy regulations, the UK International Data Transfer Agreement or the UK
          Addendum to the EU Standard Contractual Clauses – and we describe these transfers in the DPA.
        </p>
        <p>
          Optional services: <Fill k="legal.providerLocations" />.
        </p>

        <h2 id="rights">7. Your rights</h2>
        <p>Under the UK GDPR you have the right to:</p>
        <ul>
          <li>access the personal data we hold about you and receive a copy;</li>
          <li>have inaccurate data corrected, and incomplete data completed;</li>
          <li>have your data erased, or its use restricted, in certain circumstances;</li>
          <li>object to our use of your data where we rely on legitimate interests;</li>
          <li>receive data you gave us in a portable format, in certain circumstances.</li>
        </ul>
        <p>
          To use any of these rights, email <a href={`mailto:${email}`}>{email}</a>. We will reply within one month, and
          may need to confirm your identity first. For information we process for a clinic, we will pass your request to
          the clinic and help it respond.
        </p>

        <h2 id="complaints">8. Complaints</h2>
        <p>
          If you have a concern, please contact us first and we will try to resolve it. You also have the right to
          complain to the Information Commissioner&rsquo;s Office (ICO), the UK data protection regulator:{" "}
          <a href="https://ico.org.uk/make-a-complaint/" rel="noopener noreferrer">
            ico.org.uk/make-a-complaint
          </a>{" "}
          or 0303 123 1113.
        </p>

        <h2 id="cookies">9. Cookies</h2>
        <p>
          We use only the cookies needed to sign in and to run the features you use – no analytics and no advertising. See
          our <a href="/cookies">cookie policy</a>.
        </p>

        <h2 id="changes">10. Changes to this policy</h2>
        <p>
          We will update this policy when how we use personal data changes, and show the date of the latest version at the
          top. If a change affects clinics materially, we will tell them in advance.
        </p>
      </LegalPage>
    </LegalFrame>
  );
}
