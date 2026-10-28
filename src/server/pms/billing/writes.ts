/**
 * Billing writes for the screens (./access.ts has the rules: permission first, site scope, plain failures). Every
 * repository write is audited in its own batch; money is whole pence; nothing is deleted (cancel, void, credit,
 * write off, reverse instead). Card payments and links go through the payment provider in TEST MODE ONLY.
 *
 *   invoice visits ("Invoice attended visits")  billing.edit (+ issue)
 *   waive a missed-appointment fee              billing.edit
 *   issue / cancel a draft                      billing.edit
 *   take a payment, payment link, save a card   billing.pay
 *   insurer remittance                          billing.pay (+ billing.refund for write-offs and moving to the patient)
 *   credit note, write-off, refund              billing.refund
 *   void an issued invoice                      billing.void
 */
import "server-only";
import { BILLING_COPY } from "../../../modules/pms/billing/copy";
import { autoAllocate } from "../../../modules/pms/billing/allocation";
import {
  RemittanceInputSchema,
  TakePaymentInputSchema,
  type RemittanceInput,
  type TakePaymentInput,
  type InvoiceLineInput,
  InvoiceVisitsInputSchema,
  type InvoiceVisitsInput,
} from "../../../modules/pms/billing/schemas";
import type { Invoice, PaymentMethod } from "../../../modules/pms/billing/types";
import { visitLine } from "../../../modules/pms/billing/visits";
import { formatPence, ukToday } from "../../../modules/pms/core/text";
import { isPlausibleRecordId } from "../../../modules/pms/records/form-values";
import { RepoInputError } from "../../repos/context";
import { createCreditNote, spreadOverLines, transferInvoiceBalance, voidInvoice, writeOffInvoice } from "../../repos/pms/billing/credit-notes";
import { cancelDraftInvoice, createDraftInvoice, getInvoice, issueInvoice } from "../../repos/pms/billing/invoices";
import { openInvoicesFor, recordPayment, removeAllocation } from "../../repos/pms/billing/payments";
import { getSavedCard, removeSavedCard, saveCard } from "../../repos/pms/billing/saved-cards";
import { getBillingSettings } from "../../repos/pms/billing/settings";
import { getAuthorisation } from "../../repos/pms/cases";
import { BILLING_NOT_FOUND, attempt, fail, forbidden, invoiceInScope, invoiceSiteVisible, notFound, ok, patientInClinic, siteInScope, type BillingActor, type Result } from "./access";
import { checkInvoicePaymentLinks, createInvoicePaymentLink } from "./payment-links";
import { paymentLinkProvider, PaymentProviderError, type PaymentLinkProvider } from "./payments";
import { billableVisitSource } from "./visit-source";
import { priceVisits, referrerNames } from "./views";

const CONFLICT = "Someone else changed this invoice. Reload the page and try again.";

function draftFailure(r: { ok: false; reason: string }): { ok: false; code: "conflict" | "not_found" | "invalid"; error: string } {
  if (r.reason === "conflict") return { ok: false, code: "conflict", error: CONFLICT };
  if (r.reason === "not_draft") return { ok: false, code: "invalid", error: "This invoice is no longer a draft." };
  return { ok: false, code: "not_found", error: BILLING_NOT_FOUND };
}

/* ------------------------------------------------------------------------------------------------
 * Invoicing chargeable visits
 * ----------------------------------------------------------------------------------------------*/

export interface InvoiceVisitsResult {
  invoices: { id: string; number: string | null; billTo: "patient" | "payer"; totalPence: number }[];
  /** Visits left out: already invoiced meanwhile, no price, or a 0 % fee. */
  skipped: number;
}

/**
 * Invoices the chosen chargeable visits (read again from the diary – the request only names appointment ids; the
 * prices, payers and visits come from the server): one invoice per patient, case, who is billed and site; an
 * insured case's excess goes on its own patient invoice. Drafts, or issued straight away when `issue` is true.
 */
