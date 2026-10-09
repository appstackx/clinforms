import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { CircleDashed, CheckCircle2 } from "lucide-react";
import { LegalPage } from "@/components/marketing/legal-page";
import { COMPANY, LEGAL_LAST_UPDATED } from "@/lib/site";
import { PRODUCT } from "@/modules/medreport/config.public";

const DESCRIPTION = `How ${PRODUCT.name} protects clinic and patient information: clinician approval, traceable answers, two-step verification, encryption, EU storage, audit trail and data minimisation.`;

export const metadata: Metadata = {
  title: "Security",
  description: DESCRIPTION,
  alternates: { canonical: "/security" },
  openGraph: { title: `Security · ${PRODUCT.name}`, description: DESCRIPTION, url: "/security", siteName: PRODUCT.name, locale: "en_GB", type: "website" },
};

interface Measure {
  title: string;
  body: ReactNode;
}

const IN_PLACE: Array<{ heading: string; items: Measure[] }> = [
  {
    heading: "Clinical safety by design",
    items: [
      {
        title: "Clinician approval before anything leaves",
        body: "A form can only be downloaded as final after the treating clinician has reviewed and approved it. The approval is recorded against the exact content approved, so any later change needs a new approval.",
      },
      {
        title: "Every answer cites its source",
        body: "Each drafted answer links to the treatment notes it came from, so the clinician can check it against the record.",
      },
      {
        title: "Gaps are flagged, not guessed",
        body: "When the notes do not answer a question, the answer is left for the clinician and clearly marked. Opinions such as prognosis or fitness for work are only included when a clinician recorded them.",
      },
      {
        title: "Checks before approval",
        body: "Built-in checks flag figures and dates that do not match the record and opinion wording that no clinician recorded.",
      },
    ],
  },
  {
    heading: "Access",
    items: [
      {
        title: "Two-step verification for every user",
        body: "Users sign in with a password and a one-time code from an authenticator app. Patient information is not available until two-step verification is set up.",
      },
      {
        title: "Invitation only, with roles",
        body: "Clinics are set up by us after the data processing agreement is signed. The clinic decides who is invited and what each person can do (owner, administrator, clinician, staff).",
      },
      {
        title: "Separate clinics",
        body: "Every request is checked against the signed-in user's clinic, so one clinic can never see another clinic's records.",
      },
    ],
  },
  {
    heading: "Data protection",
    items: [
      {
        title: "Encrypted in transit and at rest",
        body: "All connections use HTTPS. Patient information and form files are encrypted in the database (AES-256-GCM) with a key specific to each clinic.",
      },
      {
        title: "UK application, EU storage",
        body: "The application runs in London and the database is stored in the EU.",
      },
      {
        title: "Data minimisation",
        body: "Before treatment notes are used to draft answers, names, dates of birth, addresses and contact details are removed. The clinic can see exactly what is sent.",
      },
      {
        title: "Audit trail",
        body: "Sign-ins, two-step verification changes, and changes to users, roles, clinic details and access keys are recorded in a log that cannot be edited or deleted. The log never contains patient information.",
      },
    ],
  },
  {
    heading: "Accountability",
    items: [
      {
        title: "UK GDPR processor under a DPA",
        body: "Your clinic is the controller of its patients' data and we are its processor, under a data processing agreement that lists our sub-processors, their locations and the safeguards that apply.",
      },
      {
        title: "A public demo with fictional data only",
        body: "Anyone can try the demo without signing up. It uses fictional patients only and keeps its records in the visitor's browser.",
      },
    ],
  },
];

const PLANNED: Measure[] = [
  {
    title: "Automatic deletion",
    body: "Completed reports deleted automatically after the retention period the clinic sets. Clinic administrators can already choose the period; automatic deletion follows with server-side report storage.",
  },
  { title: "Approvals and final downloads in the audit trail", body: "Recording each approval and final download in the same tamper-proof log." },
  { title: "Cyber Essentials certification", body: "We will publish the certificate here once it is awarded." },
  { title: "Independent penetration test", body: "Before wider availability; a summary will be available to customers on request." },
  { title: "Database hosting in the UK", body: "Moving the database to a UK (London) region." },
  { title: "Stricter browser security policy", body: "Enforcing the Content Security Policy that currently runs in report-only mode." },
  { title: "Direct connections to clinic systems", body: "Connecting to practice-management systems, so notes no longer need to be exported and uploaded." },
];

function slug(text: string): string {
  return `sec-${text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function MeasureList({ items, planned = false }: { items: Measure[]; planned?: boolean }) {
  return (
    <ul className="!mt-5 !list-none !space-y-0 !pl-0 divide-y divide-slate-200 rounded-2xl border border-slate-200">
      {items.map((item) => (
        <li key={item.title} className="flex gap-3 p-4 sm:p-5">
          {planned ? (
            <CircleDashed className="mt-1 h-5 w-5 shrink-0 text-slate-500" aria-hidden />
          ) : (
            <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-teal-700" aria-hidden />
          )}
          <div>
            <h3 className="!mt-0 flex flex-wrap items-center gap-2">
              {item.title}
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${planned ? "bg-slate-100 text-slate-700" : "bg-teal-50 text-teal-800"}`}
              >
                {planned ? "Planned" : "In place"}
              </span>
            </h3>
            <p className="!mt-1">{item.body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function SecurityPage() {
  const email = COMPANY.contactEmail;
  return (
    <LegalPage
      title="Security and data protection"
      lastUpdated={LEGAL_LAST_UPDATED}
      intro={
        <p>
          {PRODUCT.name} handles health information, so we keep this page factual: each measure is marked{" "}
          <strong>In place</strong> or <strong>Planned</strong>. We do not hold any security certification yet.
        </p>
      }
    >
      {IN_PLACE.map((group) => (
        <section key={group.heading} aria-labelledby={slug(group.heading)}>
          <h2 id={slug(group.heading)}>{group.heading}</h2>
          <MeasureList items={group.items} />
        </section>
      ))}

      <section aria-labelledby="sec-planned">
        <h2 id="sec-planned">Planned</h2>
        <MeasureList items={PLANNED} planned />
      </section>

      <h2 id="documents">Documents</h2>
      <p>
        Our data processing agreement, the list of sub-processors and answers to security questionnaires are available to
        clinics on request. See also our <Link href="/privacy">privacy policy</Link>.
      </p>

      <h2 id="report">Reporting a security issue</h2>
      <p>
        If you think you have found a security problem, email <a href={`mailto:${email}`}>{email}</a> with the details. Please
        do not access other people&rsquo;s data or disrupt the service while investigating. We will acknowledge your
        report and keep you informed.
      </p>
    </LegalPage>
  );
}
