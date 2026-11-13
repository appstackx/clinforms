/**
 * The patient portal's card section (l04 + cp04): the signed-in patient's invoices to pay, their saved cards, the
 * consent words, and the return from the payment provider's pages (?paid=<intent> / ?card=<saved card>) – each
 * confirmed with the provider before the page says so (the webhook may have recorded it first; recorded once).
 */
import "server-only";
import { cardConsentWording } from "../../../../modules/pms/billing/card-payments";
import type { RepoContext } from "../../../repos/context";
import { getCardSettings, getMandate, listMandates, mandateLabel } from "../../../repos/pms/billing/card-payments";
import type { PublicClinic } from "../../portal/public-clinic";
import { cardDeps, completePortalPayment, completeSaveCard, portalInvoices, type CardDeps } from "./service";

export interface PortalCardsView {
  invoices: { id: string; number: string; dueOn: string | null; balancePence: number }[];
  testMode: boolean;
  savedCards: string[];
  consent: { plain: string; withNoShow: string | null };
}

export async function portalCardsFor(ctx: RepoContext, clinic: PublicClinic, patientId: string, back: { paid: string | null; card: string | null }, deps: CardDeps = cardDeps()): Promise<{ view: PortalCardsView | null; toast: string | null }> {
  try {
    let toast: string | null = null;
    if (back.paid) {
      const r = await completePortalPayment(ctx, clinic.tenantId, patientId, back.paid, deps);
      toast = r === "paid" ? "Thank you – your payment was received." : r === "pending" ? "Your payment is being confirmed. It will show here shortly." : null;
    }
    if (back.card && deps.config.ok) {
      const m = await getMandate(ctx, clinic.tenantId, back.card);
      const s = await getCardSettings(ctx, clinic.tenantId);
      if (m && m.patientId === patientId && s.accountRef) {
        const r = await completeSaveCard(ctx, clinic.tenantId, deps.config.config.api, s.accountRef, m.id);
        toast = r === "active" ? "Your card was saved." : r === "pending" ? "Your card is being confirmed." : null;
      }
    }
    const list = await portalInvoices(ctx, clinic.tenantId, patientId, deps);
    if (!list.payable) return { view: null, toast };
    const s = await getCardSettings(ctx, clinic.tenantId);
    const cards = (await listMandates(ctx, clinic.tenantId, patientId)).filter((m) => m.status === "active").map(mandateLabel);
    return {
      toast,
      view: {
        invoices: list.rows.map((r) => ({ id: r.id, number: r.number, dueOn: r.dueOn, balancePence: r.balancePence })),
        testMode: list.testMode,
        savedCards: cards,
        consent: { plain: cardConsentWording({ clinicName: clinic.name, noShowPolicy: null }), withNoShow: s.noShowEnabled && s.noShowPolicy ? cardConsentWording({ clinicName: clinic.name, noShowPolicy: s.noShowPolicy }) : null },
      },
    };
  } catch {
    // The portal never breaks because of card payments: the section is simply left out.
    return { view: null, toast: null };
  }
}
