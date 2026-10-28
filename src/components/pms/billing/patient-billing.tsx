"use client";
/**
 * The billing parts of a patient's record: the Account card on the overview (patient balance, what insurers owe on
 * their cases, the saved card, Take payment) and the Invoices tab (their invoices; Take payment opens straight away
 * with ?pay=1 – the record's "Take payment" button).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { CreditCard } from "lucide-react";
import { saveTestCardAction } from "@/app/app/clinic/billing/actions";
import type { InvoiceRowView, PatientAccountView } from "@/modules/pms/billing/view";
import { cn } from "@/lib/utils";
import { PmsButton, StatusPill, useToast } from "@/components/pms/ui";
import { BILLING_PATH, date, focusRing, money } from "./format";
import { TakePaymentDialog } from "./take-payment-dialog";

export function PatientAccountCard({ patientId, account, canPay }: { patientId: string; account: PatientAccountView; canPay: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="flex flex-col gap-3" data-testid="account-card">
      <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
        <dt className="text-[#475569]">Patient owes</dt>
        <dd className={cn("text-right font-semibold tabular-nums", account.patientBalancePence > 0 ? "text-destructive-strong" : "text-foreground")} data-testid="account-patient-balance">
          {money(account.patientBalancePence)}
        </dd>
        <dt className="text-[#475569]">Insurers / accounts owe</dt>
        <dd className="text-right tabular-nums">{money(account.accountsBalancePence)}</dd>
        {account.creditOnAccountPence > 0 ? (
          <>
            <dt className="text-[#475569]">Credit on account</dt>
            <dd className="text-right tabular-nums">{money(account.creditOnAccountPence)}</dd>
          </>
        ) : null}
        <dt className="text-[#475569]">Saved card</dt>
        <dd className="text-right">{account.savedCard ? account.savedCard.label.replace(/ · expires.*$/, "") : "None"}</dd>
      </dl>
      {account.overdueCount > 0 ? <p className="text-xs text-destructive-strong">{account.overdueCount} overdue invoice{account.overdueCount === 1 ? "" : "s"}</p> : null}
      <div className="flex flex-wrap gap-2">
        {canPay ? (
          <PmsButton size="sm" onClick={() => setOpen(true)} data-testid="account-take-payment">
            <CreditCard aria-hidden />
            Take payment
          </PmsButton>
        ) : null}
        {canPay && !account.savedCard && account.canSaveTestCard ? (
          <PmsButton
            size="sm"
            variant="secondary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              const r = await saveTestCardAction(patientId);
              setBusy(false);
              if (!r.ok) toast.error(r.error);
              else {
                toast.success(`${r.label} saved (test mode)`);
                router.refresh();
              }
            }}
          >
            Save a test card
          </PmsButton>
        ) : null}
      </div>
      <TakePaymentDialog open={open} onOpenChange={setOpen} patientId={patientId} context="patient record" onDone={() => router.refresh()} />
    </div>
  );
}

export function PatientInvoices({ patientId, rows, balancePence, canPay, openPay }: { patientId: string; rows: InvoiceRowView[]; balancePence: number; canPay: boolean; openPay: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(openPay && canPay);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Invoices</h2>
          <p className="text-sm text-[#475569]">
            {rows.length} invoice{rows.length === 1 ? "" : "s"} · the patient owes <strong className="text-foreground">{money(balancePence)}</strong>
          </p>
        </div>
        {canPay ? (
          <PmsButton onClick={() => setOpen(true)} data-testid="invoices-take-payment">
            <CreditCard aria-hidden />
            Take payment
          </PmsButton>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-[#475569]">No invoices yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Invoices</caption>
            <thead className="bg-[#F8FAFC] text-left text-xs font-semibold text-[#334155]">
              <tr>
                <th scope="col" className="px-4 py-2">Invoice</th>
                <th scope="col" className="px-3 py-2">Bill to</th>
                <th scope="col" className="px-3 py-2">Issued</th>
                <th scope="col" className="px-3 py-2">Due</th>
                <th scope="col" className="px-3 py-2">Status</th>
                <th scope="col" className="px-3 py-2 text-right">Total</th>
                <th scope="col" className="px-4 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-2.5">
                    <Link href={`${BILLING_PATH}/invoices/${r.id}`} className={cn("font-semibold text-primary-strong underline underline-offset-2", focusRing)}>
                      {r.number ?? "Draft"}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">{r.billToName}</td>
                  <td className="px-3 py-2.5 tabular-nums">{date(r.issuedOn)}</td>
                  <td className="px-3 py-2.5 tabular-nums">{date(r.dueOn)}</td>
                  <td className="px-3 py-2.5">
                    <StatusPill kind="invoice" status={r.state} size="sm" />
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(r.totalPence)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{money(Math.max(0, r.balancePence))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <TakePaymentDialog open={open} onOpenChange={setOpen} patientId={patientId} context="patient record" onDone={() => router.refresh()} />
    </div>
  );
}
