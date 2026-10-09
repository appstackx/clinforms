import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  Briefcase,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileStack,
  FileText,
  Gavel,
  History,
  KeyRound,
  ListChecks,
  Link2,
  Lock,
  Scale,
  ShieldCheck,
  SearchCheck,
  Stethoscope,
  Upload,
  UserCheck,
  Users,
  EyeOff,
  CircleAlert,
} from "lucide-react";
import { TrackedLink } from "@/components/analytics/tracked-link";
import { HeroIllustration } from "@/components/marketing/hero-illustration";
import { DEMO_HREF, REQUEST_ACCESS_HREF, btn } from "@/components/marketing/nav";
import { COMPANY, SITE_URL } from "@/lib/site";
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

const REFERRERS = [
  { icon: ShieldCheck, label: "Private medical insurers" },
  { icon: Scale, label: "Medico-legal companies" },
  { icon: Gavel, label: "Solicitors" },
  { icon: Users, label: "Case managers" },
  { icon: Briefcase, label: "Employers" },
] as const;

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
    icon: Upload,
    title: "Upload the form once",
    body: "Add the referrer’s Word or PDF form. ClinForms finds each question and the space for its answer, and your team checks that map once. It is reused for every patient that referrer sends.",
  },
  {
    icon: FileText,
    title: "Complete it from the notes",
    body: "Choose the patient. Registration details and dates are filled in directly, and each written answer is drafted from the treatment notes with a link to the notes it came from.",
  },
  {
    icon: UserCheck,
    title: "Review, fill the gaps, approve",
    body: "The treating clinician checks every answer beside its sources, completes anything the notes do not cover, adds their own opinion and approves. Nothing is final until they do.",
  },
  {
    icon: Download,
    title: "Download the referrer’s own form",
    body: "Get the completed Word or PDF file in the referrer’s original layout, ready to send through your usual channel.",
  },
] as const;

const FEATURES = [
  {
    icon: SearchCheck,
    title: "Every answer traceable",
    body: "Each drafted answer shows the treatment notes it came from, so checking it means reading the source, not searching for it.",
  },
  {
    icon: CircleAlert,
    title: "Gaps flagged, never guessed",
    body: "When the notes do not answer a question, ClinForms says so and leaves it for the clinician instead of filling it in.",
  },
  {
    icon: Stethoscope,
    title: "Opinions stay with the clinician",
    body: "Prognosis, causation and fitness for work only appear when a clinician recorded them, and the clinician confirms them before approval.",
  },
  {
    icon: FileStack,
    title: "The original layout, kept",
    body: "The output is the referrer’s own document with the answers written in – not a new report in a different format.",
  },
  {
    icon: ListChecks,
    title: "Checks before approval",
    body: "Built-in checks flag figures and dates that do not match the notes, and opinion wording that no clinician recorded.",
  },
  {
    icon: Link2,
    title: "Works alongside your clinic system",
    body: "Bring the notes in from an export or a printed notes PDF. Nothing changes in how your clinic records care.",
  },
] as const;

const SECURITY = [
  {
    icon: ClipboardCheck,
    title: "Clinician approval first",
    body: "No form is final, or can be downloaded as final, until the treating clinician has reviewed and approved it.",
  },
  { icon: SearchCheck, title: "Every answer cites its source", body: "Each drafted answer links to the notes it came from." },
  { icon: KeyRound, title: "Two-step verification", body: "Every user signs in with a password and a one-time code from an authenticator app." },
  { icon: Lock, title: "Encrypted, stored in the EU", body: "Clinic data is encrypted at rest with a key per clinic, and the database is stored in the EU." },
  { icon: History, title: "Audit trail", body: "Sign-ins and changes to users, roles and access are recorded in a log that cannot be edited." },
  { icon: EyeOff, title: "Data minimisation", body: "Names, dates of birth and contact details are removed before notes are used to draft answers." },
] as const;