export async function invoiceVisitsFor(actor: BillingActor, input: InvoiceVisitsInput): Promise<Result<InvoiceVisitsResult>> {
  if (!actor.can("billing.view") || !actor.can("billing.edit")) return forbidden();
  const parsed = InvoiceVisitsInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Choose the visits to invoice.");
  return attempt("billing.invoice_visits", async () => {
    const ctx = actor.repo();
    const t = actor.tenantId;
    const source = billableVisitSource();
    if (!source.connected) return fail("invalid", BILLING_COPY.noVisitSource);
    const today = ukToday(ctx.now ? ctx.now() : new Date());
    const visits = [];
    const ids = Array.from(new Set(parsed.data.appointmentIds));
    for (let i = 0; i < ids.length; i += 90) {
      visits.push(...(await source.listClinicVisits(ctx, t, { from: "2000-01-01", until: today, siteIds: actor.siteIds ?? null, appointmentIds: ids.slice(i, i + 90) })));
    }
    const priced = await priceVisits(ctx, t, visits);
    const settings = await getBillingSettings(ctx, t);
    const groups = new Map<string, typeof priced>();
    let skipped = ids.length - visits.length;
    for (const p of priced) {
      if (p.chargePence === null || p.chargePence <= 0) {
        skipped += 1;
        continue;
      }
      const key = [p.visit.patientId, p.visit.caseId ?? "", p.billTo, p.visit.siteId ?? ""].join("|");
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    const out: InvoiceVisitsResult["invoices"] = [];
    for (const group of Array.from(groups.values())) {
      const first = group[0].visit;
      const lines: InvoiceLineInput[] = [];
      for (const p of group) {
        const line = visitLine(
          // The charge is final already (the price, the clinic's percentage or the diary's own fee).
          { ...p.visit, feePence: null },
          { listPricePence: p.chargePence as number, billingCode: null, serviceName: p.serviceName, vatCode: settings.vatRegistered ? (settings.serviceVat[p.visit.serviceId] ?? "exempt") : "none" },
          { dnaChargePercent: 100, lateCancelChargePercent: 100 },
        );
        if (line) lines.push(line);
      }
      if (lines.length === 0) continue;
      // The authorisation the visits were booked under (when they agree and it is still active for this case).
      let authorisationId: string | null = null;
      const auths = Array.from(new Set(group.map((p) => p.visit.authorisationId ?? null)));
      if (group[0].billTo === "payer" && auths.length === 1 && auths[0] && first.caseId) {
        const a = await getAuthorisation(ctx, t, auths[0]);
        if (a && a.status === "active" && a.caseId === first.caseId) authorisationId = a.id;
      }
      try {
        const created = await createDraftInvoice(
          ctx,
          t,
          { patientId: first.patientId, caseId: first.caseId, billTo: group[0].billTo, siteId: first.siteId, authorisationId, lines },
          actor.actor,
          { applyExcess: group[0].billTo === "payer" },
        );
        const made = [created.invoice, ...(created.excessInvoice ? [created.excessInvoice] : [])];
        for (const inv of made) {
          let final: Invoice = inv;
          if (parsed.data.issue) {
            const issued = await issueInvoice(ctx, t, inv.id, inv.rev, {}, actor.actor);
            if (!issued.ok) return fail("invalid", issued.reason === "authorisation" ? issued.message : "An invoice could not be issued. It is kept as a draft.");
            final = issued.invoice;
          }
          out.push({ id: final.id, number: final.number, billTo: final.billTo, totalPence: final.totalPence });
        }
      } catch (err) {
        // Invoiced by someone else meanwhile (the database's one-line-per-appointment rule): skip this group.
        if (err instanceof RepoInputError && /already on another invoice/.test(err.message)) {
          skipped += group.length;
          continue;
        }
        throw err;
      }
    }
    if (out.length === 0) return fail("invalid", "None of the chosen visits could be invoiced: they are invoiced already, or have no price.");
    return ok({ invoices: out, skipped });
  });
}

/** Waives a did-not-attend / late-cancellation fee: the visit leaves the list (the diary records it, audited). */
export async function waiveFeeFor(actor: BillingActor, appointmentId: string): Promise<Result<{ waived: boolean }>> {
  if (!actor.can("billing.view") || !actor.can("billing.edit")) return forbidden();
  if (!isPlausibleRecordId(appointmentId)) return notFound();
  return attempt("billing.waive_fee", async () => {
    const ctx = actor.repo();
    const source = billableVisitSource();
    const [visit] = await source.listClinicVisits(ctx, actor.tenantId, { from: "2000-01-01", until: "2099-12-31", siteIds: actor.siteIds ?? null, appointmentIds: [appointmentId] });
    if (!visit || visit.status === "attended") return fail("invalid", "Only a did-not-attend or late-cancellation fee can be waived.");
    return ok({ waived: await source.waiveFee(ctx, actor.tenantId, appointmentId, actor.actor) });
  });
}

/* ------------------------------------------------------------------------------------------------
 * Drafts
 * ----------------------------------------------------------------------------------------------*/

export async function issueInvoiceFor(actor: BillingActor, invoiceId: string, rev: number): Promise<Result<{ number: string | null }>> {
  if (!actor.can("billing.view") || !actor.can("billing.edit")) return forbidden();
  return attempt("billing.issue", async () => {
    const inv = await invoiceInScope(actor, invoiceId);
    if (!inv) return fail("not_found", BILLING_NOT_FOUND);
    const r = await issueInvoice(actor.repo(), actor.tenantId, inv.id, rev, {}, actor.actor);
    if (!r.ok) return r.reason === "authorisation" ? fail("invalid", r.message) : draftFailure(r);
    return ok({ number: r.invoice.number });
  });
}

export async function cancelDraftFor(actor: BillingActor, invoiceId: string, rev: number): Promise<Result<{ cancelled: true }>> {
  if (!actor.can("billing.view") || !actor.can("billing.edit")) return forbidden();
  return attempt("billing.cancel_draft", async () => {
    const inv = await invoiceInScope(actor, invoiceId);
    if (!inv) return fail("not_found", BILLING_NOT_FOUND);
    const r = await cancelDraftInvoice(actor.repo(), actor.tenantId, inv.id, rev, actor.actor);
    if (!r.ok) return draftFailure(r);
    return ok({ cancelled: true });
  });
}

/* ------------------------------------------------------------------------------------------------
 * Credit notes, void, refunds
 * ----------------------------------------------------------------------------------------------*/

/** A credit note for an amount (spread over the lines from the last one) or for everything left. */
export async function creditNoteFor(actor: BillingActor, invoiceId: string, input: { amountPence?: number; reason: string }): Promise<Result<{ number: string }>> {
  if (!actor.can("billing.view") || !actor.can("billing.refund")) return forbidden();
  return attempt("billing.credit_note", async () => {
    const inv = await invoiceInScope(actor, invoiceId);
    if (!inv) return fail("not_found", BILLING_NOT_FOUND);
    const left = inv.totalPence - inv.creditedPence;
    const amount = input.amountPence ?? left;
    if (!Number.isInteger(amount) || amount <= 0) return fail("invalid", "Enter the amount to credit.");
    if (amount > left) return fail("invalid", `At most ${formatPence(left)} can be credited on this invoice.`);
    const note = await createCreditNote(actor.repo(), actor.tenantId, { invoiceId: inv.id, lines: spreadOverLines(inv, amount), reason: input.reason }, actor.actor);
    return ok({ number: note.number });
  });
}

export async function voidInvoiceFor(actor: BillingActor, invoiceId: string, reason: string): Promise<Result<{ number: string }>> {
  if (!actor.can("billing.view") || !actor.can("billing.void")) return forbidden();
  return attempt("billing.void", async () => {
    const inv = await invoiceInScope(actor, invoiceId);
    if (!inv) return fail("not_found", BILLING_NOT_FOUND);
    const note = await voidInvoice(actor.repo(), actor.tenantId, inv.id, { reason }, actor.actor);
    return ok({ number: note.number });
  });
}

/**
 * Refunds money paid on an invoice: what the invoice has not yet credited is credited first (a credit note), then
 * the refund is recorded against it. A card payment taken through the provider is refunded to the card (test
 * mode); otherwise the refund is recorded as given (cash, bank transfer, the card reader).
 */
export async function refundFor(
  actor: BillingActor,
  invoiceId: string,
  input: { amountPence: number; method: "card" | "cash" | "bank_transfer"; reason: string },
  provider: PaymentLinkProvider = paymentLinkProvider(),
): Promise<Result<{ refundedPence: number; toCard: boolean }>> {
  if (!actor.can("billing.view") || !actor.can("billing.refund")) return forbidden();
  return attempt("billing.refund", async () => {
    const inv = await invoiceInScope(actor, invoiceId);
    if (!inv) return fail("not_found", BILLING_NOT_FOUND);
    const ctx = actor.repo();
    const t = actor.tenantId;
    const amount = input.amountPence;
    if (!Number.isInteger(amount) || amount <= 0) return fail("invalid", "Enter the amount to refund.");
    if (amount > inv.paidPence) return fail("invalid", `At most ${formatPence(inv.paidPence)} was paid on this invoice.`);
    if (!input.reason || input.reason.trim().length < 3) return fail("invalid", "Say why the money is refunded.");
    const owedBack = Math.max(0, -inv.balancePence);
    if (amount > owedBack) {
      const toCredit = amount - owedBack;
      if (toCredit > inv.totalPence - inv.creditedPence) return fail("invalid", "That is more than can be credited on this invoice.");
      await createCreditNote(ctx, t, { invoiceId: inv.id, lines: spreadOverLines(inv, toCredit), reason: input.reason }, actor.actor);
    }
    // A card payment through the provider goes back to the card.
    let providerRef: string | null = null;
    let providerId = "manual";
    if (input.method === "card" && provider.configured) {
      const paid = await ctx.db
        .selectFrom("pms_payment_allocations as a")
        .innerJoin("pms_payments as p", (j) => j.onRef("p.tenant_id", "=", "a.tenant_id").onRef("p.id", "=", "a.payment_id"))
        .select(["p.provider_ref", "p.provider", "p.amount_pence"])
        .where("a.tenant_id", "=", t)
        .where("a.invoice_id", "=", inv.id)
        .where("a.reversed", "=", 0)
        .where("p.kind", "=", "payment")
        .where("p.provider", "=", provider.id)
        .where("p.provider_ref", "is not", null)
        .orderBy("p.created_at", "desc")
        .executeTakeFirst();
      if (paid?.provider_ref) {
        try {
          const r = await provider.refund({ chargeRef: paid.provider_ref, amountPence: amount, idempotencyKey: `${t}-${inv.id}-refund-${amount}-${inv.rev}` });
          providerRef = r.refundRef;
          providerId = provider.id;
        } catch (err) {
          if (err instanceof PaymentProviderError) return fail("invalid", err.message);
          throw err;
        }
      }
    }
    await recordPayment(
      ctx,
      t,
      {
        kind: "refund",
        payerKind: inv.billTo === "payer" ? "account" : "patient",
        patientId: inv.billTo === "payer" ? null : inv.patientId,
        payerReferrerId: inv.billTo === "payer" ? inv.payerReferrerId : null,
        receivedOn: ukToday(ctx.now ? ctx.now() : new Date()),
        method: input.method,
        amountPence: amount,
        reference: providerRef ? "Refund to card" : null,
        notes: input.reason,
        siteId: inv.siteId,
        allocations: [{ invoiceId: inv.id, amountPence: amount }],
      },
      actor.actor,
      providerRef ? { provider: providerId, providerRef } : {},
    );
    return ok({ refundedPence: amount, toCard: providerRef !== null });
  });
}

/** Takes one payment off its invoice (it stays on the payer's account). */
export async function removeAllocationFor(actor: BillingActor, invoiceId: string, allocationId: string): Promise<Result<{ removed: boolean }>> {
  if (!actor.can("billing.view") || !actor.can("billing.refund")) return forbidden();
  if (!isPlausibleRecordId(allocationId)) return notFound();
  return attempt("billing.unallocate", async () => {
    const inv = await invoiceInScope(actor, invoiceId);
    if (!inv) return fail("not_found", BILLING_NOT_FOUND);
    const a = await actor
      .repo()
      .db.selectFrom("pms_payment_allocations")
      .select("invoice_id")
      .where("tenant_id", "=", actor.tenantId)
      .where("id", "=", allocationId)
      .executeTakeFirst();
    if (!a || a.invoice_id !== inv.id) return notFound();
    return ok({ removed: await removeAllocation(actor.repo(), actor.tenantId, allocationId, actor.actor) });
  });
}

/* ------------------------------------------------------------------------------------------------
 * Taking a payment (the dialog)
 * ----------------------------------------------------------------------------------------------*/

export interface TakePaymentResult {
  /** Recorded now (not for a payment link – the patient pays later). */
  paymentId: string | null;
  amountPence: number;
  /** Cash: the change to give. */
  changePence: number | null;
  /** Payment link: the links to send. */
  links: { invoiceId: string; url: string; amountPence: number }[];
  message: string;
}

export async function takePaymentFor(actor: BillingActor, input: TakePaymentInput, provider: PaymentLinkProvider = paymentLinkProvider()): Promise<Result<TakePaymentResult>> {
  if (!actor.can("billing.view") || !actor.can("billing.pay")) return forbidden();
  const parsed = TakePaymentInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail("invalid", issue?.message ?? "Check the payment.", issue ? { fieldErrors: { [String(issue.path[0] ?? "form")]: issue.message } } : {});
  }
  const d = parsed.data;
  return attempt<TakePaymentResult>("billing.take_payment", async () => {
    const patient = await patientInClinic(actor, d.patientId);
    if (!patient) return notFound();
    const ctx = actor.repo();
    const t = actor.tenantId;
    const open = (await openInvoicesFor(ctx, t, { payerKind: "patient", patientId: patient.id })).filter((i) => invoiceSiteVisible(actor, i.siteId));
    const byId = new Map(open.map((i) => [i.id, i]));
    let allocations = d.allocations ?? autoAllocate(d.amountPence, open.map((i) => ({ id: i.id, issuedOn: i.issuedOn ?? "", numberSeq: i.numberSeq, balancePence: i.balancePence })));
    allocations = allocations.filter((a) => a.amountPence > 0);
    for (const a of allocations) {
      const inv = byId.get(a.invoiceId);
      if (!inv) return fail("invalid", "One of the invoices is not open for this patient any more. Reload and try again.");
      if (a.amountPence > inv.balancePence) return fail("invalid", `${inv.number ?? "An invoice"} owes only ${formatPence(inv.balancePence)}.`);
    }
    const siteId = siteInScope(actor, d.siteId) ?? (allocations[0] ? (byId.get(allocations[0].invoiceId)?.siteId ?? null) : null);
    const today = ukToday(ctx.now ? ctx.now() : new Date());

    if (d.method === "payment_link") {
      if (allocations.length === 0) return fail("invalid", "Choose the invoice the link is for.");
      const links: TakePaymentResult["links"] = [];
      for (const a of allocations) {
        const inv = byId.get(a.invoiceId);
        if (inv && a.amountPence !== inv.balancePence) return fail("invalid", "A payment link asks for an invoice's full balance. Choose Full balance, or another method for a part payment.");
        const link = await createInvoicePaymentLink(ctx, t, actor.name ? actor.name : "Clinic", a.invoiceId, actor.actor, provider);
        links.push({ invoiceId: a.invoiceId, url: link.url, amountPence: link.amountPence });
      }
      return ok({ paymentId: null, amountPence: d.amountPence, changePence: null, links, message: `Payment link ready for ${formatPence(d.amountPence)} (test mode).` });
    }

    let method: PaymentMethod;
    let reference: string | null = d.reference ?? null;
    let providerOpts: { provider?: string; providerRef?: string } = {};
    if (d.method === "card_on_file") {
      const card = d.savedCardId ? await getSavedCard(ctx, t, d.savedCardId) : null;
      if (!card || card.patientId !== patient.id || card.status !== "active") return fail("invalid", "That saved card is not this patient's.");
      if (!provider.configured) return fail("invalid", provider.unavailableReason ?? "Saved cards are not set up.");
      try {
        const charge = await provider.chargeSavedCard({ customerRef: card.customerRef, methodRef: card.methodRef, amountPence: d.amountPence, description: "Clinic payment", idempotencyKey: `${t}-${patient.id}-${d.amountPence}-${Date.now()}` });
        providerOpts = { provider: provider.id, providerRef: charge.chargeRef };
      } catch (err) {
        if (err instanceof PaymentProviderError) return fail("invalid", err.message);
        throw err;
      }
      method = "card";
      reference = `Card ending ${card.last4}`;
    } else if (d.method === "card_now") {
      method = "card";
      reference = reference ?? "Card reader";
    } else if (d.method === "cash") {
      method = "cash";
    } else {
      method = "bank_transfer";
    }
    const payment = await recordPayment(
      ctx,
      t,
      { payerKind: "patient", patientId: patient.id, receivedOn: today, method, amountPence: d.amountPence, reference, siteId, allocations },
      actor.actor,
      providerOpts,
    );
    const change = d.method === "cash" && d.tenderedPence !== undefined ? d.tenderedPence - d.amountPence : null;
    const kept = d.amountPence - allocations.reduce((a, x) => a + x.amountPence, 0);
    return ok({
      paymentId: payment.id,
      amountPence: d.amountPence,
      changePence: change,
      links: [],
      message: `${formatPence(d.amountPence)} taken${change ? ` – give ${formatPence(change)} change` : ""}${kept > 0 ? ` (${formatPence(kept)} kept on account)` : ""}.`,
    });
  });
}

