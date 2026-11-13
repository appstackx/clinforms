"use client";
/**
 * Card payments on an invoice (the clinic's own payment account): send the balance to a card reader at the desk
 * (check / cancel; in test mode tap a test card), charge a saved card (missed-appointment fees only with the
 * patient's consent and the clinic's policy), and refund a card payment back to the card (billing.refund).
 * No card number is ever typed here: cards go on the reader or the payment provider's own pages.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { CreditCard } from "lucide-react";
import { FormField, PmsButton, PmsNotice, SelectInput, TextInput, useToast } from "@/components/pms/ui";
import { CARD_COPY, type InvoiceCardView } from "@/modules/pms/billing/card-payments";
import { formatPence } from "@/modules/pms/core/text";
import {
  cancelReaderPaymentAction,
  chargeSavedCardAction,
  checkCardPaymentAction,
  refundCardPaymentAction,
  simulateReaderTapAction,
  startReaderPaymentAction,
} from "@/app/app/clinic/billing/card-actions";

const pounds = (v: string): number | undefined => {
  const t = v.trim();
  if (!t) return undefined;
  const n = Math.round(Number(t.replace(/[£,\s]/g, "")) * 100);
  return Number.isFinite(n) ? n : NaN;
};

export function InvoiceCardPanel({ view }: { view: InvoiceCardView }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [readerId, setReaderId] = React.useState(view.readers[0]?.id ?? "");
  const [cardId, setCardId] = React.useState(view.savedCards[0]?.id ?? "");
  const [amount, setAmount] = React.useState("");
  const run = async <T extends object>(key: string, work: () => Promise<{ ok: true; value: T } | { ok: false; error: string }>, success?: (v: T) => string | null) => {
    setBusy(key);
    setError(null);
    const r = await work();
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const v = r.value as T & { message?: string };
    const msg = success ? success(r.value) : (typeof v.message === "string" ? v.message : null);
    if (msg) toast.success(msg);
    router.refresh();
  };
  const owing = view.balancePence > 0;
  const amountPence = pounds(amount);

  return (
    <section aria-labelledby="card-panel-title" className="rounded-lg border border-border bg-white p-4" data-testid="invoice-card-panel">
      <h2 id="card-panel-title" className="mb-3 flex items-center gap-2 text-base font-semibold">
        <CreditCard className="h-4 w-4" aria-hidden />
        Card payments
      </h2>
      {view.testMode ? <p className="mb-3 text-xs text-[#475569]">{CARD_COPY.testBanner}</p> : null}
      {error ? (
        <div className="mb-3">
          <PmsNotice tone="error" title="That did not work">
            {error}
          </PmsNotice>
        </div>
      ) : null}

      {view.pendingReader ? (
        <div className="mb-4 flex flex-col gap-2 rounded-md border border-[#FBD38D] bg-[#FFFBEB] p-3" data-testid="card-pending">
          <p className="text-sm">
            {view.pendingReader.onReader ? (
              <>
                Waiting for the card on <strong>{view.pendingReader.readerLabel}</strong> – {formatPence(view.pendingReader.amountPence)}.
              </>
            ) : (
              <>A charge of {formatPence(view.pendingReader.amountPence)} to the saved card is waiting for the payment provider&apos;s answer. Check it before trying again.</>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <PmsButton size="sm" loading={busy === "check"} onClick={() => run("check", () => checkCardPaymentAction(view.invoiceId, view.pendingReader!.intentId))} data-testid="card-check">
              Check payment
            </PmsButton>
            <PmsButton size="sm" variant="secondary" loading={busy === "cancel"} onClick={() => run("cancel", () => cancelReaderPaymentAction(view.invoiceId, view.pendingReader!.intentId), (v) => (v.status === "succeeded" ? "It had already gone through – recorded." : "Cancelled. Nothing was taken."))}>
              {view.pendingReader.onReader ? "Cancel on the reader" : "Cancel"}
            </PmsButton>
            {view.testMode && view.pendingReader.onReader ? (
              <>
                <PmsButton size="sm" variant="secondary" loading={busy === "tap"} onClick={() => run("tap", () => simulateReaderTapAction(view.invoiceId, view.pendingReader!.intentId, false))} data-testid="card-test-tap">
                  Tap a test card
                </PmsButton>
                <PmsButton size="sm" variant="ghost" loading={busy === "tapd"} onClick={() => run("tapd", () => simulateReaderTapAction(view.invoiceId, view.pendingReader!.intentId, true))}>
                  Tap a declined test card
                </PmsButton>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {view.ready && owing && view.can.pay && !view.pendingReader ? (
        <div className="mb-4 flex flex-col gap-3">
          <FormField id="card-amount" label="Amount (£)" hint={`Leave empty for the full balance of ${formatPence(view.balancePence)}.`}>
            <TextInput inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={(view.balancePence / 100).toFixed(2)} className="max-w-[10rem]" data-testid="card-amount" />
          </FormField>
          {view.readers.length > 0 ? (
            <div className="flex flex-wrap items-end gap-2">
              <FormField id="card-reader" label="Card reader">
                <SelectInput value={readerId} onChange={(e) => setReaderId(e.target.value)}>
                  {view.readers.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                      {r.simulated ? " (test)" : ""}
                    </option>
                  ))}
                </SelectInput>
              </FormField>
              <PmsButton loading={busy === "reader"} disabled={Number.isNaN(amountPence)} onClick={() => run("reader", () => startReaderPaymentAction(view.invoiceId, readerId, amountPence), () => "Sent to the card reader – ask the patient to tap or insert their card.")} data-testid="card-send-reader">
                Send to card reader
              </PmsButton>
            </div>
          ) : (
            <p className="text-sm text-[#475569]">No card reader yet – the owner adds one in Set-up → Card payments.</p>
          )}
          {view.savedCards.length > 0 ? (
            <div className="flex flex-wrap items-end gap-2">
              <FormField id="card-saved" label="Saved card">
                <SelectInput value={cardId} onChange={(e) => setCardId(e.target.value)}>
                  {view.savedCards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                      {view.noShow && !c.allowsNoShow ? " – no consent for missed-appointment fees" : ""}
                    </option>
                  ))}
                </SelectInput>
              </FormField>
              <PmsButton variant="secondary" loading={busy === "saved"} disabled={Number.isNaN(amountPence)} onClick={() => run("saved", () => chargeSavedCardAction(view.invoiceId, cardId, amountPence))} data-testid="card-charge-saved">
                Charge saved card
              </PmsButton>
            </div>
          ) : null}
          {view.noShow ? <p className="text-xs text-[#475569]">This invoice is a missed-appointment or late-cancellation fee: a saved card can be charged only with the patient&apos;s consent and the clinic&apos;s policy on.</p> : null}
        </div>
      ) : null}

      {view.cardPayments.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Paid by card</h3>
          <ul className="divide-y divide-border rounded-md border border-border">
            {view.cardPayments.map((p) => (
              <CardPaymentRow key={p.paymentId} invoiceId={view.invoiceId} p={p} canRefund={view.can.refund} busy={busy} run={run} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function CardPaymentRow({
  invoiceId,
  p,
  canRefund,
  busy,
  run,
}: {
  invoiceId: string;
  p: InvoiceCardView["cardPayments"][number];
  canRefund: boolean;
  busy: string | null;
  run: (key: string, work: () => Promise<{ ok: true; value: { refundedPence: number } } | { ok: false; error: string }>, success?: (v: { refundedPence: number }) => string | null) => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState((p.refundablePence / 100).toFixed(2));
  const [reason, setReason] = React.useState("");
  return (
    <li className="flex flex-col gap-2 px-3 py-2 text-sm" data-testid="card-payment-row">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          {p.label} · {formatPence(p.amountPence)} on {p.receivedOn}
          {p.refundedPence > 0 ? <span className="ml-2 text-[#475569]">({formatPence(p.refundedPence)} refunded)</span> : null}
        </span>
        {canRefund && p.refundablePence > 0 ? (
          <PmsButton size="sm" variant="secondary" onClick={() => setOpen((v) => !v)} data-testid="card-refund-open">
            Refund to card
          </PmsButton>
        ) : null}
      </div>
      {open ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(`refund-${p.paymentId}`, () => refundCardPaymentAction(invoiceId, { paymentId: p.paymentId, amountPence: Math.round(Number(amount) * 100), reason }), (v) => `${formatPence(v.refundedPence)} refunded to the card.`);
          }}
        >
          <FormField id={`refund-amount-${p.paymentId}`} label={`Amount (£, up to ${formatPence(p.refundablePence)})`}>
            <TextInput inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="max-w-[10rem]" data-testid="card-refund-amount" />
          </FormField>
          <FormField id={`refund-reason-${p.paymentId}`} label="Reason">
            <TextInput value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} data-testid="card-refund-reason" />
          </FormField>
          <PmsButton type="submit" variant="destructive" loading={busy === `refund-${p.paymentId}`} data-testid="card-refund-submit">
            Refund
          </PmsButton>
        </form>
      ) : null}
    </li>
  );
}
