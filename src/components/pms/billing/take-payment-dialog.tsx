"use client";
/**
 * Take payment (design round 3 "Take payment – dialog" and "– 375 px"): full balance or a part payment, the method
 * (card on file, card now, cash, bank transfer, payment link), what it pays towards (oldest first, or changed by
 * hand) and the receipt. On a phone it is a full-screen sheet with the button fixed at the bottom.
 *
 * Card on file and payment links go through the payment provider in TEST MODE ONLY (no real card is charged);
 * card now (the front desk reader), cash and bank transfer are recorded as given. Opened from the diary's drawer,
 * the patient record and an invoice.
 */
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Banknote, Building2, Copy, CreditCard, Link2, Smartphone, X } from "lucide-react";
import { loadTakePaymentAction, takePaymentAction } from "@/app/app/clinic/billing/actions";
import { emailReceiptAction } from "@/app/app/clinic/messages/actions";
import type { TakePaymentMethod } from "@/modules/pms/billing/schemas";
import type { TakePaymentView } from "@/modules/pms/billing/view";
import { cn } from "@/lib/utils";
import { PmsButton, useToast } from "@/components/pms/ui";
import { date, focusRing, money, parsePounds, poundsText } from "./format";

export interface TakePaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string | null;
  /** "diary drawer · Owen Price, Fri 30/10 08:00" */
  context?: string | null;
  /** Paid towards this invoice first (opened from an invoice). */
  invoiceId?: string | null;
  onDone?: () => void;
}

const METHODS: { key: TakePaymentMethod; label: string; icon: React.ComponentType<{ className?: string }>; hint: (v: TakePaymentView) => string }[] = [
  { key: "card_on_file", label: "Card on file", icon: CreditCard, hint: (v) => (v.savedCards[0] ? v.savedCards[0].label : "No card saved") },
  { key: "card_now", label: "Card now", icon: Smartphone, hint: () => "Front desk card reader" },
  { key: "cash", label: "Cash", icon: Banknote, hint: () => "Work out change" },
  { key: "bank_transfer", label: "Bank transfer", icon: Building2, hint: () => "Record a transfer received" },
  { key: "payment_link", label: "Payment link", icon: Link2, hint: () => "Patient pays by text or email" },
];

