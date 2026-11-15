import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { TrackedLink } from "@/components/analytics/tracked-link";
import { Drawing } from "@/components/clindesk/drawing";
import { HeroIllustration } from "@/components/marketing/hero-illustration";
import { DEMO_HREF, DEMO_VIDEO_HREF, REQUEST_ACCESS_HREF, btn } from "@/components/marketing/nav";
import { BRANDS, CLINIC_SYSTEM_NAME, REPORTS_ADDON_NAME } from "@/lib/brand";
import { COMPANY, SITE_URL } from "@/lib/site";
import { DEMO_VIDEO, formatChapterTime, formatDurationWords } from "@/lib/site/demo-video";
import { PRODUCT } from "@/modules/medreport/config.public";

const TITLE = `${PRODUCT.name} – complete every referrer's own report form from your clinic notes`;
const DESCRIPTION =
  "For UK physiotherapy clinics: ClinForms completes each insurer's, medico-legal company's, solicitor's, case manager's or employer's own report form from your treatment notes, in its original layout, with every answer traceable to its source and approved by your clinician.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    siteName: PRODUCT.name,
    locale: "en_GB",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const REFERRERS = ["Private medical insurers", "Medico-legal companies", "Solicitors", "Case managers", "Employers"] as const;

const BEFORE = [
  "Re-reading weeks of notes to answer each question",
  "Re-typing the same details into every referrer’s layout",
  "Finding a missing detail only after the form has gone",
  "Report writing pushed to the end of a full clinic day",
];

const AFTER = [
  "Answers drafted from the notes, each linked to its source",
  "The referrer’s own form, filled in its original layout",
  "Gaps shown before approval – never guessed",
  "Your clinician reviews and approves instead of starting from a blank page",
];

const STEPS = [
  {
    drawing: "/clinforms/site/step-upload.svg",
    title: "Upload the form once",
    body: "Add the referrer’s Word or PDF form. ClinForms finds each question and the space for its answer, and your team checks that map once. It is reused for every patient that referrer sends.",
  },
  {
    drawing: "/clinforms/site/step-notes.svg",
    title: "Complete it from the notes",
    body: "Choose the patient. Registration details and dates are filled in directly, and each written answer is drafted from the treatment notes with a link to the notes it came from.",
  },
  {
    drawing: "/clinforms/site/step-review.svg",
    title: "Review, fill the gaps, approve",
    body: "The treating clinician checks every answer beside its sources, completes anything the notes do not cover, adds their own opinion and approves. Nothing is final until they do.",
  },
  {
    drawing: "/clinforms/site/step-download.svg",
    title: "Download the referrer’s own form",
    body: "Get the completed form back in the referrer’s own format and original layout – a Word form as Word, a PDF form as PDF – ready to send through your usual channel.",
  },
] as const;

const FEATURES = [
  {
    title: "Every answer traceable",
    body: "Each drafted answer shows the treatment notes it came from, so checking it means reading the source, not searching for it.",
  },
  {
    title: "Gaps flagged, never guessed",
    body: "When the notes do not answer a question, ClinForms says so and leaves it for the clinician instead of filling it in.",
  },
  {
    title: "Opinions stay with the clinician",
    body: "Prognosis, causation and fitness for work only appear when a clinician recorded them, and the clinician confirms them before approval.",
  },
  {
    title: "The original layout, kept",
    body: "The output is the referrer’s own document with the answers written in – not a new report in a different format.",
  },
  {
    title: "Checks before approval",
    body: "Built-in checks flag figures and dates that do not match the notes, and opinion wording that no clinician recorded.",
  },
  {
    title: "Works alongside your clinic system",
    body: "Bring the notes in from an export or a printed notes PDF. Nothing changes in how your clinic records care.",
  },
] as const;

const SECURITY = [
  {
    title: "Clinician approval first",
    body: "No form is final, or can be downloaded as final, until the treating clinician has reviewed and approved it.",
  },
  { title: "Every answer cites its source", body: "Each drafted answer links to the notes it came from." },
  { title: "Two-step verification", body: "Every user signs in with a password and a one-time code from an authenticator app." },
  { title: "Encrypted, stored in the EU", body: "Patient information and form files are encrypted at rest with a key per clinic, and the database is stored in the EU." },
  { title: "Audit trail", body: "Sign-ins and changes to users, roles and access are recorded in a log that cannot be edited." },
  { title: "Data minimisation", body: "Names, dates of birth and contact details are removed before notes are used to draft answers." },
] as const;