export async function paymentLinkFor(actor: BillingActor, invoiceId: string, provider: PaymentLinkProvider = paymentLinkProvider()): Promise<Result<{ url: string; amountPence: number }>> {
  if (!actor.can("billing.view") || !actor.can("billing.pay")) return forbidden();
  return attempt("billing.payment_link", async () => {
    const inv = await invoiceInScope(actor, invoiceId);
    if (!inv) return fail("not_found", BILLING_NOT_FOUND);
    const link = await createInvoicePaymentLink(actor.repo(), actor.tenantId, actor.name || "Clinic", inv.id, actor.actor, provider);
    return ok({ url: link.url, amountPence: link.amountPence });
  });
}

export async function checkPaymentLinksFor(actor: BillingActor, invoiceId: string, provider: PaymentLinkProvider = paymentLinkProvider()): Promise<Result<{ recorded: number; amountPence: number }>> {
  if (!actor.can("billing.view") || !actor.can("billing.pay")) return forbidden();
  return attempt("billing.check_links", async () => {
    const inv = await invoiceInScope(actor, invoiceId);
    if (!inv) return fail("not_found", BILLING_NOT_FOUND);
    const r = await checkInvoicePaymentLinks(actor.repo(), actor.tenantId, inv.id, actor.actor, provider);
    return ok({ recorded: r.recorded, amountPence: r.amountPence });
  });
}

