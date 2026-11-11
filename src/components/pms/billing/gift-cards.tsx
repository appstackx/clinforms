"use client";
/**
 * Gift cards (PK04): Billing → Gift cards (the clinic's cards, what they still hold, look one up by its code, a card's
 * history) and the patient's Invoices tab (their cards, Sell a gift card – the code is shown ONCE, to write on the
 * card). Codes are never put in a URL. The server checks every action again.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { lookUpGiftCardAction, sellGiftCardAction } from "@/app/app/clinic/billing/actions";
import type { GiftCardRowView, GiftCardsScreen } from "@/modules/pms/billing/gift-cards";
import { cn } from "@/lib/utils";
import { FormField, PmsButton, PmsNotice, SelectInput, TextInput, useToast } from "@/components/pms/ui";
import { ScrollRegion } from "@/components/pms/ui/scroll-region";
import { BILLING_PATH, date, focusRing, money, parsePounds } from "./format";

function CardsTable({ rows, caption, showBuyer }: { rows: GiftCardRowView[]; caption: string; showBuyer: boolean }) {
  return (
    <ScrollRegion label={caption} className="relative overflow-x-auto rounded-xl border border-border bg-white">
      <table className="w-full min-w-[640px] text-sm" data-testid="gift-cards-table">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-[#F8FAFC] text-left text-xs font-semibold text-[#334155]">
          <tr>
            <th scope="col" className="px-4 py-2">Card</th>
            {showBuyer ? <th scope="col" className="px-3 py-2">Bought by</th> : null}
            <th scope="col" className="px-3 py-2">Sold</th>
            <th scope="col" className="px-3 py-2">Status</th>
            <th scope="col" className="px-4 py-2 text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="px-4 py-2.5">
                <Link href={`${BILLING_PATH}/gift-cards?card=${r.id}`} className={cn("font-mono font-semibold text-primary-strong underline underline-offset-2", focusRing)}>
                  {r.masked}
                </Link>
              </td>
              {showBuyer ? <td className="px-3 py-2.5">{r.buyerName ?? "–"}</td> : null}
              <td className="px-3 py-2.5 tabular-nums">{date(r.soldOn)}</td>
              <td className="px-3 py-2.5">{r.stateLabel}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{r.state === "pending" ? money(r.initialPence) : r.balance}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

export function GiftCardsScreenView({ screen }: { screen: GiftCardsScreen }) {
  const router = useRouter();
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const c = screen.card;
  async function lookUp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await lookUpGiftCardAction(code);
    setBusy(false);
    if (!r.ok) setError(r.error);
    else {
      setCode("");
      router.push(`${BILLING_PATH}/gift-cards?card=${r.cardId}`);
    }
  }
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1180px] flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-[#475569]">
        <Link href={BILLING_PATH} className={cn("text-primary-strong underline underline-offset-2", focusRing)}>
          Billing
        </Link>
        <span aria-hidden> / </span>
        <span>Gift cards</span>
      </nav>
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Gift cards</h1>
        <p className="text-sm text-[#475569]">
          Active cards still hold <strong className="text-foreground">{money(screen.outstandingPence)}</strong>. Sell one from a patient&apos;s Invoices tab; spend one with Take payment → Gift card.
        </p>
      </div>
      <form onSubmit={(e) => void lookUp(e)} className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-white p-4">
        <FormField id="gift-lookup" label="Look up a card by its code" error={error ?? undefined}>
          <TextInput value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX" autoComplete="off" spellCheck={false} maxLength={20} className="font-mono uppercase" data-testid="gift-lookup" />
        </FormField>
        <PmsButton type="submit" loading={busy} disabled={!code.trim()}>
          Look up
        </PmsButton>
      </form>
      {c ? (
        <section className="flex flex-col gap-3 rounded-xl border border-border bg-white p-4" data-testid="gift-card-detail" aria-label="Gift card">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base font-semibold">{c.masked}</span>
            <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-xs font-semibold text-[#334155]">{c.stateLabel}</span>
            <span className="text-sm tabular-nums text-[#334155]">{c.state === "pending" ? `${money(c.initialPence)} once its invoice is issued` : c.balance}</span>
          </div>
          <p className="text-sm text-[#475569]">
            {c.buyerName ? `Bought by ${c.buyerName}` : "Buyer not recorded"}
            {c.recipientName ? ` · for ${c.recipientName}` : ""}
            {c.saleInvoiceId ? (
              <>
                {" · "}
                <Link href={`${BILLING_PATH}/invoices/${c.saleInvoiceId}`} className={cn("text-primary-strong underline underline-offset-2", focusRing)}>
                  sale invoice
                </Link>
              </>
            ) : null}
          </p>
          {c.moves.length ? (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border text-sm" aria-label="History">
              {c.moves.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                  <span className="tabular-nums">{date(m.createdAt.slice(0, 10))}</span>
                  <span>{m.label}</span>
                  <span className="ml-auto tabular-nums">{m.amountPence < 0 ? `−${money(-m.amountPence)}` : money(m.amountPence)}</span>
                  <span className="w-28 text-right tabular-nums text-[#475569]">left {money(m.balanceAfter)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[#475569]">Nothing spent yet.</p>
          )}
        </section>
      ) : null}
      {screen.rows.length === 0 ? <p className="text-sm text-[#475569]">No gift cards sold yet.</p> : <CardsTable rows={screen.rows} caption="Gift cards" showBuyer />}
    </div>
  );
}

/** The patient's Invoices tab: the cards they bought and Sell a gift card. */
export function PatientGiftCards({ patientId, rows, canSell, sites, siteRequired }: { patientId: string; rows: GiftCardRowView[]; canSell: boolean; sites: { id: string; name: string }[]; siteRequired: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState("50.00");
  const [recipient, setRecipient] = React.useState("");
  const [siteId, setSiteId] = React.useState(siteRequired && sites.length === 1 ? sites[0].id : "");
  const [busy, setBusy] = React.useState<"draft" | "issue" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [sold, setSold] = React.useState<{ code: string; invoiceId: string; issued: boolean; expiresOn: string | null; issueProblem: string | null } | null>(null);

  async function sell(issue: boolean) {
    const pence = parsePounds(amount);
    if (pence === null) return setError("Enter the card's value, e.g. 50.00.");
    setBusy(issue ? "issue" : "draft");
    setError(null);
    const r = await sellGiftCardAction(patientId, { amountPence: pence, recipientName: recipient.trim() || null, siteId: siteId || null, issue });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setSold({ code: r.code, invoiceId: r.invoiceId, issued: r.issued, expiresOn: r.expiresOn, issueProblem: r.issueProblem });
    setOpen(false);
    if (r.issueProblem) toast.error("The invoice could not be issued – write the code on the card, then issue the invoice");
    else toast.success(r.issued ? "Gift card sold – write the code on the card" : "Draft invoice made – the card can be spent once it is issued");
    router.refresh();
  }

  return (
    <section aria-labelledby="gift-cards-heading" className="flex flex-col gap-3" data-testid="patient-gift-cards">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="gift-cards-heading" className="text-lg font-semibold text-foreground">
            Gift cards
          </h2>
          <p className="text-sm text-[#475569]">{rows.length === 0 ? "No gift cards bought." : `${rows.length} gift card${rows.length === 1 ? "" : "s"} bought`}</p>
        </div>
        {canSell && !open ? (
          <PmsButton variant="secondary" onClick={() => setOpen(true)} data-testid="sell-gift-card">
            Sell a gift card
          </PmsButton>
        ) : null}
      </div>
      {sold ? (
        <PmsNotice tone="info" title="Write this code on the gift card now">
          <span className="block font-mono text-xl font-semibold tracking-widest" data-testid="gift-card-code-once">
            {sold.code}
          </span>
          It is shown only this once – the clinic keeps no readable copy.
          {sold.issued && sold.expiresOn ? ` Valid until ${date(sold.expiresOn)}.` : " The card can be spent once its invoice is issued."}{" "}
          {sold.issueProblem ? (
            <span className="block font-medium text-destructive-strong" role="alert" data-testid="gift-card-issue-problem">
              {sold.issueProblem}
            </span>
          ) : null}
          <Link href={`${BILLING_PATH}/invoices/${sold.invoiceId}`} className={cn("text-primary-strong underline underline-offset-2", focusRing)}>
            Open the invoice
          </Link>
        </PmsNotice>
      ) : null}
      {open ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-white p-4" data-testid="sell-gift-card-form">
          <h3 className="text-base font-semibold">Sell a gift card</h3>
          <div className="grid gap-3 md:grid-cols-3">
            <FormField id="gift-amount" label="Value (£)" required>
              <TextInput inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="gift-amount" />
            </FormField>
            <FormField id="gift-recipient" label="For (optional)" hint="The name to write on the card.">
              <TextInput value={recipient} onChange={(e) => setRecipient(e.target.value)} maxLength={80} />
            </FormField>
            {sites.length > 0 ? (
              <FormField id="gift-site" label={siteRequired ? "Site" : "Site (optional)"} required={siteRequired}>
                <SelectInput value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                  {!siteRequired || sites.length > 1 ? <option value="">{siteRequired ? "Choose a site" : "No particular site"}</option> : null}
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </SelectInput>
              </FormField>
            ) : null}
          </div>
          <p className="text-sm text-[#475569]">The invoice goes to this patient. No VAT is charged on a gift card – VAT is charged on what it is spent on. It is valid for 24 months from the sale.</p>
          {error ? (
            <p role="alert" className="text-sm text-destructive-strong">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <PmsButton variant="secondary" onClick={() => setOpen(false)} disabled={busy !== null}>
              Cancel
            </PmsButton>
            <PmsButton variant="secondary" loading={busy === "draft"} onClick={() => void sell(false)}>
              Create draft invoice
            </PmsButton>
            <PmsButton loading={busy === "issue"} onClick={() => void sell(true)} data-testid="sell-gift-card-issue">
              Sell and issue invoice
            </PmsButton>
          </div>
        </div>
      ) : null}
      {rows.length > 0 ? <CardsTable rows={rows} caption="Gift cards bought" showBuyer={false} /> : null}
    </section>
  );
}