const FAQ: Array<{ q: string; a: ReactNode }> = [
  {
    q: "Does ClinForms replace our clinic system?",
    a: (
      <>
        No. ClinForms works alongside your practice-management system. You bring a patient&rsquo;s notes in by uploading an
        export or a printed notes PDF, complete the referrer&rsquo;s form, and keep the approved copy in your own records.
        Direct connections to clinic systems are planned.
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
        Not yet. ClinForms completes referrers&rsquo; own Word and PDF forms. Help with online portals is something we
        are looking at &ndash; tell us which portals you use.
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
        <Link href="/security" className="font-medium text-teal-800 underline underline-offset-2">
          Security
        </Link>{" "}
        and our{" "}
        <Link href="/privacy" className="font-medium text-teal-800 underline underline-offset-2">
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

function SectionHeading({ eyebrow, title, intro, id }: { eyebrow: string; title: string; intro?: ReactNode; id?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-semibold uppercase tracking-wider text-teal-700">{eyebrow}</p>
      <h2 id={id} className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
        {title}
      </h2>
      {intro ? <p className="mt-4 text-lg leading-8 text-slate-600">{intro}</p> : null}
    </div>
  );
}

export default function LandingPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />

      {/* Hero */}
      <section aria-labelledby="hero-title" className="relative overflow-hidden bg-gradient-to-b from-teal-50/70 via-white to-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:px-8 lg:pb-24 lg:pt-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-white px-3 py-1 text-sm font-medium text-teal-800">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-600" aria-hidden />
              For UK physiotherapy clinics
            </p>
            <h1 id="hero-title" className="mt-5 text-4xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-5xl lg:text-[3.4rem] lg:leading-[1.08]">
              Every referrer&rsquo;s own form, completed from your clinic notes
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">
              Insurers, medico-legal companies, solicitors and employers each send their own report form. ClinForms
              completes it in its original layout from your treatment notes, shows the source behind every answer, and
              waits for your clinician to review and approve.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href={REQUEST_ACCESS_HREF} className={btn.primary}>
                Request access
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <TrackedLink href={DEMO_HREF} prefetch={false} className={btn.secondary} event="demo_opened" eventProps={{ area: "marketing", cta: "hero" }}>
                Try the demo
              </TrackedLink>
            </div>
            <p className="mt-4 text-sm text-slate-600">The demo uses fictional patients only. No sign-up needed.</p>
          </div>
          <HeroIllustration />
        </div>
      </section>

      {/* Who sends forms */}
      <section aria-labelledby="referrers-title" className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
          <h2 id="referrers-title" className="text-center text-sm font-semibold text-slate-700">
            One way to handle the forms that arrive from
          </h2>
          <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {REFERRERS.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800">
                <Icon className="h-5 w-5 shrink-0 text-teal-700" aria-hidden />
                {label}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Time saved */}
      <section aria-labelledby="why-title" className="bg-white">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
          <SectionHeading
            id="why-title"
            eyebrow="Why clinics use it"
            title="Less copying. More clinical judgement."
            intro="Your clinicians already know the patient. ClinForms takes over the searching, copying and formatting, so their time goes on checking and on the opinion only they can give."
          />
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 sm:p-8">
              <h3 className="text-base font-semibold text-slate-900">Without ClinForms</h3>
              <ul className="mt-4 space-y-3">
                {BEFORE.map((item) => (
                  <li key={item} className="flex gap-3 text-slate-700">
                    <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-teal-200 bg-teal-50/60 p-6 sm:p-8">
              <h3 className="text-base font-semibold text-slate-900">With ClinForms</h3>
              <ul className="mt-4 space-y-3">
                {AFTER.map((item) => (
                  <li key={item} className="flex gap-3 text-slate-800">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-16 border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
          <SectionHeading
            id="how-title"
            eyebrow="How it works"
            title="From the referrer’s form to an approved copy"
            intro="Set up each referrer’s form once. After that, every patient takes the same four steps."
          />
          <ol className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="relative rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-700 text-white">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="text-sm font-semibold text-teal-800">Step {i + 1}</span>
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-900">{title}</h3>
                <p className="mt-2 text-[15px] leading-7 text-slate-600">{body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-10 text-center">
            <TrackedLink href={DEMO_HREF} prefetch={false} className={btn.secondary} event="demo_opened" eventProps={{ area: "marketing", cta: "how_it_works" }}>
              See it in the demo
              <ArrowRight className="h-4 w-4" aria-hidden />
            </TrackedLink>
          </div>
        </div>
      </section>

      {/* Features */}
      <section aria-labelledby="features-title" className="bg-white">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
          <SectionHeading id="features-title" eyebrow="Built for checking" title="Made for the way reports are reviewed" />
          <ul className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700 ring-1 ring-teal-100">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">{title}</h3>
                  <p className="mt-1.5 text-[15px] leading-7 text-slate-600">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Security */}
      <section id="security" aria-labelledby="security-title" className="scroll-mt-16 bg-slate-900 text-white">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-wider text-teal-300">Security and data protection</p>
            <h2 id="security-title" className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              Patient information handled with care
            </h2>
            <p className="mt-4 text-lg leading-8 text-slate-300">
              Under UK GDPR your clinic is the controller of its patients&rsquo; data and we act as your processor, under a
              data processing agreement.
            </p>
          </div>
          <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SECURITY.map(({ icon: Icon, title, body }) => (
              <li key={title} className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <Icon className="h-6 w-6 text-teal-300" aria-hidden />
                <h3 className="mt-4 text-base font-semibold">{title}</h3>
                <p className="mt-1.5 text-[15px] leading-7 text-slate-300">{body}</p>
              </li>
            ))}
          </ul>
          <div className="mt-10 text-center">
            <Link
              href="/security"
              className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
            >
              Read about security
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section aria-labelledby="faq-title" className="bg-white">
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:px-8">
          <SectionHeading id="faq-title" eyebrow="Questions" title="Frequently asked questions" />
          <div className="mt-10 divide-y divide-slate-200 rounded-2xl border border-slate-200">
            {FAQ.map(({ q, a }) => (
              <details key={q} className="group px-5 py-1 sm:px-6 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-left text-base font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">
                  {q}
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-300 text-slate-600 transition-transform group-open:rotate-45" aria-hidden>
                    +
                  </span>
                </summary>
                <p className="pb-5 text-[15px] leading-7 text-slate-600">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final call to action */}
      <section aria-labelledby="cta-title" className="border-t border-slate-200 bg-gradient-to-b from-white to-teal-50/70">
        <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 lg:px-8">
          <h2 id="cta-title" className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            Spend clinic time on patients, not paperwork
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg leading-8 text-slate-600">
            Tell us which referrers&rsquo; forms your clinic receives most, or explore the demo with fictional patients first.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href={REQUEST_ACCESS_HREF} className={btn.primary}>
              Request access
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <TrackedLink href={DEMO_HREF} prefetch={false} className={btn.secondary} event="demo_opened" eventProps={{ area: "marketing", cta: "final" }}>
              Try the demo
            </TrackedLink>
          </div>
        </div>
      </section>
    </>
  );
}