const FAQ: Array<{ q: string; a: ReactNode }> = [
  {
    q: "Does ClinForms replace our clinic system?",
    a: (
      <>
        No. ClinForms works alongside your practice-management system. You bring a patient&rsquo;s notes in by uploading an
        export or a printed notes PDF, complete the referrer&rsquo;s form, and keep the approved copy in your own records.
        If you are choosing a new clinic system,{" "}
        <a href={`${BRANDS.clinic.siteUrl}/reports`} className="link" data-testid="family-link">
          {CLINIC_SYSTEM_NAME}
        </a>
        , from the same team, offers ClinForms as its {REPORTS_ADDON_NAME} add-on, so the notes are already in the same
        record and nothing needs uploading.
      </>
    ),
  },
  {
    q: "Which forms does it work with?",
    a: (
      <>
        Word (.docx) forms and fillable PDF forms. PDFs without fillable fields are supported on a best-effort basis, and
        you check the placement in a preview before approving. Scanned paper forms are not supported yet.
      </>
    ),
  },
  {
    q: "Some referrers use an online portal instead of a form. Can it help?",
    a: (
      <>
        Yes. Paste or type the portal&rsquo;s questions once and ClinForms keeps them like any other form. For each
        patient the answers are drafted from the notes with their sources and approved by your clinician; you then copy
        each answer, or all of them at once, into the portal, and download a PDF summary of the questions and approved
        answers for your records.
      </>
    ),
  },
  {
    q: "Who is responsible for what the form says?",
    a: (
      <>
        Your clinician. ClinForms drafts answers from the clinic&rsquo;s own notes and shows where each one came from, but
        every form is reviewed, completed and approved by the treating clinician before it can be downloaded as final.
        ClinForms never sends anything to a referrer on its own.
      </>
    ),
  },
  {
    q: "Where is our data kept?",
    a: (
      <>
        The application runs in London and the database is stored in the EU, encrypted at rest. We act as your processor
        under a data processing agreement. See{" "}
        <Link href="/security" className="link">
          Security
        </Link>{" "}
        and our{" "}
        <Link href="/privacy" className="link">
          privacy policy
        </Link>
        .
      </>
    ),
  },
  {
    q: "How is it priced?",
    a: <>Ask us for a quote that fits the number of sites and forms you handle.</>,
  },
  {
    q: "How do we get started?",
    a: (
      <>
        Request access and tell us which referrers&rsquo; forms you receive most. We set your clinic up once the data
        processing agreement is signed, and invite your team. You can try the public demo, with fictional patients, at any
        time.
      </>
    ),
  },
];

/** Structured data: what the product is and who provides it (no prices, ratings or claims). */
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: PRODUCT.name,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: SITE_URL,
  description: DESCRIPTION,
  provider: { "@type": "Organization", name: COMPANY.legalName, url: COMPANY.website, email: COMPANY.contactEmail },
};

/** A section's opening: the handwritten marker, the title and an optional intro (the shared site type: .pen, .display-l). */
function SectionHead({ marker, title, intro, id }: { marker: string; title: ReactNode; intro?: ReactNode; id: string }) {
  return (
    <div className="cf-head">
      <p className="pen marker">{marker}</p>
      <h2 className="display-l" id={id}>
        {title}
      </h2>
      {intro ? <p className="lead">{intro}</p> : null}
    </div>
  );
}

/** The demo video's length after "Watch the demo": "1:30" on screen, "1 minute 30 seconds" to a screen reader. */
function DemoLength() {
  return (
    <span className="cf-length">
      <span aria-hidden>{formatChapterTime(DEMO_VIDEO.durationSeconds)}</span>
      <span className="vh">, {formatDurationWords(DEMO_VIDEO.durationSeconds)}</span>
    </span>
  );
}

/** The round play mark in front of "Watch the demo" (the shared site's tour-link dot). */
function PlayDot() {
  return (
    <span className="tour-link-dot" aria-hidden="true">
      <svg viewBox="0 0 12 12">
        <path d="M2 1 L11 6 L2 11 Z" />
      </svg>
    </span>
  );
}

