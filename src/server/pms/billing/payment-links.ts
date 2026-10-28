/**
 * Card payment links for invoices (test mode only – ./payments/*): make one for an invoice's balance, and check it
 * for payments, which are then recorded as ordinary payments allocated to the invoice (each provider reference
 * once). Called by the invoice page's server actions.
 */
import "server-only";
import type { PaymentLink } from "../../../modules/pms/billing/types";
import type { PmsActor } from "../../../modules/pms/core/types";
import { RepoInputError, type RepoContext } from "../../repos/context";
import { getBillingSettings } from "../../repos/pms/billing/settings";
import { getInvoice } from "../../repos/pms/billing/invoices";
import { listPaymentLinks, markPaymentLink, savePaymentLink } from "../../repos/pms/billing/payment-links";
import { recordPayment } from "../../repos/pms/billing/payments";
import { paymentLinkProvider, PaymentProviderError, type PaymentLinkProvider } from "./payments";

export async function createInvoicePaymentLink(
  ctx: RepoContext,
  tenantId: string,
  clinicName: string,
  invoiceId: string,
  actor: PmsActor,
  provider: PaymentLinkProvider = paymentLinkProvider(),
): Promise<PaymentLink> {
  if (!provider.configured) throw new RepoInputError(provider.unavailableReason ?? "Card payment links are not set up.");
  const settings = await getBillingSettings(ctx, tenantId);
  if (!settings.paymentLinksEnabled) throw new RepoInputError("Card payment links are switched off in the billing settings.");
  const inv = await getInvoice(ctx, tenantId, invoiceId);
  if (!inv) throw new RepoInputError("That invoice does not exist in this clinic.");
  if (inv.status !== "issued" || !inv.numberSeq) throw new RepoInputError("Issue the invoice before sending a payment link.");
  if (inv.balancePence <= 0) throw new RepoInputError("Nothing is owed on this invoice.");
  const existing = (await listPaymentLinks(ctx, tenantId, invoiceId)).find((l) => l.status === "active" && l.amountPence === inv.balancePence && l.provider === provider.id);
  if (existing) return existing;
  try {
    const created = await provider.createLink({
      tenantId,
      invoiceId,
      invoiceNumber: inv.number ?? "",
      clinicName,
      amountPence: inv.balancePence,
      idempotencyKey: `${tenantId}-${invoiceId}-${inv.balancePence}-${inv.rev}`,
    });
    return await savePaymentLink(ctx, tenantId, { invoiceId, provider: provider.id, providerLinkId: created.providerLinkId, url: created.url, amountPence: inv.balancePence }, actor);
  } catch (err) {
    if (err instanceof PaymentProviderError) throw new RepoInputError(err.message);
    throw err;
  }
}

export interface LinkCheckResult {
  /** Payments recorded now. */
  recorded: number;
  amountPence: number;
  /** Links that had been paid. */
  paidLinks: number;
}

/** Asks the provider whether the invoice's active links were paid; records each new payment once. */
export async function checkInvoicePaymentLinks(ctx: RepoContext, tenantId: string, invoiceId: string, actor: PmsActor, provider: PaymentLinkProvider = paymentLinkProvider()): Promise<LinkCheckResult> {
  const out: LinkCheckResult = { recorded: 0, amountPence: 0, paidLinks: 0 };
  if (!provider.configured) return out;
  const links = (await listPaymentLinks(ctx, tenantId, invoiceId)).filter((l) => l.status === "active" && l.provider === provider.id);
  for (const link of links) {
    let sessions;
    try {
      sessions = await provider.listPaidSessions(link.providerLinkId);
    } catch (err) {
      if (err instanceof PaymentProviderError) throw new RepoInputError(err.message);
      throw err;
    }
    for (const s of sessions) {
      const inv = await getInvoice(ctx, tenantId, invoiceId);
      if (!inv) break;
      const allocate = Math.min(s.amountPence, Math.max(0, inv.balancePence));
      try {
        await recordPayment(
          ctx,
          tenantId,
          {
            payerKind: inv.billTo === "payer" ? "account" : "patient",
            patientId: inv.billTo === "payer" ? null : inv.patientId,
            payerReferrerId: inv.billTo === "payer" ? inv.payerReferrerId : null,
            receivedOn: s.paidOn,
            method: "online",
            amountPence: s.amountPence,
            reference: `Card payment ${inv.number ?? ""}`.trim(),
            allocations: allocate > 0 ? [{ invoiceId, amountPence: allocate }] : [],
          },
          actor,
          { provider: provider.id, providerRef: s.sessionId },
        );
        out.recorded += 1;
        out.amountPence += s.amountPence;
      } catch (err) {
        // Already recorded (a second check): the provider reference is unique per clinic.
        if (!(err instanceof RepoInputError && /already recorded/.test(err.message))) throw err;
      }
    }
    if (sessions.length > 0) {
      out.paidLinks += 1;
      await markPaymentLink(ctx, tenantId, link.id, "paid", actor);
      await provider.deactivate(link.providerLinkId).catch(() => undefined);
    } else {
      await markPaymentLink(ctx, tenantId, link.id, "active", actor);
    }
  }
  return out;
}
