"use client";
/**
 * Choosing chargeable visits to invoice (design round 3 "Invoice visits" and the Billing "Attended, not invoiced"
 * tab): include filters by outcome, select-all, waive a missed-appointment fee, and the totals of what will be
 * invoiced. "stepper" mode walks Choose visits → Preview drafts → Issue and send; "tab" mode creates drafts (or
 * issues) straight from the list. The server builds every line again from the diary – the screen sends ids only.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { invoiceVisitsAction, waiveFeeAction } from "@/app/app/clinic/billing/actions";
import type { VisitStatus } from "@/modules/pms/billing/types";
import type { UninvoicedVisitView } from "@/modules/pms/billing/view";
import { cn } from "@/lib/utils";
import { PmsButton, PmsNotice, StatusPill, pmsButtonVariants, useToast } from "@/components/pms/ui";
import { BILLING_PATH, date, focusRing, money } from "./format";

const OUTCOME_STATUS: Record<VisitStatus, string> = { attended: "attended", did_not_attend: "dna", late_cancellation: "late_cancelled" };
const OUTCOME_FILTERS: { key: VisitStatus; label: string }[] = [
  { key: "attended", label: "Completed" },
  { key: "did_not_attend", label: "DNA" },
  { key: "late_cancellation", label: "Late cancellation" },
];

function whenLabel(v: UninvoicedVisitView, today: string): string {
  if (v.date === today) return `Today ${v.startTime ?? ""}`.trim();
  const d = new Date(`${v.date}T12:00:00Z`);
  const wd = d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  return `${wd} ${v.date.slice(8, 10)}/${v.date.slice(5, 7)} ${v.startTime ?? ""}`.trim();
}

/** How the server groups visits into invoices (per patient, case, who is billed; the excess on its own invoice). */
function previewInvoices(chosen: UninvoicedVisitView[]) {
  const groups = new Map<string, { patientName: string; to: string; billTo: "patient" | "payer"; total: number; visits: number }>();
  const add = (key: string, v: UninvoicedVisitView, billTo: "patient" | "payer", to: string, amount: number) => {
    const g = groups.get(key) ?? { patientName: v.patientName, to, billTo, total: 0, visits: 0 };
    g.total += amount;
    g.visits += 1;
    groups.set(key, g);
  };
  for (const v of chosen) {
    if (v.chargePence === null) continue;
    if (v.billTo === "payer") {
      add(`${v.patientId}|${v.payerLabel}|payer`, v, "payer", v.payerLabel, v.payerPence);
      if (v.excessPence > 0) add(`${v.patientId}|excess`, v, "patient", v.patientName, v.excessPence);
    } else {
      add(`${v.patientId}|self`, v, "patient", v.patientName, v.patientPence);
    }
  }
  return Array.from(groups.values());
}