/** Saves the provider's TEST card for a patient (test mode only). */
export async function saveTestCardFor(actor: BillingActor, patientId: string, provider: PaymentLinkProvider = paymentLinkProvider()): Promise<Result<{ label: string }>> {
  if (!actor.can("billing.view") || !actor.can("billing.pay")) return forbidden();
  return attempt("billing.save_card", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient) return notFound();
    if (!provider.configured) return fail("invalid", provider.unavailableReason ?? "Saved cards are not set up.");
    let ref;
    try {
      ref = await provider.saveTestCard({ tenantId: actor.tenantId, patientId: patient.id, idempotencyKey: `${actor.tenantId}-${patient.id}-card-${Date.now()}` });
    } catch (err) {
      if (err instanceof PaymentProviderError) return fail("invalid", err.message);
      throw err;
    }
    const card = await saveCard(actor.repo(), actor.tenantId, { patientId: patient.id, provider: provider.id, ...ref }, actor.actor);
    return ok({ label: `Card ending ${card.last4}` });
  });
}

export async function removeCardFor(actor: BillingActor, patientId: string, cardId: string): Promise<Result<{ removed: boolean }>> {
  if (!actor.can("billing.view") || !actor.can("billing.pay")) return forbidden();
  return attempt("billing.remove_card", async () => {
    const patient = await patientInClinic(actor, patientId);
    if (!patient || !isPlausibleRecordId(cardId)) return notFound();
    const card = await getSavedCard(actor.repo(), actor.tenantId, cardId);
    if (!card || card.patientId !== patient.id) return notFound();
    return ok({ removed: await removeSavedCard(actor.repo(), actor.tenantId, cardId, actor.actor) });
  });
}