export function TakePaymentDialog({ open, onOpenChange, patientId, context, invoiceId, onDone }: TakePaymentDialogProps) {
  const toast = useToast();
  const [view, setView] = React.useState<TakePaymentView | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [full, setFull] = React.useState(true);
  const [partText, setPartText] = React.useState("");
  const [method, setMethod] = React.useState<TakePaymentMethod>("card_now");
  const [cardId, setCardId] = React.useState<string | null>(null);
  const [tendered, setTendered] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [editAlloc, setEditAlloc] = React.useState(false);
  const [alloc, setAlloc] = React.useState<Record<string, string>>({});
  const [receipt, setReceipt] = React.useState<"none" | "print" | "email">("none");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{ message: string; links: { url: string; amountPence: number }[] } | null>(null);

  React.useEffect(() => {
    if (!open || !patientId) return;
    let live = true;
    setView(null);
    setLoadError(null);
    setDone(null);
    setError(null);
    setEditAlloc(false);
    setAlloc({});
    setFull(true);
    void loadTakePaymentAction(patientId, context ?? null).then((r) => {
      if (!live) return;
      if (!r.ok) {
        setLoadError(r.error);
        return;
      }
      setView(r.view);
      setCardId(r.view.savedCards[0]?.id ?? null);
      setMethod(r.view.savedCards.length && r.view.providerReady ? "card_on_file" : "card_now");
      setPartText(poundsText(Math.min(r.view.balancePence, r.view.invoices[0]?.balancePence ?? r.view.balancePence)));
    });
    return () => {
      live = false;
    };
  }, [open, patientId, context]);

  const ordered = React.useMemo(() => {
    if (!view) return [];
    if (!invoiceId) return view.invoices;
    const first = view.invoices.filter((i) => i.id === invoiceId);
    return [...first, ...view.invoices.filter((i) => i.id !== invoiceId)];
  }, [view, invoiceId]);

  const amount = view ? (full ? view.balancePence : (parsePounds(partText) ?? 0)) : 0;
  // Oldest first (or the invoice it was opened from first), never more than an invoice owes.
  const autoAlloc = React.useMemo(() => {
    let left = amount;
    return ordered.map((i) => {
      const take = Math.max(0, Math.min(left, i.balancePence));
      left -= take;
      return { invoiceId: i.id, amountPence: take };
    });
  }, [amount, ordered]);
  const allocations = editAlloc ? ordered.map((i) => ({ invoiceId: i.id, amountPence: parsePounds(alloc[i.id] ?? "0") ?? 0 })) : autoAlloc;
  const allocatedTotal = allocations.reduce((a, x) => a + x.amountPence, 0);
  const tenderedPence = parsePounds(tendered);
  const change = method === "cash" && tenderedPence !== null ? tenderedPence - amount : null;
  const linkBlocked = method === "payment_link" && (!view?.linksEnabled || !full);
  const cardBlocked = method === "card_on_file" && (!view?.providerReady || !cardId);

  async function submit() {
    if (!view || !patientId) return;
    setError(null);
    if (amount <= 0) return setError("Enter an amount.");
    if (editAlloc && allocatedTotal > amount) return setError("More is allocated than is being taken.");
    setBusy(true);
    const r = await takePaymentAction({
      patientId,
      method,
      amountPence: amount,
      allocations: allocations.filter((a) => a.amountPence > 0),
      savedCardId: method === "card_on_file" ? cardId : null,
      tenderedPence: method === "cash" && tenderedPence !== null ? tenderedPence : undefined,
      reference: reference.trim() || undefined,
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setDone({ message: r.result.message, links: r.result.links });
    toast.success(r.result.message);
    if (receipt === "email" && r.result.paymentId) {
      // The receipt by email through Messages (comms, M6): outbox / test service only.
      const sent = await emailReceiptAction(r.result.paymentId);
      if (sent.ok) toast.success(`Receipt: ${sent.sent.label}`);
      else toast.error(`Receipt not emailed: ${sent.error}`);
    }
    if (receipt === "print" && r.result.paymentId) {
      const first = allocations.find((a) => a.amountPence > 0);
      if (first) window.open(`/app/clinic/billing/invoices/${first.invoiceId}/print`, "_blank", "noopener");
    }
    onDone?.();
  }

  const title = (
    <div className="flex min-w-0 flex-col gap-0.5">
      <DialogPrimitive.Title className="text-lg font-semibold text-foreground">Take payment</DialogPrimitive.Title>
      <DialogPrimitive.Description className="text-sm text-[#475569]">
        {view ? (
          <>
            {view.patient.name}
            <span className="hidden md:inline">{view.patient.dateOfBirth ? ` · DOB ${date(view.patient.dateOfBirth)}` : ""} · balance</span>
            <span className="md:hidden"> ·</span>{" "}
            <strong className={cn(view.balancePence > 0 ? "text-destructive-strong" : "text-foreground")}>{money(view.balancePence)} owing</strong>
          </>
        ) : (
          "Loading…"
        )}
      </DialogPrimitive.Description>
    </div>
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => (busy ? undefined : onOpenChange(o))}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(15,23,42,0.45)]" />
        <DialogPrimitive.Content
          data-testid="take-payment"
          className="fixed inset-0 z-50 flex flex-col bg-white text-sm focus:outline-none md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[calc(100dvh-32px)] md:w-[calc(100vw-32px)] md:max-w-[720px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:shadow-[0_24px_48px_rgba(15,23,42,0.24)]"
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <div className="flex items-start gap-3 border-b border-border px-4 py-3 md:px-5 md:py-4">
            <DialogPrimitive.Close asChild>
              <button type="button" aria-label="Close" className={cn("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-[#334155] hover:bg-[#F1F5F9] md:order-2 md:ml-auto", focusRing)}>
                <X className="h-5 w-5" aria-hidden />
              </button>
            </DialogPrimitive.Close>
            {title}
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4 md:px-5">
            {loadError ? <p role="alert" className="text-destructive-strong">{loadError}</p> : null}
            {done ? (
              <div className="flex flex-col gap-3" role="status" data-testid="take-payment-done">
                <p className="text-base font-semibold text-foreground">{done.message}</p>
                {done.links.map((l) => (
                  <div key={l.url} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-[#F8FAFC] p-3">
                    <span className="min-w-0 flex-1 break-all text-[13px]" data-testid="payment-link-url">
                      {l.url}
                    </span>
                    <PmsButton variant="secondary" size="sm" onClick={() => void navigator.clipboard?.writeText(l.url).then(() => toast.success("Link copied"))}>
                      <Copy aria-hidden />
                      Copy link
                    </PmsButton>
                  </div>
                ))}
                {done.links.length ? <p className="text-xs text-[#475569]">Test mode – the link opens the payment provider&apos;s test page. Check for the payment on the invoice once the patient has paid.</p> : null}
              </div>
            ) : view ? (
              <>
                {view.balancePence === 0 ? <p className="text-[#475569]">Nothing is owed. A payment taken now stays on the patient&apos;s account.</p> : null}
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 text-sm font-semibold text-foreground">Amount</legend>
                  <div className="grid grid-cols-2 gap-1 rounded-[10px] bg-[#F1F5F9] p-1 md:hidden">
                    {[true, false].map((f) => (
                      <button key={String(f)} type="button" aria-pressed={full === f} onClick={() => setFull(f)} className={cn("h-11 rounded-[8px] text-sm font-semibold", focusRing, full === f ? "bg-white shadow-sm" : "text-[#334155]")}>
                        {f ? `Full ${money(view.balancePence)}` : "Part"}
                      </button>
                    ))}
                  </div>
                  <div className="hidden grid-cols-2 gap-3 md:grid">
                    <label className={cn("flex h-12 cursor-pointer items-center gap-3 rounded-[10px] border px-3", full ? "border-[#0E958A] bg-[#F0FDFA]" : "border-border")}>
                      <input type="radio" name="tp-amount" className="h-4 w-4 accent-[#0B7970]" checked={full} onChange={() => setFull(true)} />
                      <span className="flex-1">Full balance</span>
                      <strong className="tabular-nums">{money(view.balancePence)}</strong>
                    </label>
                    <label className={cn("flex h-12 cursor-pointer items-center gap-3 rounded-[10px] border px-3", !full ? "border-[#0E958A] bg-[#F0FDFA]" : "border-border")}>
                      <input type="radio" name="tp-amount" className="h-4 w-4 accent-[#0B7970]" checked={!full} onChange={() => setFull(false)} />
                      <span className="flex-1">Part payment</span>
                      <span className="sr-only">amount</span>
                    </label>
                  </div>
                  {!full ? (
                    <label className="flex items-center gap-2 md:w-1/2 md:self-end">
                      <span className="text-sm font-medium">Amount £</span>
                      <input
                        inputMode="decimal"
                        aria-label="Part payment amount in pounds"
                        data-testid="part-amount"
                        value={partText}
                        onChange={(e) => setPartText(e.target.value)}
                        className={cn("h-9 w-32 rounded-[8px] border border-[#94A3B8] px-2 text-right tabular-nums", focusRing)}
                      />
                    </label>
                  ) : null}
                </fieldset>

                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 text-sm font-semibold text-foreground">Method</legend>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                    {METHODS.map((m) => {
                      const disabled = (m.key === "card_on_file" && (!view.providerReady || view.savedCards.length === 0)) || (m.key === "payment_link" && !view.linksEnabled);
                      const Icon = m.icon;
                      return (
                        <label
                          key={m.key}
                          className={cn(
                            "flex min-h-[56px] cursor-pointer items-start gap-3 rounded-[10px] border px-3 py-2.5",
                            method === m.key ? "border-[#0E958A] bg-[#F0FDFA]" : "border-border",
                            disabled && "cursor-not-allowed opacity-60",
                            (m.key === "card_now" || m.key === "card_on_file") && "md:order-none",
                          )}
                        >
                          <input type="radio" name="tp-method" value={m.key} className="mt-1 h-4 w-4 accent-[#0B7970]" checked={method === m.key} disabled={disabled} onChange={() => setMethod(m.key)} />
                          <span className="flex min-w-0 flex-col">
                            <span className="flex items-center gap-1.5 font-semibold text-foreground">
                              <Icon className="hidden h-4 w-4 md:inline" aria-hidden />
                              {m.label}
                            </span>
                            <span className="text-[13px] text-[#475569]">{m.key === "payment_link" && !view.linksEnabled ? (view.providerNote ?? "Payment links are switched off") : m.hint(view)}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {method === "card_on_file" && view.savedCards.length > 1 ? (
                    <label className="flex flex-col gap-1 text-sm">
                      Saved card
                      <select value={cardId ?? ""} onChange={(e) => setCardId(e.target.value)} className={cn("h-9 rounded-[8px] border border-[#94A3B8] px-2", focusRing)}>
                        {view.savedCards.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {method === "cash" ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2">
                        <span className="text-sm font-medium">Handed over £</span>
                        <input inputMode="decimal" data-testid="cash-tendered" value={tendered} onChange={(e) => setTendered(e.target.value)} className={cn("h-9 w-28 rounded-[8px] border border-[#94A3B8] px-2 text-right tabular-nums", focusRing)} />
                      </label>
                      {change !== null ? (
                        <span role="status" className={cn("font-semibold", change < 0 ? "text-destructive-strong" : "text-foreground")}>
                          {change < 0 ? `${money(-change)} short` : `Change: ${money(change)}`}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {method === "bank_transfer" || method === "card_now" ? (
                    <label className="flex flex-col gap-1 text-sm md:w-1/2">
                      {method === "bank_transfer" ? "Bank reference" : "Card reader receipt number (optional)"}
                      <input value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} className={cn("h-9 rounded-[8px] border border-[#94A3B8] px-2", focusRing)} />
                    </label>
                  ) : null}
                  {view.providerReady && (method === "card_on_file" || method === "payment_link") ? <p className="text-xs text-[#475569]">{view.providerNote}</p> : null}
                  {linkBlocked && view.linksEnabled && !full ? <p className="text-xs text-destructive-strong">A payment link asks for the full balance.</p> : null}
                </fieldset>

                {ordered.length > 0 ? (
                  <fieldset className="hidden flex-col gap-2 md:flex">
                    <legend className="mb-2 text-sm font-semibold text-foreground">Pay towards</legend>
                    <div className="overflow-hidden rounded-[10px] border border-border">
                      {ordered.map((i) => {
                        const a = allocations.find((x) => x.invoiceId === i.id)?.amountPence ?? 0;
                        return (
                          <div key={i.id} className="flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0">
                            <strong className="w-24 shrink-0">{i.number}</strong>
                            <span className="min-w-0 flex-1 truncate text-[#334155]">{i.description}</span>
                            <span className="text-[#475569]">owing {money(i.balancePence)}</span>
                            {editAlloc ? (
                              <input
                                aria-label={`Amount towards ${i.number}`}
                                inputMode="decimal"
                                value={alloc[i.id] ?? poundsText(a)}
                                onChange={(e) => setAlloc({ ...alloc, [i.id]: e.target.value })}
                                className={cn("h-8 w-24 rounded-[8px] border border-[#94A3B8] px-2 text-right tabular-nums", focusRing)}
                              />
                            ) : (
                              <strong className="w-20 text-right tabular-nums">{money(a)}</strong>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[13px] text-[#334155]">
                      {editAlloc ? "Changed by hand." : "Oldest first."}{" "}
                      <button
                        type="button"
                        className={cn("text-primary-strong underline underline-offset-2", focusRing)}
                        onClick={() => {
                          setAlloc(Object.fromEntries(autoAlloc.map((a) => [a.invoiceId, poundsText(a.amountPence)])));
                          setEditAlloc(!editAlloc);
                        }}
                      >
                        {editAlloc ? "Back to oldest first" : "Change allocation"}
                      </button>
                      {amount - allocatedTotal > 0 ? <span className="text-[#475569]"> · {money(amount - allocatedTotal)} stays on account</span> : null}
                    </p>
                  </fieldset>
                ) : null}

                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 text-sm font-semibold text-foreground">Receipt</legend>
                  <div className="flex flex-wrap gap-4">
                    <label className={cn("flex items-center gap-2", !view.patient.email && "text-[#64748B]")}>
                      <input type="radio" name="tp-receipt" disabled={!view.patient.email} className="h-4 w-4 accent-[#0B7970]" checked={receipt === "email"} onChange={() => setReceipt("email")} data-testid="receipt-email" />
                      Email{view.patient.email ? ` to ${view.patient.email}` : " (no email address)"}
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="radio" name="tp-receipt" className="h-4 w-4 accent-[#0B7970]" checked={receipt === "print"} onChange={() => setReceipt("print")} />
                      Print
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="radio" name="tp-receipt" className="h-4 w-4 accent-[#0B7970]" checked={receipt === "none"} onChange={() => setReceipt("none")} />
                      No receipt
                    </label>
                  </div>
                </fieldset>
                {error ? (
                  <p role="alert" className="text-destructive-strong">
                    {error}
                  </p>
                ) : null}
              </>
            ) : !loadError ? (
              <p className="text-[#475569]">Loading…</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3 md:px-5">
            {view?.context ? <span className="hidden text-xs text-[#475569] md:inline">From: {view.context}</span> : null}
            <span className="flex w-full gap-2 md:ml-auto md:w-auto">
              {done ? (
                <PmsButton className="h-12 w-full md:h-9 md:w-auto" onClick={() => onOpenChange(false)}>
                  Done
                </PmsButton>
              ) : (
                <>
                  <DialogPrimitive.Close asChild>
                    <PmsButton variant="secondary" className="hidden md:inline-flex" disabled={busy}>
                      Cancel
                    </PmsButton>
                  </DialogPrimitive.Close>
                  <PmsButton data-testid="take-payment-submit" data-amount={amount} data-method={method} data-blocked={[!view && "view", amount <= 0 && "amount", linkBlocked && "link", cardBlocked && "card"].filter(Boolean).join(" ")} className="h-12 w-full text-[15px] md:h-9 md:w-auto md:text-sm" loading={busy} disabled={!view || amount <= 0 || linkBlocked || cardBlocked} onClick={() => void submit()}>
                    {method === "payment_link" ? `Send link for ${money(amount)}` : `Take ${money(amount)}`}
                  </PmsButton>
                </>
              )}
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
