"use client";

/**
 * The signed copy on the record (design round 3 "Intake forms – signed copy on the record"): "Signed and sealed. Can't
 * be changed. To update the answers, send a new form."; the answers (clinical ones tagged; for reception they are left
 * out with "N health answers are only shown to clinicians"); the signature panel (typed name, when, from where, form
 * version, the seal's fingerprint); Mark checked; copy chosen details to the patient's record.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Download, Lock, ShieldCheck, Tablet } from "lucide-react";
import { Checkbox, PmsButton, PmsNotice, useToast } from "@/components/pms/ui";
import { STAFF_PORTAL_PATHS } from "@/modules/pms/portal/paths";
import type { AnswerValue, FieldType } from "@/modules/pms/portal/forms";

type Answer = { ok: true; message?: string } | { ok: false; error: string };

export interface SignedFormViewProps {
  patientId: string;
  patientName: string;
  name: string;
  version: number;
  status: string;
  answers: { id: string; q: string; clinical: boolean; value: AnswerValue | null; type: FieldType; hidden: boolean }[];
  hiddenCount: number;
  signature: { name: string; at: string; via: string } | null;
  submittedAt: string | null;
  fingerprint: string | null;
  sealIntact: boolean;
  reviewedAt: string | null;
  appliedAt: string | null;
  updates: { field: string; label: string; value: string }[];
  canApply: boolean;
  /** Completed in the clinic on a clinic device (verified by staff, or waiting for it). */
  inClinic: { words: string; state: "completed" | "verified" | "ended"; href: string } | null;
  pdfHref: string;
  review: () => Promise<Answer>;
  apply: (fields: string[]) => Promise<Answer>;
}