/* ------------------------------------------------------------------------------------------------
 * Insurer remittance
 * ----------------------------------------------------------------------------------------------*/

export interface RemittanceResult {
  paymentId: string;
  allocatedPence: number;
  writtenOffPence: number;
  movedToPatientsPence: number;
  /** Kept on the payer's account. */
  unallocatedPence: number;
}

/** Moves what a payer did not pay to the patient: a patient invoice for it (issued) and a "transfer" credit. */
async function moveToPatient(actor: BillingActor, inv: Invoice, amountPence: number, payerName: string): Promise<void> {
  const ctx = actor.repo();
  const t = actor.tenantId;
  const draft = await createDraftInvoice(
    ctx,
    t,
    { patientId: inv.patientId, caseId: inv.caseId, billTo: "patient", siteId: inv.siteId, lines: [{ kind: "item", description: `Not paid by ${payerName} on ${inv.number ?? "an invoice"}`.slice(0, 200), quantity: 1, unitPricePence: amountPence, serviceOn: inv.lastServiceOn }] },
    actor.actor,
  );
  try {
    await transferInvoiceBalance(ctx, t, inv.id, amountPence, draft.invoice.id, actor.actor);
  } catch (err) {
    await cancelDraftInvoice(ctx, t, draft.invoice.id, draft.invoice.rev, actor.actor);
    throw err;
  }
  const issued = await issueInvoice(ctx, t, draft.invoice.id, draft.invoice.rev, {}, actor.actor);
  if (!issued.ok) throw new RepoInputError("The patient's invoice was made but not issued – issue it from the drafts.");
}

