"use client";
/**
 * The patient portal's card section (the clinic's own payment account): invoices to pay ("Pay now" opens the
 * payment provider's secure payment page) and "Save a card for future payments" with the exact words the patient
 * agrees to. Browser-safe; the server actions check the portal session.
 */
import * as React from "react";
import { CreditCard } from "lucide-react";

export interface PortalCardsProps {
  clinicId: string;
  invoices: { id: string; number: string; dueOn: string | null; balancePence: number }[];
  testMode: boolean;
  savedCards: string[];
  consent: { plain: string; withNoShow: string | null };
  pay: (clinicId: string, invoiceId: string) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
  save: (clinicId: string, input: { agreed: boolean; allowsNoShow: boolean }) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
}

const money = (p: number) => `£${(p / 100).toFixed(2)}`;
const focus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

export function PortalCards({ clinicId, invoices, testMode, savedCards, consent, pay, save }: PortalCardsProps) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const [agreed, setAgreed] = React.useState(false);
  const [noShow, setNoShow] = React.useState(false);
  const go = async (key: string, work: () => Promise<{ ok: true; url: string } | { ok: false; error: string }>) => {
    setBusy(key);
    setError(null);
    const r = await work();
    if (!r.ok) {
      setBusy(null);
      setError(r.error);
      return;
    }
    window.location.assign(r.url);
  };
  return (
    <section aria-labelledby="pt-pay" className="space-y-3" data-testid="portal-cards">
      <h2 id="pt-pay" className="text-[17px] font-semibold text-foreground">
        Payments
      </h2>
      {testMode ? <p className="text-[13px] text-[#334155]">Test mode – no real card is charged.</p> : null}
      {error ? (
        <p role="alert" className="rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] p-3 text-[14px] text-[#991B1B]">
          {error}
        </p>
      ) : null}
      {invoices.length === 0 ? <p className="text-[14px] text-[#334155]">Nothing to pay.</p> : null}
      <ul className="space-y-2">
        {invoices.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-3 rounded-[12px] border border-border bg-white p-3" data-testid="portal-invoice">
            <span>
              <strong className="block text-[15px] text-foreground">Invoice {i.number}</strong>
              <span className="block text-[13px] text-[#334155]">
                {money(i.balancePence)} to pay{i.dueOn ? ` · due ${i.dueOn}` : ""}
              </span>
            </span>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => go(i.id, () => pay(clinicId, i.id))}
              className={`inline-flex min-h-11 items-center gap-2 rounded-[8px] bg-primary-strong px-4 text-[15px] font-medium text-white disabled:opacity-60 ${focus}`}
              data-testid="portal-pay"
            >
              <CreditCard className="h-4 w-4" aria-hidden />
              {busy === i.id ? "Opening…" : "Pay now"}
            </button>
          </li>
        ))}
      </ul>
      {savedCards.length > 0 ? <p className="text-[14px] text-[#334155]">Saved card: {savedCards.join(", ")}</p> : null}
      {open ? (
        <div className="space-y-3 rounded-[12px] border border-border bg-white p-3">
          <p className="text-[14px] text-foreground">{noShow && consent.withNoShow ? consent.withNoShow : consent.plain}</p>
          {consent.withNoShow ? (
            <label className="flex items-start gap-2 text-[14px]">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={noShow} onChange={(e) => setNoShow(e.target.checked)} />
              <span>I also agree to the missed-appointment charges described above</span>
            </label>
          ) : null}
          <label className="flex items-start gap-2 text-[14px]">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} data-testid="portal-consent" />
            <span>I agree</span>
          </label>
          <button
            type="button"
            disabled={!agreed || busy !== null}
            onClick={() => go("save", () => save(clinicId, { agreed, allowsNoShow: noShow }))}
            className={`inline-flex min-h-11 items-center rounded-[8px] bg-primary-strong px-4 text-[15px] font-medium text-white disabled:opacity-60 ${focus}`}
            data-testid="portal-save-card"
          >
            {busy === "save" ? "Opening…" : "Continue to the secure card form"}
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={`min-h-11 text-[14px] font-medium text-primary-strong underline underline-offset-[3px] ${focus}`}>
          Save a card for future payments
        </button>
      )}
    </section>
  );
}