function text(type: FieldType, value: AnswerValue | null): string {
  if (value === null || value === undefined) return "Not answered";
  if (type === "consent") return value === true ? "Yes – agreed" : "Not agreed";
  if (type === "yes_no") return value === "yes" ? "Yes" : "No";
  if (type === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split("-").reverse().join("/");
  if (Array.isArray(value)) return value.join(", ") || "None";
  return String(value);
}

export function SignedFormView(p: SignedFormViewProps) {
  const router = useRouter();
  const toast = useToast();
  const [chosen, setChosen] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<Answer>) => {
    setBusy(key);
    setError(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) setError(r.error);
    else {
      toast.success(r.message ?? "Done.");
      router.refresh();
    }
  };
  const shown = p.answers.filter((a) => !a.hidden);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Breadcrumb" className="text-sm text-[#475569]">
          <Link href={STAFF_PORTAL_PATHS.patientForms(p.patientId)} className="text-primary-strong underline underline-offset-2">
            Forms
          </Link>
          <span aria-hidden> / </span>
          <span>{p.name}</span>
        </nav>
        {p.status === "submitted" ? (
          <a
            href={p.pdfHref}
            className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-border bg-white px-3 text-sm font-medium text-foreground hover:bg-[#F8FAFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Download PDF
          </a>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] p-3 text-sm text-destructive-strong">
          {error}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-label="Signed form" className="min-w-0 rounded-2xl border border-border bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[#BBF7D0] bg-[#F0FDF4] p-3 text-sm text-[#166534]">
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              <span>
                <strong>{p.signature ? "Signed and sealed." : "Completed and sealed."}</strong> Can&apos;t be changed. To update the answers, send a new form.
              </span>
            </span>
            {!p.sealIntact ? <span className="font-semibold text-destructive-strong">The seal does not match – report this.</span> : null}
          </div>
          <dl className="mt-4 divide-y divide-border">
            {shown.map((a) => (
              <div key={a.id} className="grid gap-1 py-2.5 sm:grid-cols-[260px_minmax(0,1fr)]">
                <dt className="text-sm text-[#475569]">
                  {a.q}
                  {a.clinical ? <span className="ml-2 rounded-full bg-[#FEF3C7] px-2 py-0.5 text-xs font-medium text-[#864E0E]">Clinical</span> : null}
                </dt>
                <dd className="whitespace-pre-wrap text-sm text-foreground">{text(a.type, a.value)}</dd>
              </div>
            ))}
          </dl>
          {p.hiddenCount > 0 ? (
            <p className="flex items-center gap-2 border-t border-border py-3 text-sm text-[#475569]">
              <Lock className="h-4 w-4" aria-hidden="true" />
              {p.hiddenCount} health answer{p.hiddenCount === 1 ? " is" : "s are"} only shown to clinicians.
            </p>
          ) : null}
        </section>
        <aside className="flex flex-col gap-4">
          <section aria-labelledby="sig-h" className="rounded-2xl border border-border bg-white p-4">
            <h2 id="sig-h" className="text-base font-semibold text-foreground">
              Signature
            </h2>
            {p.signature ? (
              <>
                <p className="mt-2 font-serif text-2xl italic text-foreground">{p.signature.name}</p>
                <dl className="mt-3 grid grid-cols-[110px_minmax(0,1fr)] gap-y-1.5 text-sm">
                  <dt className="text-[#475569]">Typed name</dt>
                  <dd>{p.signature.name}</dd>
                  <dt className="text-[#475569]">Signed</dt>
                  <dd>{p.signature.at}</dd>
                  <dt className="text-[#475569]">From</dt>
                  <dd>{p.signature.via}</dd>
                  <dt className="text-[#475569]">Form version</dt>
                  <dd>
                    {p.name} v{p.version}
                  </dd>
                  <dt className="text-[#475569]">Fingerprint</dt>
                  <dd className="font-mono text-xs">{p.fingerprint}</dd>
                </dl>
                <p className="mt-2 text-xs text-[#475569]">The fingerprint changes if even one character of the signed form changes.</p>
              </>
            ) : (
              <p className="mt-2 text-sm text-[#475569]">This form has no signature{p.submittedAt ? ` – completed ${p.submittedAt}` : ""}.</p>
            )}
            {p.inClinic ? (
              <p className={`mt-3 flex items-start gap-2 rounded-[8px] p-2 text-sm ${p.inClinic.state === "verified" ? "bg-[#F0FDF4] text-[#166534]" : "bg-[#FFFBEB] text-[#864E0E]"}`}>
                <Tablet className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  {p.inClinic.words}.
                  {p.inClinic.state === "completed" ? (
                    <>
                      {" "}
                      <Link href={p.inClinic.href} className="font-medium underline underline-offset-2">
                        Verify now
                      </Link>
                    </>
                  ) : null}
                </span>
              </p>
            ) : null}
          </section>
          <section aria-labelledby="chk-h" className="rounded-2xl border border-border bg-white p-4">
            <h2 id="chk-h" className="text-base font-semibold text-foreground">
              Checked by the clinic
            </h2>
            {p.reviewedAt ? (
              <p className="mt-2 text-sm text-[#166534]">Checked {p.reviewedAt}.</p>
            ) : (
              <PmsButton className="mt-2" variant="secondary" loading={busy === "review"} onClick={() => void run("review", p.review)}>
                Mark checked
              </PmsButton>
            )}
            {p.appliedAt ? <p className="mt-2 text-sm text-[#475569]">Details copied to the record {p.appliedAt}.</p> : null}
          </section>
          {p.canApply && p.updates.length > 0 ? (
            <section aria-labelledby="apl-h" className="rounded-2xl border border-border bg-white p-4">
              <h2 id="apl-h" className="text-base font-semibold text-foreground">
                Copy to {p.patientName}&apos;s record
              </h2>
              <ul className="mt-2 space-y-2">
                {p.updates.map((u) => (
                  <li key={u.field}>
                    <Checkbox
                      checked={chosen.includes(u.field)}
                      onChange={(e) => setChosen((c) => (e.target.checked ? [...c, u.field] : c.filter((x) => x !== u.field)))}
                      label={`${u.label}: ${u.value}`}
                    />
                  </li>
                ))}
              </ul>
              <PmsNotice tone="info" title="Checked by you" className="mt-2">
                Only the details you tick are copied. Consent to treatment needs a complete signed consent form.
              </PmsNotice>
              <PmsButton className="mt-3" disabled={chosen.length === 0} loading={busy === "apply"} onClick={() => void run("apply", () => p.apply(chosen))}>
                Copy to the record
              </PmsButton>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