/** A coral tick for the "with ClinForms" list. */
function Tick() {
  return (
    <svg className="cf-tick" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10.5 L8.2 14.5 L16 5.5" />
    </svg>
  );
}

export default function LandingPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />

      {/* Hero */}
      <section aria-labelledby="hero-title" className="cf-hero">
        <div className="wrap cf-hero-inner">
          <div className="cf-hero-copy">
            <p className="cf-kicker">
              <span className="tb tb--teal" aria-hidden="true" />
              For UK physiotherapy clinics
            </p>
            <h1 id="hero-title" className="display-xl cf-h1">
              Every referrer&rsquo;s own form, completed from your{" "}
              <span className="hl">
                clinic notes
                <span className="tape tape--sun hl-tape" aria-hidden="true" />
              </span>
            </h1>
            <p className="lead">
              Insurers, medico-legal companies, solicitors and employers each send their own report form. ClinForms
              completes it in its original layout from your treatment notes, shows the source behind every answer, and
              waits for your clinician to review and approve.
            </p>
            <div className="hero-ctas">
              <Link href={REQUEST_ACCESS_HREF} className={btn.primary}>
                Request access <span className="arr" aria-hidden="true">→</span>
              </Link>
              <Link href={DEMO_VIDEO_HREF} className={btn.secondary}>
                <PlayDot /> Watch the demo <DemoLength />
              </Link>
            </div>
            <p className="small muted">
              Or{" "}
              <TrackedLink href={DEMO_HREF} prefetch={false} className="link" event="demo_opened" eventProps={{ area: "marketing", cta: "hero" }}>
                try the interactive demo
              </TrackedLink>{" "}
              with fictional patients. No sign-up needed.
            </p>
          </div>
          <div className="cf-hero-art">
            <div className="cf-hero-plane" aria-hidden="true" />
            <div className="cf-hero-drawing deco" aria-hidden="true">
              <Drawing src="/clinforms/site/referrer-post.svg" width={640} height={440} decoding="async" />
            </div>
            <HeroIllustration />
          </div>
        </div>
      </section>

      {/* Who sends forms */}
      <section aria-labelledby="referrers-title" className="cf-referrers g-pine on-dark">
        <div className="wrap cf-referrers-inner">
          <h2 id="referrers-title" className="label cf-referrers-title">
            One way to handle the forms that arrive from
          </h2>
          <ul className="cf-ref-list">
            {REFERRERS.map((label, i) => (
              <li key={label}>
                <span className={`tb ${i % 2 ? "tb--sage" : "tb--sun"}`} aria-hidden="true" />
                {label}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Time saved */}
      <section aria-labelledby="why-title" className="cf-section g-couch">
        <div className="wrap cf-why">
          <SectionHead
            id="why-title"
            marker="Why clinics use it"
            title="Less copying. More clinical judgement."
            intro="Your clinicians already know the patient. ClinForms takes over the searching, copying and formatting, so their time goes on checking and on the opinion only they can give."
          />
          <div className="cf-compare">
            <div className="cf-card cf-card--before">
              <h3 className="cf-card-title">Without ClinForms</h3>
              <ul>
                {BEFORE.map((item) => (
                  <li key={item}>
                    <span className="cf-dash" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="cf-card cf-card--after">
              <span className="tape tape--teal cf-card-tape" aria-hidden="true" />
              <h3 className="cf-card-title">With ClinForms</h3>
              <ul>
                {AFTER.map((item) => (
                  <li key={item}>
                    <Tick />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" aria-labelledby="how-title" className="cf-section g-sky">
        <div className="wrap">
          <SectionHead
            id="how-title"
            marker="How it works"
            title="From the referrer’s form to an approved copy"
            intro="Set up each referrer’s form once. After that, every patient takes the same four steps."
          />
          <ol className="cf-steps">
            {STEPS.map(({ drawing, title, body }, i) => (
              <li key={title} className="cf-step">
                <div className={`cf-step-art cf-step-art--${i + 1}`} aria-hidden="true">
                  <Drawing src={drawing} width={280} height={200} decoding="async" loading="lazy" />
                </div>
                <p className="cf-step-n">
                  <span className="n" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="label">Step {i + 1}</span>
                </p>
                <h3 className="cf-step-title">{title}</h3>
                <p className="cf-step-body">{body}</p>
              </li>
            ))}
          </ol>
          <div className="cf-center">
            <TrackedLink href={DEMO_HREF} prefetch={false} className={btn.secondary} event="demo_opened" eventProps={{ area: "marketing", cta: "how_it_works" }}>
              See it in the demo <span className="arr" aria-hidden="true">→</span>
            </TrackedLink>
          </div>
        </div>
      </section>

      {/* Features */}
      <section aria-labelledby="features-title" className="cf-section g-couch">
        <div className="wrap">
          <SectionHead id="features-title" marker="Built for checking" title="Made for the way reports are reviewed" />
          <ul className="cf-features">
            {FEATURES.map(({ title, body }, i) => (
              <li key={title}>
                <span className={`tb ${["", "tb--sun", "tb--teal"][i % 3]}`} aria-hidden="true" />
                <h3 className="cf-feature-title">{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Security */}
      <section id="security" aria-labelledby="security-title" className="cf-section cf-security g-pine on-dark">
        <div className="wrap cf-security-inner">
          <div className="cf-security-text">
            <p className="label cf-on-dark-label">Security and data protection</p>
            <h2 id="security-title" className="display-l">
              Patient information handled with care
            </h2>
            <p className="body">
              Under UK GDPR your clinic is the controller of its patients&rsquo; data and we act as your processor, under a
              data processing agreement.
            </p>
            <ul className="cf-security-list">
              {SECURITY.map(({ title, body }) => (
                <li key={title}>
                  <span className="tb tb--sage" aria-hidden="true" />
                  <div>
                    <h3 className="cf-security-title">{title}</h3>
                    <p>{body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <Link href="/security" className="link">
              Read about security <span className="arr" aria-hidden="true">→</span>
            </Link>
          </div>
          <div className="cf-security-art deco" aria-hidden="true">
            <span className="tape tape--sun cf-print-tape" />
            <Drawing src="/clinforms/site/padlock-file.svg" width={320} height={280} decoding="async" loading="lazy" />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section aria-labelledby="faq-title" className="cf-section g-couch">
        <div className="wrap cf-faq-wrap">
          <SectionHead id="faq-title" marker="Questions" title="Frequently asked questions" />
          <div className="cf-faq">
            {FAQ.map(({ q, a }) => (
              <details key={q}>
                <summary>
                  {q}
                  <span className="cf-faq-plus" aria-hidden>
                    +
                  </span>
                </summary>
                <p className="body">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final call to action */}
      <section aria-labelledby="cta-title" className="cta g-coral">
        <div className="wrap grid12 cta-inner">
          <div className="cta-text">
            <h2 id="cta-title" className="display-xl">
              Spend clinic time on patients, not paperwork
            </h2>
            <p className="cta-line">Tell us which referrers&rsquo; forms your clinic receives most, or see the demo first.</p>
            <div className="hero-ctas">
              <Link href={REQUEST_ACCESS_HREF} className={btn.dark}>
                Request access <span className="arr" aria-hidden="true">→</span>
              </Link>
              <Link href={DEMO_VIDEO_HREF} className={`${btn.secondary} cf-btn-light`}>
                <PlayDot /> Watch the demo <DemoLength />
              </Link>
            </div>
            <p className="cta-q">
              Or{" "}
              <TrackedLink href={DEMO_HREF} prefetch={false} className="link" event="demo_opened" eventProps={{ area: "marketing", cta: "final" }}>
                try the interactive demo
              </TrackedLink>{" "}
              with fictional patients. No sign-up needed.
            </p>
          </div>
          <div className="cta-card">
            <div className="appt cf-slip">
              <p className="label appt-label">Getting started</p>
              <p className="display-m appt-title">{PRODUCT.name} set-up</p>
              <dl className="appt-rows">
                <div>
                  <dt className="label">Call</dt>
                  <dd className="pen">15 minutes, arranged by email</dd>
                </div>
                <div>
                  <dt className="label">Bring</dt>
                  <dd className="pen">the forms you get most</dd>
                </div>
                <div>
                  <dt className="label">Then</dt>
                  <dd className="pen">agreement signed, team invited</dd>
                </div>
              </dl>
              <Link href={REQUEST_ACCESS_HREF} className={`${btn.dark} appt-btn`}>
                Request access <span className="arr" aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
