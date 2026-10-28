"use client";

/**
 * A patient's record → Forms: the forms sent to the patient (waiting / completed and sealed), Send a form (by email
 * with a portal link), Send a questionnaire to the patient's portal (outcome measures – clinicians), portal access,
 * and "Complete in the clinic" on a waiting form (this device then shows only that form to the patient; staff verify
 * it afterwards with their password).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ClipboardList, Lock, Tablet } from "lucide-react";
import { PmsButton, PmsNotice, SelectInput, Switch, useToast } from "@/components/pms/ui";
import { STAFF_PORTAL_PATHS } from "@/modules/pms/portal/paths";
import { formatWhen } from "@/modules/pms/portal/time";
import type { IntakeResponseSummary, IntakeTemplate } from "@/modules/pms/portal/types";
import type { OutcomeMeasureId } from "@/modules/pms/records/outcomes";

type Answer = { ok: true; message?: string } | { ok: false; error: string };

export interface PatientFormsViewData {
  responses: IntakeResponseSummary[];
  templates: IntakeTemplate[];
  portal: { enabled: boolean; accountStatus: "active" | "disabled" | "none"; lastSignInAt: string | null };
  hasEmail: boolean;
  canSend: boolean;
  canSendOutcome: boolean;
  measures: { id: OutcomeMeasureId; label: string; problem: string | null }[];
  handoffs: Record<string, { id: string; state: "on_device" | "to_verify" | "verified" | "not_verified" | "expired"; href: string }>;
}

const HANDOFF_WORDS: Record<string, string> = {
  on_device: "On a clinic device now",
  to_verify: "Completed in the clinic – verify",
  verified: "Completed in the clinic, verified",
  not_verified: "Completed in the clinic – not verified",
};

const STATUS: Record<string, string> = { requested: "Waiting for the patient", submitted: "Completed", cancelled: "Withdrawn" };

export function PatientForms({
  patientId,
  view,
  cases,
  canSeeClinical,
  sendForm,
  sendOutcome,
  setPortal,
  startHandoff,
}: {
  patientId: string;
  view: PatientFormsViewData;
  cases: { id: string; title: string }[];
  canSeeClinical: boolean;
  sendForm: (templateId: string) => Promise<Answer>;
  sendOutcome: (measure: string, caseId: string | null) => Promise<Answer>;
  setPortal: (on: boolean) => Promise<Answer>;
  startHandoff: (responseId: string) => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [template, setTemplate] = React.useState(view.templates[0]?.id ?? "");
  const [measure, setMeasure] = React.useState<string>(view.measures.find((m) => !m.problem)?.id ?? "nprs");
  const [caseId, setCaseId] = React.useState(cases[0]?.id ?? "");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<Answer>) => {
    setBusy(key);
    setError(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast.success(r.message ?? "Done.");
    router.refresh();
  };
  const chosenMeasure = view.measures.find((m) => m.id === measure);
  const handOver = async (responseId: string) => {
    setBusy(`hand-${responseId}`);
    setError(null);
    const r = await startHandoff(responseId);
    if (!r.ok) {
      setBusy(null);
      setError(r.error);
      return;
    }
    // This device now shows only the form – the record page is replaced in the history.
    window.location.replace(r.path);
  };

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p role="alert" className="rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] p-3 text-sm text-destructive-strong">
          {error}
        </p>
      ) : null}
      <section aria-labelledby="pf-list" className="rounded-2xl border border-border bg-white p-5">
        <h2 id="pf-list" className="text-base font-semibold text-foreground">
          Forms
        </h2>
        {view.responses.length === 0 ? (
          <p className="mt-2 text-sm text-[#475569]">No forms sent yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {view.responses.map((r) => {
              const clinicalOnly = r.kind === "outcome" && !canSeeClinical;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                  <ClipboardList className="h-5 w-5 shrink-0 text-[#475569]" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    {clinicalOnly || r.status !== "submitted" ? (
                      <span className="font-medium text-foreground">{r.name}</span>
                    ) : (
                      <Link href={STAFF_PORTAL_PATHS.patientResponse(patientId, r.id)} className="font-medium text-primary-strong underline underline-offset-2">
                        {r.name}
                      </Link>
                    )}
                    <span className="block text-xs text-[#475569]">
                      {r.kind === "outcome" ? "Outcome questionnaire · " : `v${r.templateVersion} · `}
                      Sent {formatWhen(r.requestedAt)}
                      {r.submittedAt ? ` · completed ${formatWhen(r.submittedAt)}` : ""}
                      {r.signedAt ? " · signed and sealed" : ""}
                      {r.trust === "unverified" ? " · through the booking link" : ""}
                    </span>
                  </div>
                  <span className={`text-xs font-medium ${r.status === "submitted" ? "text-[#166534]" : "text-[#864E0E]"}`}>{STATUS[r.status]}</span>
                  {r.status === "submitted" && !r.reviewedAt && !clinicalOnly ? <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-xs font-medium text-[#864E0E]">To check</span> : null}
                  {clinicalOnly ? (
                    <span className="inline-flex items-center gap-1 text-xs text-[#475569]">
                      <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Clinicians only
                    </span>
                  ) : null}
                  {view.handoffs[r.id] && HANDOFF_WORDS[view.handoffs[r.id].state] ? (
                    view.canSend && (view.handoffs[r.id].state === "to_verify" || view.handoffs[r.id].state === "on_device") ? (
                      <Link href={view.handoffs[r.id].href} className="rounded-full bg-[#EFF6FF] px-2 py-0.5 text-xs font-medium text-[#1E3A8A] underline-offset-2 hover:underline">
                        {HANDOFF_WORDS[view.handoffs[r.id].state]}
                      </Link>
                    ) : (
                      <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-xs font-medium text-[#334155]">{HANDOFF_WORDS[view.handoffs[r.id].state]}</span>
                    )
                  ) : null}
                  {view.canSend && r.status === "requested" && r.kind !== "outcome" ? (
                    <PmsButton size="sm" variant="secondary" loading={busy === `hand-${r.id}`} onClick={() => void handOver(r.id)} aria-label={`Complete ${r.name} in the clinic on this device`}>
                      <Tablet className="h-4 w-4" aria-hidden="true" />
                      Complete in the clinic
                    </PmsButton>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {view.canSend ? (
        <section aria-labelledby="pf-send" className="rounded-2xl border border-border bg-white p-5">
          <h2 id="pf-send" className="text-base font-semibold text-foreground">
            Send a form
          </h2>
          <p className="mt-1 text-sm text-[#475569]">The patient gets an email with a link to their portal (works once, for 72 hours).</p>
          {!view.portal.enabled ? <PmsNotice tone="warning" title="The patient portal is off" className="mt-3">Switch it on in Set-up → Online booking to send forms.</PmsNotice> : null}
          {!view.hasEmail ? <PmsNotice tone="warning" title="No email address" className="mt-3">Add the patient&apos;s email address to their details first.</PmsNotice> : null}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label htmlFor="pf-template" className="block text-sm font-medium text-foreground">
                Form
              </label>
              <SelectInput id="pf-template" value={template} onChange={(e) => setTemplate(e.target.value)} className="w-64">
                {view.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </SelectInput>
            </div>
            <PmsButton disabled={!template || !view.portal.enabled || !view.hasEmail} loading={busy === "form"} onClick={() => void run("form", () => sendForm(template))}>
              Send form
            </PmsButton>
          </div>
        </section>
      ) : null}

      {view.canSendOutcome ? (
        <section aria-labelledby="pf-outcome" className="rounded-2xl border border-border bg-white p-5">
          <h2 id="pf-outcome" className="text-base font-semibold text-foreground">
            Send a questionnaire to the patient&apos;s portal
          </h2>
          <p className="mt-1 text-sm text-[#475569]">The patient answers on their phone; the score lands in Outcomes. Clinicians only.</p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label htmlFor="pf-measure" className="block text-sm font-medium text-foreground">
                Measure
              </label>
              <SelectInput id="pf-measure" value={measure} onChange={(e) => setMeasure(e.target.value)} className="w-72">
                {view.measures.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </SelectInput>
            </div>
            {cases.length > 0 ? (
              <div className="space-y-1">
                <label htmlFor="pf-case" className="block text-sm font-medium text-foreground">
                  Case
                </label>
                <SelectInput id="pf-case" value={caseId} onChange={(e) => setCaseId(e.target.value)} className="w-56">
                  <option value="">No case</option>
                  {cases.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </SelectInput>
              </div>
            ) : null}
            <PmsButton disabled={Boolean(chosenMeasure?.problem) || !view.portal.enabled || !view.hasEmail} loading={busy === "outcome"} onClick={() => void run("outcome", () => sendOutcome(measure, caseId || null))}>
              Send questionnaire
            </PmsButton>
          </div>
          {chosenMeasure?.problem ? <p className="mt-2 text-sm text-[#864E0E]">{chosenMeasure.problem}</p> : null}
        </section>
      ) : null}

      {view.canSend ? (
        <section aria-labelledby="pf-portal" className="rounded-2xl border border-border bg-white p-5">
          <h2 id="pf-portal" className="text-base font-semibold text-foreground">
            Patient portal
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <Switch id="pf-access" checked={view.portal.accountStatus !== "disabled"} disabled={busy === "portal"} onCheckedChange={(v) => void run("portal", () => setPortal(v))} label="Portal access" />
            <span className="text-sm text-[#475569]">{view.portal.lastSignInAt ? `Last signed in ${formatWhen(view.portal.lastSignInAt)}` : "Has not signed in yet"}</span>
          </div>
        </section>
      ) : null}
    </div>
  );
}
