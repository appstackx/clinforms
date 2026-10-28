"use client";
/**
 * Allocate an insurer payment (design round 3 "Remittance allocation"): the payer, amount, reference, date and
 * method; their open invoices with what is paid now; per short payment: leave outstanding, write off (with why) or
 * move to the patient; the summary with what stays on the account as credit. "Match from remittance advice" fills
 * the amounts from pasted lines ("INV00042 120.00").
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { AlertTriangle, Check } from "lucide-react";
import { remittanceAction, remittanceInvoicesAction } from "@/app/app/clinic/billing/actions";
import { SHORTFALL_ACTION_LABELS, WRITE_OFF_REASON_LABELS } from "@/modules/pms/billing/copy";
import { parseDocumentNumber } from "@/modules/pms/billing/numbers";
import { SHORTFALL_ACTIONS, WRITE_OFF_REASONS, type ShortfallAction } from "@/modules/pms/billing/schemas";
import type { RemittanceInvoiceView } from "@/modules/pms/billing/view";
import { cn } from "@/lib/utils";
import { PmsButton, useToast } from "@/components/pms/ui";
import { BILLING_PATH, date, focusRing, money, parsePounds, poundsText } from "./format";

interface Row {
  on: boolean;
  paid: string;
  shortfall: ShortfallAction;
  reason: string;
}

const input = cn("h-9 rounded-[8px] border border-[#94A3B8] bg-white px-2 text-sm", focusRing);

export function RemittanceForm({ payers, initialPayer, today, canWriteOff }: { payers: { id: string; name: string }[]; initialPayer: string | null; today: string; canWriteOff: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [payer, setPayer] = React.useState(initialPayer ?? payers[0]?.id ?? "");
  const [received, setReceived] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [on, setOn] = React.useState(today);
  const [method, setMethod] = React.useState("bank_transfer");
  const [invoices, setInvoices] = React.useState<RemittanceInvoiceView[] | null>(null);
  const [rows, setRows] = React.useState<Record<string, Row>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [advice, setAdvice] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!payer) return;
    let live = true;
    setInvoices(null);
    void remittanceInvoicesAction(payer).then((r) => {
      if (!live) return;
      if (!r.ok) return setError(r.error);
      setInvoices(r.invoices);
      setRows(Object.fromEntries(r.invoices.map((i) => [i.id, { on: false, paid: "", shortfall: "leave" as ShortfallAction, reason: "above_agreed_rate" }])));
    });
    return () => {
      live = false;
    };
  }, [payer]);

  const receivedPence = parsePounds(received) ?? 0;
  const list = invoices ?? [];
  const chosen = list.filter((i) => rows[i.id]?.on);
  const paidOf = (i: RemittanceInvoiceView) => (rows[i.id]?.on ? (parsePounds(rows[i.id].paid) ?? 0) : 0);
  const allocated = chosen.reduce((a, i) => a + paidOf(i), 0);
  const shortOf = (i: RemittanceInvoiceView) => Math.max(0, i.balancePence - paidOf(i));
  const writtenOff = chosen.filter((i) => rows[i.id].shortfall === "write_off").reduce((a, i) => a + shortOf(i), 0);
  const moved = chosen.filter((i) => rows[i.id].shortfall === "patient").reduce((a, i) => a + shortOf(i), 0);
  const unallocated = receivedPence - allocated;
  const payerName = payers.find((p) => p.id === payer)?.name ?? "the account";

  const set = (id: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  const toggle = (i: RemittanceInvoiceView, value: boolean) => {
    if (!value) return set(i.id, { on: false });
    const left = Math.max(0, receivedPence - allocated);
    set(i.id, { on: true, paid: poundsText(Math.min(i.balancePence, left || i.balancePence)) });
  };

  function matchAdvice(text: string) {
    let n = 0;
    for (const line of text.split(/\r?\n/)) {
      const m = /([A-Za-z]{0,4}[\s-]?\d{1,6})\D+?(\d[\d,]*(?:\.\d{1,2})?)\s*$/.exec(line.trim());
      if (!m) continue;
      const num = parseDocumentNumber(m[1]);
      const pence = parsePounds(m[2]);
      if (!num || pence === null) continue;
      const inv = list.find((i) => i.number && parseDocumentNumber(i.number)?.seq === num.seq);
      if (!inv) continue;
      set(inv.id, { on: true, paid: poundsText(Math.min(pence, inv.balancePence)) });
      n += 1;
    }
    toast.success(`${n} invoice${n === 1 ? "" : "s"} matched`);
    setAdvice(null);
  }

  async function save() {
    setError(null);
    if (!payer) return setError("Choose the insurer.");
    if (receivedPence <= 0) return setError("Enter the amount received.");
    if (!reference.trim()) return setError("Enter the remittance reference.");
    if (chosen.length === 0) return setError("Tick the invoices this payment covers.");
    if (allocated > receivedPence) return setError("More is allocated than was received.");
    setBusy(true);
    const r = await remittanceAction({
      payerReferrerId: payer,
      amountPence: receivedPence,
      reference: reference.trim(),
      receivedOn: on,
      method: method as "bank_transfer",
      rows: chosen.map((i) => ({ invoiceId: i.id, paidPence: paidOf(i), shortfall: rows[i.id].shortfall, writeOffReason: rows[i.id].shortfall === "write_off" ? (rows[i.id].reason as (typeof WRITE_OFF_REASONS)[number]) : undefined })),
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    toast.success(`Allocated ${money(r.result.allocatedPence)}${r.result.unallocatedPence > 0 ? ` – ${money(r.result.unallocatedPence)} kept on account` : ""}`);
    router.push(`${BILLING_PATH}?tab=remittances`);
    router.refresh();
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1312px] flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-[#475569]">
        <Link href={BILLING_PATH} className={cn("text-primary-strong underline underline-offset-2", focusRing)}>
          Billing
        </Link>
        <span aria-hidden> / </span>
        <Link href={`${BILLING_PATH}?tab=remittances`} className={cn("text-primary-strong underline underline-offset-2", focusRing)}>
          Remittances
        </Link>
        <span aria-hidden> / </span>
        <span>New</span>
      </nav>
      <h1 className="text-2xl font-semibold text-foreground">Allocate an insurer payment</h1>

      <section className="grid gap-3 rounded-xl border border-border bg-white p-5 md:grid-cols-5" aria-label="The payment">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Insurer
          <select className={input} value={payer} onChange={(e) => setPayer(e.target.value)} data-testid="remit-payer">
            {payers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Amount received
          <input className={cn(input, "tabular-nums")} inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} placeholder="£0.00" data-testid="remit-amount" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Reference
          <input className={input} value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} data-testid="remit-reference" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Date received
          <input type="date" className={input} value={on} max={today} onChange={(e) => setOn(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Method
          <select className={input} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="bank_transfer">Bank transfer</option>
            <option value="cheque">Cheque</option>
            <option value="card">Card</option>
            <option value="other">Other</option>
          </select>
        </label>
      </section>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="flex min-w-0 flex-col rounded-xl border border-border bg-white" aria-labelledby="remit-open-h">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <h2 id="remit-open-h" className="text-base font-semibold">
              Open {payerName.replace(/ \(fictional\)$/, "")} invoices ({list.length})
            </h2>
            <PmsButton variant="secondary" size="sm" className="ml-auto" onClick={() => setAdvice(advice === null ? "" : null)}>
              Match from remittance advice
            </PmsButton>
          </div>
          {advice !== null ? (
            <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
              <label className="flex flex-col gap-1 text-sm font-medium">
                Paste the remittance advice (one line per invoice: number and amount)
                <textarea value={advice} onChange={(e) => setAdvice(e.target.value)} rows={4} className={cn("rounded-[8px] border border-[#94A3B8] p-2 font-mono text-[13px]", focusRing)} />
              </label>
              <PmsButton size="sm" className="self-start" onClick={() => matchAdvice(advice)}>
                Match
              </PmsButton>
            </div>
          ) : null}
          {invoices === null ? <p className="px-4 py-6 text-sm text-[#475569]">Loading…</p> : null}
          {invoices && invoices.length === 0 ? <p className="px-4 py-6 text-sm text-[#475569]">{payerName} has no open invoices.</p> : null}
          {list.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm" data-testid="remit-table">
                <caption className="sr-only">Open invoices</caption>
                <thead className="border-y border-border bg-[#F8FAFC] text-left text-xs font-semibold text-[#334155]">
                  <tr>
                    <th scope="col" className="w-10 px-4 py-2">
                      <span className="sr-only">In this payment</span>
                    </th>
                    <th scope="col" className="px-3 py-2">Invoice</th>
                    <th scope="col" className="px-3 py-2">Patient</th>
                    <th scope="col" className="px-3 py-2 text-right">Owing</th>
                    <th scope="col" className="px-3 py-2 text-right">Paid now</th>
                    <th scope="col" className="px-3 py-2">Shortfall</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((i) => {
                    const r = rows[i.id];
                    const short = shortOf(i);
                    return (
                      <tr key={i.id} className={cn("border-b border-border align-top", !r?.on && "bg-[#F8FAFC]")} data-invoice={i.number ?? i.id}>
                        <td className="px-4 py-3">
                          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#0B7970]" checked={Boolean(r?.on)} onChange={(e) => toggle(i, e.target.checked)} aria-label={`${i.number} in this payment`} />
                        </td>
                        <td className="px-3 py-3">
                          <Link href={`${BILLING_PATH}/invoices/${i.id}`} className={cn("font-semibold text-primary-strong underline underline-offset-2", focusRing)}>
                            {i.number}
                          </Link>
                          <div className="text-xs text-[#475569]">{date(i.issuedOn)}</div>
                        </td>
                        <td className="px-3 py-3">{i.patientName}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{money(i.balancePence)}</td>
                        <td className="px-3 py-3 text-right">
                          <input
                            aria-label={`Paid now on ${i.number}`}
                            inputMode="decimal"
                            disabled={!r?.on}
                            value={r?.on ? r.paid : ""}
                            onChange={(e) => set(i.id, { paid: e.target.value })}
                            className={cn(input, "w-24 text-right tabular-nums disabled:bg-[#F1F5F9]")}
                          />
                        </td>
                        <td className="px-3 py-3">
                          {!r?.on ? (
                            <span className="text-[#475569]">Not in this payment</span>
                          ) : short === 0 ? (
                            <span className="inline-flex items-center gap-1 text-[#166534]">
                              <Check className="h-4 w-4" aria-hidden />
                              Paid in full
                            </span>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="inline-flex items-center gap-1 rounded-full bg-[#FEF3C7] px-2 py-0.5 text-xs font-semibold text-[#864E0E]">
                                <AlertTriangle className="h-3 w-3" aria-hidden />
                                Short {money(short)}
                              </span>
                              <select aria-label={`Shortfall on ${i.number}`} className={input} value={r.shortfall} onChange={(e) => set(i.id, { shortfall: e.target.value as ShortfallAction })} data-testid="shortfall-action">
                                {SHORTFALL_ACTIONS.map((a) => (
                                  <option key={a} value={a} disabled={!canWriteOff && a !== "leave"}>
                                    {SHORTFALL_ACTION_LABELS[a]}
                                  </option>
                                ))}
                              </select>
                              {r.shortfall === "write_off" ? (
                                <select aria-label={`Why ${i.number} is written off`} className={input} value={r.reason} onChange={(e) => set(i.id, { reason: e.target.value })}>
                                  {WRITE_OFF_REASONS.map((w) => (
                                    <option key={w} value={w}>
                                      {WRITE_OFF_REASON_LABELS[w]}
                                    </option>
                                  ))}
                                </select>
                              ) : null}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        <aside className="flex h-fit flex-col gap-3 rounded-xl border border-border bg-white p-5" aria-labelledby="remit-sum-h">
          <h2 id="remit-sum-h" className="text-base font-semibold">
            Summary
          </h2>
          <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm" data-testid="remit-summary">
            <dt>Received</dt>
            <dd className="text-right font-semibold tabular-nums">{money(receivedPence)}</dd>
            <dt>
              Allocated to {chosen.length} invoice{chosen.length === 1 ? "" : "s"}
            </dt>
            <dd className="text-right tabular-nums">{money(allocated)}</dd>
            <dt>Written off</dt>
            <dd className="text-right tabular-nums">{money(writtenOff)}</dd>
            <dt>Moved to patients</dt>
            <dd className="text-right tabular-nums">{money(moved)}</dd>
            <dt className="border-t border-border pt-2 font-semibold">Unallocated</dt>
            <dd className={cn("border-t border-border pt-2 text-right font-bold tabular-nums", unallocated < 0 ? "text-destructive-strong" : unallocated > 0 ? "text-[#864E0E]" : "")}>{money(unallocated)}</dd>
          </dl>
          {unallocated > 0 ? (
            <p className="rounded-[10px] border border-[#FBD38D] bg-[#FFFBEB] p-3 text-sm text-[#0F172A]" role="status">
              {money(unallocated)} will stay on the {payerName.replace(/ \(fictional\)$/, "")} account as credit, ready for the next invoices.
            </p>
          ) : null}
          {unallocated < 0 ? (
            <p role="alert" className="text-sm text-destructive-strong">
              More is allocated than was received.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive-strong">
              {error}
            </p>
          ) : null}
          <PmsButton className="h-11" loading={busy} onClick={() => void save()} data-testid="remit-save">
            Save allocation
          </PmsButton>
          <p className="text-xs text-[#475569]">Write-offs need the &quot;Refunds and credit notes&quot; permission and are listed in History.</p>
        </aside>
      </div>
    </div>
  );
}
