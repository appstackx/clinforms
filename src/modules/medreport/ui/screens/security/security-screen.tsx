"use client";

/**
 * /reports/security – "Security & data protection": the answer to a clinic's GDPR question, in the
 * product. Phrased honestly: what this demo does (fictional data, browser storage) and what is in place
 * BEFORE any real patient data is used (DPA, DPIA, UK hosting, MFA, server-side audit trail…). The
 * drafting-specific wording comes from core/wording.ts (WORDING.security).
 *
 * Owner: studio-a agent.
 */
import Link from "next/link";
import {
  Building2,
  CheckCircle2,
  Eye,
  FileCheck2,
  History,
  KeyRound,
  Lock,
  Send,
  Server,
  ShieldCheck,
  Trash2,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { PRODUCT } from "../../../config.public";
import { WORDING } from "../../wording";
import { StudioShell } from "../../components/shared/studio-shell";

function Section({ icon: Icon, title, children, id }: { icon: LucideIcon; title: string; children: ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id ? `${id}-h` : undefined} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={id ? `${id}-h` : undefined} className="text-base font-semibold text-slate-900">
            {title}
          </h2>
          <div className="mt-2 space-y-2 text-sm leading-relaxed text-slate-700">{children}</div>
        </div>
      </div>
    </section>
  );
}

function Points({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

const STATUS: Array<{ area: string; demo: string; live: string }> = [
  { area: "Patient data", demo: "Fictional patients only", live: "Real data only after the Data Processing Agreement and the DPIA are signed off with the clinic" },
  { area: "Where reports are kept", demo: "In this browser", live: "UK-hosted database, encrypted at rest (AES-256) and in transit (TLS 1.2+)" },
  { area: "Sign-in", demo: "Demo sessions; launch from the simulated TM3", live: "Clinic accounts with multi-factor authentication and roles; launch from TM3 in the patient's context" },
  { area: "Audit trail", demo: "Kept with each report in this browser", live: "Server-side and append-only: every draft, edit, resolution, approval and filing, with who and when" },
  WORDING.security.statusRow,
  { area: "TM3", demo: "Simulated TM3 sandbox (not affiliated with TM3)", live: "Notes export upload now; a direct connection subject to TM3 providing access" },
];

export function SecurityScreen() {
  return (
    <StudioShell
      title="Security & data protection"
      description={
        <>
          How {PRODUCT.name} protects patient data, and what is in place before any real patient data is used. This demo runs on
          fictional data only.
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Section icon={Building2} title="Who is responsible (UK GDPR)" id="roles">
          <Points
            items={[
              <>The clinic is the <strong>controller</strong> of its patients&apos; data. {PRODUCT.name} acts as a <strong>processor</strong> under a written Data Processing Agreement (UK GDPR Article 28).</>,
              <>A <strong>Data Protection Impact Assessment</strong> is completed with the clinic before go-live – health data is special category data.</>,
              <>{WORDING.security.subProcessors}</>,
              <>A proof of concept uses <strong>anonymised data only</strong>: your own referrers&apos; forms with anonymised notes, before any identifiable patient data is processed.</>,
            ]}
          />
        </Section>

        <Section icon={Send} title={WORDING.security.receivesTitle} id="drafting">
          <Points items={WORDING.security.receivesPoints.map((point) => <>{point}</>)} />
          <p className="text-[13px] text-slate-600">
            {WORDING.security.payloadPointerBefore}
            <strong>{WORDING.security.payloadPointerLink}</strong>
            {WORDING.security.payloadPointerAfter}
          </p>
        </Section>

        <Section icon={FileCheck2} title="Nothing is issued until a clinician approves it" id="approval">
          <Points
            items={[
              <>Every answer cites the note it came from. Anything not in the record is left blank and flagged – opinions are never invented.</>,
              <>Approval needs the clinician&apos;s name, HCPC number and four attestations, and is tied to their sign-in.</>,
              <>The server signs an approval receipt over the exact content and the form&apos;s mapping. A changed answer, or a different mapping, needs approving again.</>,
              <>Only the final file issued for that approval can be saved to the patient&apos;s record.</>,
            ]}
          />
        </Section>

        <Section icon={KeyRound} title="Who can see it" id="access">
          <Points
            items={[
              <>Clinic accounts with multi-factor authentication and roles (clinician, practice manager, admin).</>,
              <>Opened from TM3, a session covers that one patient&apos;s episode and expires after an hour; launch links work once.</>,
              <>Staff see the clinic&apos;s own reports and forms only.</>,
            ]}
          />
        </Section>

        <Section icon={Server} title="Where the data lives" id="hosting">
          <Points
            items={[
              <>UK hosting, encrypted at rest and in transit.</>,
              <>The completed form is filed to the patient&apos;s record in TM3; working copies are kept only as long as the clinic&apos;s retention policy allows.</>,
              <>Uploaded forms and documents are processed with size limits and in an isolated converter without network access.</>,
            ]}
          />
        </Section>

        <Section icon={History} title="Audit trail" id="audit">
          <Points
            items={[
              <>Every draft, edit, gap resolution, approval and filing is recorded with who did it and when.</>,
              <>Resolving a gap says who answered it; nobody can mark an opinion as answered without writing it.</>,
              <>{WORDING.security.draftsLabelled}</>,
            ]}
          />
        </Section>

        <Section icon={Trash2} title="Retention and deletion" id="retention">
          <Points
            items={[
              <>The clinic sets the retention period. Working drafts are deleted after the final form is filed, unless the clinic chooses to keep them.</>,
              <>Data is exported and deleted on request, and at the end of the contract.</>,
            ]}
          />
        </Section>

        <Section icon={UserCheck} title="Your patients' rights" id="rights">
          <Points
            items={[
              <>Access, correction and deletion requests are handled by the clinic as controller, with full support from {PRODUCT.name}.</>,
              <>Disclosure to a referrer follows the consent recorded in the clinic system – the record check flags a missing consent before approval.</>,
            ]}
          />
        </Section>
      </div>

      <section aria-labelledby="status-h" className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-5 py-3">
          <ShieldCheck className="h-4 w-4 text-teal-700" aria-hidden />
          <h2 id="status-h" className="text-sm font-semibold text-slate-900">
            This demo, and what is in place before real patient data
          </h2>
        </div>
        <div className="divide-y divide-slate-100">
          <div className="hidden grid-cols-[180px_1fr_1fr] gap-4 px-5 py-2 text-xs font-medium uppercase tracking-wide text-slate-500 md:grid">
            <span>Area</span>
            <span className="inline-flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" aria-hidden /> In this demo
            </span>
            <span className="inline-flex items-center gap-1">
              <Lock className="h-3.5 w-3.5" aria-hidden /> Before any real patient data
            </span>
          </div>
          {STATUS.map((row) => (
            <div key={row.area} className="grid gap-1 px-5 py-3 text-sm md:grid-cols-[180px_1fr_1fr] md:gap-4">
              <span className="font-medium text-slate-900">{row.area}</span>
              <span className="text-slate-600">
                <span className="font-medium text-slate-500 md:hidden">In this demo: </span>
                {row.demo}
              </span>
              <span className="text-slate-800">
                <span className="font-medium text-slate-500 md:hidden">Before real data: </span>
                {row.live}
              </span>
            </div>
          ))}
        </div>
      </section>

      <p className="mt-6 text-xs text-slate-500">
        Questions about data protection? Ask for the draft Data Processing Agreement and the DPIA template.{" "}
        <Link href="/reports" className="font-medium text-teal-800 underline underline-offset-2 hover:no-underline">
          Back to reports
        </Link>
      </p>
    </StudioShell>
  );
}