export function VisitsTable({ visits, mode, today, from, until }: { visits: UninvoicedVisitView[]; mode: "tab" | "stepper"; today?: string; from?: string; until?: string }) {
  const router = useRouter();
  const toast = useToast();
  const day = today ?? new Date().toISOString().slice(0, 10);
  const [include, setInclude] = React.useState<Record<VisitStatus, boolean>>({ attended: true, did_not_attend: true, late_cancellation: true });
  const [off, setOff] = React.useState<Record<string, boolean>>({});
  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [made, setMade] = React.useState<{ id: string; number: string | null; billTo: string; totalPence: number }[]>([]);

  const shown = visits.filter((v) => include[v.status]);
  const chosen = shown.filter((v) => !off[v.appointmentId] && v.chargePence !== null);
  const preview = previewInvoices(chosen);
  const patientsTotal = preview.filter((p) => p.billTo === "patient").reduce((a, p) => a + p.total, 0);
  const payersTotal = preview.filter((p) => p.billTo === "payer").reduce((a, p) => a + p.total, 0);
  const counts = (s: VisitStatus) => visits.filter((v) => v.status === s).length;
  const allOn = shown.length > 0 && shown.every((v) => !off[v.appointmentId]);

  async function create(issue: boolean) {
    setBusy(issue ? "issue" : "draft");
    setError(null);
    const r = await invoiceVisitsAction(
      chosen.map((v) => v.appointmentId),
      issue,
    );
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setMade(r.result.invoices);
    toast.success(`${r.result.invoices.length} invoice${r.result.invoices.length === 1 ? "" : "s"} ${issue ? "issued" : "drafted"}`);
    if (mode === "stepper") setStep(3);
    router.refresh();
  }

  async function waive(v: UninvoicedVisitView) {
    setBusy(`waive-${v.appointmentId}`);
    const r = await waiveFeeAction(v.appointmentId);
    setBusy(null);
    if (!r.ok) setError(r.error);
    else {
      toast.success(`Fee waived for ${v.patientName}`);
      router.refresh();
    }
  }

  const steps = [
    { n: 1, label: "Choose visits" },
    { n: 2, label: "Preview drafts" },
    { n: 3, label: "Issue and send" },
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      {mode === "stepper" ? (
        <ol className="grid gap-2 md:grid-cols-3" aria-label="Steps">
          {steps.map((s) => (
            <li
              key={s.n}
              aria-current={step === s.n ? "step" : undefined}
              className={cn("flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-semibold", step === s.n ? "border-[#0E958A] bg-[#F0FDFA] text-foreground" : "border-border bg-white text-[#334155]")}
            >
              <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-full text-xs", step === s.n ? "bg-white text-primary-strong" : "bg-[#F1F5F9]")}>{s.n}</span>
              {s.label}
            </li>
          ))}
        </ol>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive-strong">
          {error}
        </p>
      ) : null}

      {step === 1 ? (
        <div className="flex flex-col rounded-xl border border-border bg-white">
          <div className="flex flex-wrap items-center gap-4 border-b border-border px-4 py-3">
            <fieldset className="flex flex-wrap items-center gap-4">
              <legend className="sr-only">Include</legend>
              <span className="text-sm font-semibold text-foreground" aria-hidden>
                Include
              </span>
              {OUTCOME_FILTERS.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-[#0B7970]" checked={include[f.key]} onChange={(e) => setInclude({ ...include, [f.key]: e.target.checked })} />
                  {f.label} <span className="text-[#475569]">({counts(f.key)})</span>
                </label>
              ))}
            </fieldset>
            {from && until ? <span className="ml-auto text-sm text-[#475569]">Visits from {date(from)} to {date(until)}</span> : null}
          </div>
          {shown.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[#475569]">Every chargeable visit has an invoice.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm" data-testid="visits-table">
                <caption className="sr-only">Visits without an invoice</caption>
                <thead className="bg-[#F8FAFC] text-left text-xs font-semibold text-[#334155]">
                  <tr>
                    <th scope="col" className="w-10 px-4 py-2">
                      <input
                        type="checkbox"
                        aria-label="Select all visits"
                        className="h-4 w-4 accent-[#0B7970]"
                        checked={allOn}
                        onChange={(e) => setOff(e.target.checked ? {} : Object.fromEntries(shown.map((v) => [v.appointmentId, true])))}
                      />
                    </th>
                    <th scope="col" className="px-3 py-2">Visit</th>
                    <th scope="col" className="px-3 py-2">Patient</th>
                    <th scope="col" className="px-3 py-2">Outcome</th>
                    <th scope="col" className="px-3 py-2">Practitioner</th>
                    <th scope="col" className="px-3 py-2">Payer</th>
                    <th scope="col" className="px-3 py-2 text-right">Charge</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((v) => (
                    <tr key={v.appointmentId} className="border-t border-border" data-appointment={v.appointmentId}>
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[#0B7970]"
                          aria-label={`Invoice ${v.patientName} ${whenLabel(v, day)}`}
                          checked={!off[v.appointmentId] && v.chargePence !== null}
                          disabled={v.chargePence === null}
                          onChange={(e) => setOff({ ...off, [v.appointmentId]: !e.target.checked })}
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{whenLabel(v, day)}</td>
                      <td className="px-3 py-2 font-semibold">{v.patientName}</td>
                      <td className="px-3 py-2">
                        <StatusPill kind="appointment" status={OUTCOME_STATUS[v.status]} size="sm" />
                      </td>
                      <td className="px-3 py-2">{v.practitionerName ?? "–"}</td>
                      <td className="px-3 py-2">
                        {v.payerLabel}
                        {v.excessPence > 0 ? <span className="text-[#475569]"> · excess {money(v.excessPence)}</span> : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        <span className="inline-flex items-center gap-2">
                          {v.waivable ? (
                            <PmsButton variant="secondary" size="sm" loading={busy === `waive-${v.appointmentId}`} onClick={() => void waive(v)} aria-label={`Waive fee for ${v.patientName}`}>
                              Waive fee
                            </PmsButton>
                          ) : null}
                          {v.chargePence === null ? <span className="text-[#475569]">No price</span> : money(v.chargePence)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3">
            <span className="text-sm text-[#334155]" role="status" data-testid="visits-summary">
              {chosen.length} visit{chosen.length === 1 ? "" : "s"} selected → {preview.length} invoice{preview.length === 1 ? "" : "s"} · patients {money(patientsTotal)} · insurers {money(payersTotal)}
            </span>
            <span className="ml-auto flex flex-wrap gap-2">
              {mode === "stepper" ? (
                <PmsButton disabled={chosen.length === 0} onClick={() => setStep(2)}>
                  Preview drafts
                </PmsButton>
              ) : (
                <>
                  <PmsButton variant="secondary" disabled={chosen.length === 0} loading={busy === "draft"} onClick={() => void create(false)}>
                    Create as drafts
                  </PmsButton>
                  <PmsButton disabled={chosen.length === 0} loading={busy === "issue"} onClick={() => void create(true)}>
                    Create and issue
                  </PmsButton>
                </>
              )}
            </span>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-white p-4">
          <h2 className="text-base font-semibold">These invoices will be made</h2>
          <ul className="flex flex-col divide-y divide-border" data-testid="draft-preview">
            {preview.map((p, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="font-semibold">{p.to}</span>
                <span className="text-[#475569]">
                  {p.billTo === "payer" ? `for ${p.patientName}` : p.to === p.patientName ? "" : `– ${p.patientName}`} · {p.visits} visit{p.visits === 1 ? "" : "s"}
                </span>
                <span className="ml-auto font-semibold tabular-nums">{money(p.total)}</span>
              </li>
            ))}
          </ul>
          <PmsNotice tone="info" title="How the invoices are made">Prices come from each case&apos;s price list. Insured visits: the excess goes on the patient&apos;s own invoice, the rest to the insurer.</PmsNotice>
          <div className="flex flex-wrap justify-end gap-2">
            <PmsButton variant="secondary" onClick={() => setStep(1)}>
              Back
            </PmsButton>
            <PmsButton variant="secondary" loading={busy === "draft"} onClick={() => void create(false)}>
              Create drafts
            </PmsButton>
            <PmsButton loading={busy === "issue"} onClick={() => void create(true)}>
              Create and issue
            </PmsButton>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-white p-4" data-testid="visits-done">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <CheckCircle2 className="h-5 w-5 text-primary-strong" aria-hidden />
            {made.length} invoice{made.length === 1 ? "" : "s"} made
          </h2>
          <ul className="flex flex-col divide-y divide-border">
            {made.map((m) => (
              <li key={m.id} className="flex items-center gap-2 py-2 text-sm">
                <Link href={`${BILLING_PATH}/invoices/${m.id}`} className={cn("font-semibold text-primary-strong underline underline-offset-2", focusRing)}>
                  {m.number ?? "Draft"}
                </Link>
                <span className="text-[#475569]">{m.billTo === "payer" ? "Insurer / account" : "Patient"}</span>
                <span className="ml-auto tabular-nums">{money(m.totalPence)}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Link href={BILLING_PATH} className={pmsButtonVariants({ variant: "secondary" })}>
              Back to billing
            </Link>
            <PmsButton
              onClick={() => {
                setMade([]);
                setStep(1);
              }}
            >
              Invoice more visits
            </PmsButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
