"use client";
/**
 * One invoice (design round 2f "Invoice detail – insurer split, payment"): the status, the actions the member may
 * use (Record payment, Copy payment link, Credit note, Refund, Void; a draft: Issue, Cancel draft), the insured
 * split (the patient's excess invoice beside the insurer's), policy and authorisation, the items with the excess per
 * visit, payments and adjustments, and the A4 preview (Download = the print page, Save as PDF).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { CreditCard, Download, Link2, RefreshCw, Shield } from "lucide-react";
import { cancelDraftAction, checkPaymentLinksAction, creditNoteAction, issueInvoiceAction, paymentLinkAction, refundAction, removeAllocationAction, voidInvoiceAction } from "@/app/app/clinic/billing/actions";
import { contributionWording } from "@/modules/pms/billing/excess";
import type { InvoiceDetailView, PrintClinic } from "@/modules/pms/billing/view";
import { cn } from "@/lib/utils";
import { ConfirmDialog, PmsButton, StatusPill, pmsButtonVariants, useToast } from "@/components/pms/ui";
import { BILLING_PATH, date, focusRing, money, parsePounds, poundsText } from "./format";
import { PrintInvoiceSheet } from "./print-sheets";
import { EmailInvoiceButton, TextPaymentLinkButton } from "@/components/pms/comms/billing-buttons";
import { TakePaymentDialog } from "./take-payment-dialog";

export interface InvoiceDetailProps {
  invoice: InvoiceDetailView;
  clinic: PrintClinic;
  howToPay: string[];
  printedBy: string;
  printedAt: string;
  demo: boolean;
  can: { edit: boolean; pay: boolean; refund: boolean; void: boolean };
}

type Dialog = null | "credit" | "refund" | "void" | "issue" | "cancel";

export function InvoiceDetail({ invoice: inv, clinic, howToPay, printedBy, printedAt, demo, can }: InvoiceDetailProps) {
  const router = useRouter();
  const toast = useToast();
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [refundMethod, setRefundMethod] = React.useState<"card" | "cash" | "bank_transfer">("card");
  const words = contributionWording(inv.contribution?.mode ?? "per_case");
  const coveredVisits = inv.lines.filter((l) => l.kind === "excess" && l.appointmentId !== null).length;
  const [payOpen, setPayOpen] = React.useState(false);
  const issued = inv.status === "issued";
  const isVoid = inv.state === "void";

  async function run(key: string, work: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setBusy(key);
    setError(null);
    const r = await work();
    setBusy(null);
    if (!r.ok) {
      setError(r.error ?? "Something went wrong.");
      return false;
    }
    toast.success(success);
    setDialog(null);
    setAmount("");
    setReason("");
    router.refresh();
    return true;
  }

  const open = (d: Dialog) => {
    setError(null);
    setReason("");
    setAmount(d === "refund" ? poundsText(Math.max(0, Math.min(inv.paidPence, -inv.balancePence > 0 ? -inv.balancePence : inv.paidPence))) : d === "credit" ? poundsText(inv.totalPence - inv.creditedPence) : "");
    setDialog(d);
  };

  const copyLink = async () => {
    setBusy("link");
    const r = await paymentLinkAction(inv.id);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    try {
      await navigator.clipboard?.writeText(r.url);
    } catch {
      /* the link is shown below as well */
    }
    toast.success("Payment link copied (test mode)");
    router.refresh();
  };

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {inv.status === "draft" && can.edit ? (
        <>
          <PmsButton onClick={() => setDialog("issue")} data-testid="issue-invoice">
            Issue invoice
          </PmsButton>
          <PmsButton variant="secondary" onClick={() => setDialog("cancel")}>
            Cancel draft
          </PmsButton>
        </>
      ) : null}
      {issued && !isVoid && can.pay && inv.balancePence > 0 ? (
        inv.billTo === "patient" ? (
          <PmsButton onClick={() => setPayOpen(true)} data-testid="record-payment">
            <CreditCard aria-hidden />
            Record payment
          </PmsButton>
        ) : (
          <Link href={`${BILLING_PATH}/remittances/new?payer=${inv.payer?.id ?? ""}`} className={pmsButtonVariants({ variant: "primary" })}>
            <CreditCard aria-hidden />
            Record payment
          </Link>
        )
      ) : null}
      {issued && !isVoid && can.pay && inv.balancePence > 0 && inv.billTo === "patient" ? <TextPaymentLinkButton invoiceId={inv.id} /> : null}
      {issued && !isVoid && can.pay && inv.balancePence > 0 ? (
        <PmsButton variant="secondary" loading={busy === "link"} onClick={() => void copyLink()} data-testid="copy-payment-link">
          <Link2 aria-hidden />
          Copy payment link
        </PmsButton>
      ) : null}
      {issued && !isVoid && can.refund && inv.totalPence - inv.creditedPence > 0 ? (
        <PmsButton variant="secondary" onClick={() => open("credit")} data-testid="credit-note">
          Credit note
        </PmsButton>
      ) : null}
      {issued && can.refund && inv.paidPence > 0 ? (
        <PmsButton variant="secondary" onClick={() => open("refund")} data-testid="refund">
          Refund
        </PmsButton>
      ) : null}
      {issued && !isVoid && can.void ? (
        <PmsButton variant="secondary" className="text-destructive-strong" onClick={() => open("void")} data-testid="void-invoice">
          Void
        </PmsButton>
      ) : null}
    </div>
  );

  const activeLinks = inv.paymentLinks.filter((l) => l.status === "active");

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1392px] flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-[#475569]">
        <Link href={BILLING_PATH} className={cn("text-primary-strong underline underline-offset-2", focusRing)}>
          Billing
        </Link>
        <span aria-hidden> / </span>
        <span>{inv.number ?? "Draft invoice"}</span>
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-foreground">{inv.number ? `Invoice ${inv.number}` : "Draft invoice"}</h1>
        <StatusPill kind="invoice" status={inv.state} />
        <div className="w-full lg:ml-auto lg:w-auto">{actions}</div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive-strong">
          {error}
        </p>
      ) : null}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          {inv.billTo === "payer" || inv.partner || inv.contribution ? (
            <section className="flex flex-col gap-4 rounded-xl border border-border bg-white p-5" aria-labelledby="split-h" data-testid="split-card" data-mode={inv.contribution?.mode ?? ""}>
              <h2 id="split-h" className="flex items-center gap-2 text-base font-semibold">
                <Shield className="h-4 w-4 text-[#1842B4]" aria-hidden />
                {words.heading}
              </h2>
              {inv.contribution ? (
                <p className="text-sm text-[#334155]" data-testid="split-explain">
                  {words.explain(inv.contribution.amountPence !== null ? money(inv.contribution.amountPence) : null, inv.contribution.insurerName)}
                </p>
              ) : null}
              <div className="grid gap-3 md:grid-cols-2">
                {(() => {
                  const here = { label: inv.billTo === "payer" ? "This invoice · insurer balance" : `This invoice · ${words.patientPart.toLowerCase()}`, name: inv.billToName, total: inv.totalPence, balance: inv.balancePence, state: inv.state };
                  const other = inv.partner
                    ? { label: inv.partner.isExcess ? `${words.patientPart} · ${inv.partner.number ?? "draft"}` : `Insurer · ${inv.partner.number ?? "draft"}`, name: inv.partner.billToName, total: inv.partner.totalPence, balance: inv.partner.balancePence, state: inv.partner.state, id: inv.partner.id }
                    : null;
                  const cards = inv.billTo === "payer" ? [other, { ...here, id: null as string | null }] : [{ ...here, id: null as string | null }, other];
                  return cards.map((c, i) =>
                    c ? (
                      <div key={i} className={cn("flex flex-col gap-1 rounded-[10px] border p-4", c.id === null ? "border-2 border-[#0E958A]" : "border-border")}>
                        <span className="text-xs font-medium text-[#475569]">{c.label}</span>
                        {c.id ? (
                          <Link href={`${BILLING_PATH}/invoices/${c.id}`} className={cn("font-semibold text-foreground underline-offset-2 hover:underline", focusRing)}>
                            {c.name}
                          </Link>
                        ) : (
                          <strong>{c.name}</strong>
                        )}
                        <span className="flex items-center justify-between gap-2">
                          <span className="tabular-nums">{money(c.total)}</span>
                          {c.balance > 0 && c.id === null ? <span className="tabular-nums">{money(c.balance)} outstanding</span> : <StatusPill kind="invoice" status={c.state} size="sm" />}
                        </span>
                      </div>
                    ) : (
                      <div key={i} className="rounded-[10px] border border-dashed border-border p-4 text-sm text-[#475569]" data-testid="split-other-empty">
                        {inv.contribution?.fullyPatient ? words.fullyPatient(inv.contribution.insurerName, coveredVisits) : words.none}
                      </div>
                    ),
                  );
                })()}
              </div>
              <dl className="grid grid-cols-[150px_1fr] gap-x-4 gap-y-2 text-sm">
                {inv.case?.membershipNumber ? (
                  <>
                    <dt className="text-[#475569]">Policy / member no.</dt>
                    <dd>{inv.case.membershipNumber}</dd>
                  </>
                ) : null}
                {inv.authorisation ? (
                  <>
                    <dt className="text-[#475569]">Authorisation</dt>
                    <dd>
                      {inv.authorisation.code}
                      {inv.authorisation.sessionsAuthorised !== null ? ` · ${inv.authorisation.sessionsUsed} of ${inv.authorisation.sessionsAuthorised} sessions used` : ""}
                    </dd>
                  </>
                ) : null}
                {inv.case ? (
                  <>
                    <dt className="text-[#475569]">Case</dt>
                    <dd>
                      <Link href={`/app/clinic/patients/${inv.patient.id}/cases/${inv.case.id}`} className={cn("text-primary-strong underline underline-offset-2", focusRing)}>
                        {inv.case.title} – {inv.patient.name}
                      </Link>
                    </dd>
                  </>
                ) : null}
              </dl>
            </section>
          ) : (
            <section className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border border-border bg-white px-5 py-4 text-sm">
              <span>
                <span className="text-[#475569]">Patient </span>
                <Link href={`/app/clinic/patients/${inv.patient.id}`} className={cn("font-semibold text-primary-strong underline underline-offset-2", focusRing)}>
                  {inv.patient.name}
                </Link>
              </span>
              <span>
                <span className="text-[#475569]">Issued </span>
                {date(inv.issuedOn)}
              </span>
              <span>
                <span className="text-[#475569]">Due </span>
                {date(inv.dueOn)}
              </span>
              {inv.siteName ? (
                <span>
                  <span className="text-[#475569]">Site </span>
                  {inv.siteName}
                </span>
              ) : null}
            </section>
          )}

          <section className="flex flex-col rounded-xl border border-border bg-white" aria-labelledby="items-h">
            <h2 id="items-h" className="px-5 py-4 text-base font-semibold">
              Items
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <caption className="sr-only">Items</caption>
                <thead className="border-y border-border bg-[#F8FAFC] text-left text-xs font-semibold text-[#334155]">
                  <tr>
                    <th scope="col" className="px-5 py-2">Date</th>
                    <th scope="col" className="px-3 py-2">Item</th>
                    <th scope="col" className="px-3 py-2">Practitioner</th>
                    <th scope="col" className="px-3 py-2 text-right">Fee</th>
                    {inv.billTo === "payer" ? <th scope="col" className="px-3 py-2 text-right">{words.column}</th> : null}
                    <th scope="col" className="px-5 py-2 text-right">{inv.billTo === "payer" ? "Insurer pays" : "Amount"}</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.lines.map((l) => (
                    <tr key={l.id} className="border-b border-border">
                      <td className="px-5 py-3 tabular-nums">{date(l.serviceOn)}</td>
                      <td className="px-3 py-3">{l.description}</td>
                      <td className="px-3 py-3">{l.practitionerName ?? "–"}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{money(l.totalPence)}</td>
                      {inv.billTo === "payer" ? <td className="px-3 py-3 text-right tabular-nums">{l.excessPence ? `−${money(l.excessPence)}` : "–"}</td> : null}
                      <td className="px-5 py-3 text-right tabular-nums">{money(l.totalPence - l.excessPence)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-6 px-5 py-3 text-sm">
              <strong>{inv.billTo === "payer" ? "Total due from insurer" : "Total"}</strong>
              <strong className="tabular-nums">{money(inv.totalPence)}</strong>
            </div>
          </section>

          <section className="flex flex-col gap-2 rounded-xl border border-border bg-white px-5 py-4" aria-labelledby="money-h">
            <h2 id="money-h" className="text-base font-semibold">
              Payments and adjustments
            </h2>
            {inv.money.length === 0 ? <p className="text-sm text-[#475569]">Nothing paid or credited yet.</p> : null}
            {inv.money.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-3 border-t border-border py-2.5 text-sm first:border-t-0">
                <span className="w-24 tabular-nums text-[#475569]">{date(m.on)}</span>
                <span className="min-w-0 flex-1">{m.label}</span>
                {m.allocationId && can.refund && m.amountPence < 0 ? (
                  <PmsButton variant="ghost" size="sm" loading={busy === m.id} onClick={() => void run(m.id, () => removeAllocationAction(inv.id, m.allocationId as string), "Payment taken off the invoice (kept on account)")}>
                    Take off
                  </PmsButton>
                ) : null}
                <span className={cn("font-semibold tabular-nums", m.amountPence < 0 ? "text-[#166534]" : "text-foreground")}>{m.amountPence < 0 ? `−${money(-m.amountPence)}` : money(m.amountPence)}</span>
              </div>
            ))}
            {activeLinks.length ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2.5 text-sm">
                <span className="min-w-0 flex-1 break-all text-[#334155]">
                  Payment link (test mode): <span data-testid="invoice-payment-link">{activeLinks[0].url}</span>
                </span>
                <PmsButton variant="secondary" size="sm" loading={busy === "check"} onClick={() => void run("check", () => checkPaymentLinksAction(inv.id), "Checked for payments")} data-testid="check-payment">
                  <RefreshCw aria-hidden />
                  Check for payment
                </PmsButton>
              </div>
            ) : null}
            <div className="flex justify-between border-t-2 border-border pt-3 text-base font-semibold">
              <span>Balance</span>
              <span className="tabular-nums" data-testid="invoice-balance">
                {inv.balancePence < 0 ? `${money(-inv.balancePence)} owed back` : money(inv.balancePence)}
              </span>
            </div>
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-3" aria-label="PDF preview">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">PDF preview</h2>
            {issued ? (
              <Link href={`${BILLING_PATH}/invoices/${inv.id}/print`} className={cn(pmsButtonVariants({ variant: "secondary", size: "sm" }), "ml-auto")} data-testid="print-invoice-link">
                <Download aria-hidden />
                Download
              </Link>
            ) : null}
            {issued && !isVoid ? <EmailInvoiceButton invoiceId={inv.id} /> : null}
          </div>
          <div className="overflow-hidden rounded-xl bg-[#E2E8F0] p-4" aria-hidden>
            <div className="h-[560px] w-full overflow-hidden">
              <div className="origin-top-left scale-[0.42] shadow-lg">
                <PrintInvoiceSheet clinic={clinic} invoice={inv} howToPay={howToPay} printedBy={printedBy} printedAt={printedAt} demo={demo} />
              </div>
            </div>
          </div>
        </aside>
      </div>

      <TakePaymentDialog open={payOpen} onOpenChange={setPayOpen} patientId={inv.patient.id} invoiceId={inv.id} context={`invoice ${inv.number ?? ""}`.trim()} onDone={() => router.refresh()} />

      <ConfirmDialog
        open={dialog === "issue"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Issue this invoice?"
        description="It gets the next invoice number and can no longer be changed – only credited."
        confirmLabel="Issue invoice"
        pending={busy === "issue"}
        onConfirm={() => void run("issue", () => issueInvoiceAction(inv.id, inv.rev), "Invoice issued")}
      />
      <ConfirmDialog
        open={dialog === "cancel"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Cancel this draft?"
        description="The draft is kept as cancelled and its visits can be invoiced again."
        confirmLabel="Cancel draft"
        cancelLabel="Keep draft"
        destructive
        pending={busy === "cancel"}
        onConfirm={() => void run("cancel", () => cancelDraftAction(inv.id, inv.rev), "Draft cancelled")}
      />
      <ConfirmDialog
        open={dialog === "credit"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Credit note"
        description={`Takes money off this invoice with its own number. Up to ${money(inv.totalPence - inv.creditedPence)}.`}
        confirmLabel="Issue credit note"
        pending={busy === "credit"}
        onConfirm={() => {
          const pence = parsePounds(amount);
          if (pence === null || pence <= 0) return setError("Enter the amount to credit.");
          void run("credit", () => creditNoteAction(inv.id, pence, reason), "Credit note issued");
        }}
      >
        <MoneyAndReason amount={amount} setAmount={setAmount} reason={reason} setReason={setReason} error={error} />
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "refund"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Refund"
        description="Gives money back. Anything not yet credited on the invoice is credited first. A card payment taken through the payment provider goes back to the card (test mode)."
        confirmLabel="Refund"
        pending={busy === "refund"}
        onConfirm={() => {
          const pence = parsePounds(amount);
          if (pence === null || pence <= 0) return setError("Enter the amount to refund.");
          void run("refund", () => refundAction(inv.id, pence, refundMethod, reason), "Refund recorded");
        }}
      >
        <MoneyAndReason amount={amount} setAmount={setAmount} reason={reason} setReason={setReason} error={error} />
        <label className="flex flex-col gap-1 text-sm font-medium">
          How it goes back
          <select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value as typeof refundMethod)} className={cn("h-9 rounded-[8px] border border-[#94A3B8] px-2", focusRing)}>
            <option value="card">To the card</option>
            <option value="cash">Cash</option>
            <option value="bank_transfer">Bank transfer</option>
          </select>
        </label>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "void"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Void this invoice?"
        description="A credit note cancels everything on it and its visits can be invoiced again. Not possible while payments are on it."
        confirmLabel="Void invoice"
        cancelLabel="Keep invoice"
        destructive
        pending={busy === "void"}
        onConfirm={() => void run("void", () => voidInvoiceAction(inv.id, reason), "Invoice voided")}
      >
        <label className="flex flex-col gap-1 text-sm font-medium">
          Why
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={cn("h-9 rounded-[8px] border border-[#94A3B8] px-2", focusRing)} data-testid="void-reason" />
        </label>
        {error ? (
          <span role="alert" className="text-xs text-destructive-strong">
            {error}
          </span>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

function MoneyAndReason({ amount, setAmount, reason, setReason, error }: { amount: string; setAmount: (v: string) => void; reason: string; setReason: (v: string) => void; error: string | null }) {
  return (
    <>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Amount (£)
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={cn("h-9 rounded-[8px] border border-[#94A3B8] px-2 tabular-nums", focusRing)} data-testid="money-amount" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Why
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className={cn("h-9 rounded-[8px] border border-[#94A3B8] px-2", focusRing)} data-testid="money-reason" />
      </label>
      {error ? (
        <span role="alert" className="text-xs text-destructive-strong">
          {error}
        </span>
      ) : null}
    </>
  );
}
