import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClinicActor } from "@/server/pms/actor";
import { payoutsFor } from "@/server/pms/billing/connect/service";
import { cardPaymentsAvailable } from "@/server/pms/billing/connect/screen";
import { CARD_COPY } from "@/modules/pms/billing/card-payments";
import { formatPence } from "@/modules/pms/core/text";
import { CLINIC_BASE_PATH } from "@/modules/pms/core/modules";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Card payouts and fees" };

const TYPE: Record<string, string> = { charge: "Card payment", payment: "Card payment", refund: "Refund", payment_refund: "Refund", application_fee: "Platform fee", adjustment: "Adjustment", dispute: "Dispute" };

/**
 * /app/clinic/billing/payouts (cp05): the clinic's own payment account – balance, payouts to the bank, and each card
 * movement with the payment provider's fee, the platform fee and the net, matched to the clinic's invoices. Read live
 * from the provider (nothing stored). billing.view + billing.refund (owners and admins by default). Behind
 * CLINFORMS_CARD_PAYMENTS=on.
 */
export default async function PayoutsPage({ searchParams }: { searchParams: { payout?: string } }) {
  if (!cardPaymentsAvailable()) notFound();
  const actor = await requireClinicActor({ permission: "billing.refund" });
  const payout = typeof searchParams.payout === "string" && /^po_[A-Za-z0-9_]{6,200}$/.test(searchParams.payout) ? searchParams.payout : null;
  const r = await payoutsFor(actor, { payout });
  if (!r.ok) return <p role="alert">{r.error}</p>;
  const v = r.value;
  return (
    <div className="flex flex-col gap-6" data-testid="card-payouts">
      <div>
        <h1 className="text-2xl font-semibold">Card payouts and fees</h1>
        <p className="text-sm text-[#475569]">Money taken by card into the clinic&apos;s own payment account, the fees taken from it, and what is paid out to the clinic&apos;s bank.</p>
        {v?.testMode ? <p className="mt-1 text-xs text-[#475569]">{CARD_COPY.testBanner}</p> : null}
      </div>
      {!v ? (
        <p className="text-sm">{CARD_COPY.notReady}</p>
      ) : (
        <>
          <dl className="grid max-w-md grid-cols-2 gap-2 text-sm">
            <dt className="text-[#475569]">Available to pay out</dt>
            <dd className="text-right tabular-nums">{formatPence(v.balance.availablePence)}</dd>
            <dt className="text-[#475569]">On its way (pending)</dt>
            <dd className="text-right tabular-nums">{formatPence(v.balance.pendingPence)}</dd>
          </dl>
          <section>
            <h2 className="mb-2 text-lg font-semibold">Payouts</h2>
            {v.payouts.length === 0 ? <p className="text-sm text-[#475569]">No payouts yet.</p> : null}
            <ul className="flex flex-wrap gap-2">
              <li>
                <Link href={`${CLINIC_BASE_PATH}/billing/payouts`} className={`inline-flex rounded-md border px-3 py-1 text-sm ${v.selected ? "border-border" : "border-primary bg-[#E6F4F2]"}`}>
                  Latest card movements
                </Link>
              </li>
              {v.payouts.map((p) => (
                <li key={p.id}>
                  <Link href={`${CLINIC_BASE_PATH}/billing/payouts?payout=${encodeURIComponent(p.id)}`} className={`inline-flex rounded-md border px-3 py-1 text-sm ${v.selected === p.id ? "border-primary bg-[#E6F4F2]" : "border-border"}`}>
                    {p.arrivalOn} · {formatPence(p.amountPence)} · {p.status}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="mb-2 text-lg font-semibold">{v.selected ? "In this payout" : "Latest card movements"}</h2>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-[#F8FAFC] text-left text-[#475569]">
                  <tr>
                    <th className="px-3 py-2 font-medium">What</th>
                    <th className="px-3 py-2 font-medium">Invoice</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-3 py-2 text-right font-medium">Provider fee</th>
                    <th className="px-3 py-2 text-right font-medium">Platform fee</th>
                    <th className="px-3 py-2 text-right font-medium">Net</th>
                    <th className="px-3 py-2 font-medium">Available</th>
                  </tr>
                </thead>
                <tbody>
                  {v.lines.map((l) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="px-3 py-2">{TYPE[l.type] ?? l.type}</td>
                      <td className="px-3 py-2">{l.invoiceId ? <Link className="text-primary-strong underline" href={`${CLINIC_BASE_PATH}/billing/invoices/${encodeURIComponent(l.invoiceId)}`}>{l.invoiceNumber ?? "Invoice"}</Link> : "–"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatPence(l.grossPence)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatPence(l.providerFeePence)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatPence(l.platformFeePence)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatPence(l.netPence)}</td>
                      <td className="px-3 py-2">{l.availableOn}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border font-semibold">
                    <td className="px-3 py-2" colSpan={2}>
                      Total
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatPence(v.totals.grossPence)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatPence(v.totals.providerFeePence)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatPence(v.totals.platformFeePence)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatPence(v.totals.netPence)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