export async function remittanceFor(actor: BillingActor, input: RemittanceInput): Promise<Result<RemittanceResult>> {
  if (!actor.can("billing.view") || !actor.can("billing.pay")) return forbidden();
  const parsed = RemittanceInputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Check the allocation.");
  const d = parsed.data;
  if (d.rows.some((r) => r.shortfall !== "leave") && !actor.can("billing.refund")) {
    return fail("forbidden", 'Writing off or moving an amount to the patient needs the "Refunds and credit notes" permission.');
  }
  return attempt("billing.remittance", async () => {
    const ctx = actor.repo();
    const t = actor.tenantId;
    const payerName = (await referrerNames(ctx, t, [d.payerReferrerId])).get(d.payerReferrerId);
    if (!payerName) return notFound();
    const today = ukToday(ctx.now ? ctx.now() : new Date());
    if (d.receivedOn > today) return fail("invalid", "The date received cannot be in the future.");
    const invoices = new Map<string, Invoice>();
    for (const r of d.rows) {
      const inv = await invoiceInScope(actor, r.invoiceId);
      if (!inv || inv.status !== "issued" || inv.billTo !== "payer" || inv.payerReferrerId !== d.payerReferrerId) return fail("invalid", "One of the invoices is not an open invoice of this payer. Reload and try again.");
      if (r.paidPence > inv.balancePence) return fail("invalid", `${inv.number ?? "An invoice"} owes only ${formatPence(inv.balancePence)}.`);
      invoices.set(inv.id, inv);
    }
    const allocations = d.rows.filter((r) => r.paidPence > 0).map((r) => ({ invoiceId: r.invoiceId, amountPence: r.paidPence }));
    const payment = await recordPayment(ctx, t, { payerKind: "account", payerReferrerId: d.payerReferrerId, receivedOn: d.receivedOn, method: d.method, amountPence: d.amountPence, reference: d.reference, allocations }, actor.actor);
    let writtenOff = 0;
    let moved = 0;
    for (const r of d.rows) {
      const inv = invoices.get(r.invoiceId) as Invoice;
      const short = inv.balancePence - r.paidPence;
      if (short <= 0 || r.shortfall === "leave") continue;
      if (r.shortfall === "write_off") {
        await writeOffInvoice(ctx, t, { invoiceId: inv.id, amountPence: short, reason: r.writeOffReason ?? "other", note: `Remittance ${d.reference}` }, actor.actor, { paymentId: payment.id });
        writtenOff += short;
      } else {
        await moveToPatient(actor, (await getInvoice(ctx, t, inv.id)) as Invoice, short, payerName);
        moved += short;
      }
    }
    const allocated = allocations.reduce((a, x) => a + x.amountPence, 0);
    return ok({ paymentId: payment.id, allocatedPence: allocated, writtenOffPence: writtenOff, movedToPatientsPence: moved, unallocatedPence: d.amountPence - allocated });
  });
}
