import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InvoiceDetail } from "@/components/pms/billing/invoice-detail";
import { InvoiceHealthcodePanel } from "@/components/pms/billing/invoice-healthcode";
import { invoiceHealthcodeFor } from "@/server/pms/billing/healthcode";
import { requireClinicActor } from "@/server/pms/actor";
import { printInvoiceFor, invoiceDetailFor, printClinicOf } from "@/server/pms/billing/views";
import { getPmsSettings } from "@/server/repos/pms/settings";
import { pmsNow } from "../../../../../../modules/pms/core/clock";
import { InvoiceCardPanel } from "@/components/pms/billing/invoice-card-panel";
import { invoiceCardViewFor } from "@/server/pms/billing/connect/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invoice" };

/**
 * /app/clinic/billing/invoices/[invoiceId] (design round 2f): one invoice. billing.view; each action needs its own
 * permission (pay, refund, void, edit) – the buttons a member may not use are left out, and the server checks again.
 * An invoice of another clinic, or of a site the member cannot see, is the 404 page.
 */
export default async function InvoicePage({ params }: { params: { invoiceId: string } }) {
  const actor = await requireClinicActor({ permission: "billing.view" });
  const detail = await invoiceDetailFor(actor, params.invoiceId);
  if (!detail.ok) notFound();
  const inv = detail.value;
  const printed = inv.status === "issued" ? await printInvoiceFor(actor, inv.id) : null;
  const settings = await getPmsSettings(actor.repo(), actor.tenantId);
  const hc = await invoiceHealthcodeFor(actor, inv.id);
  // Card payments (the clinic's own payment account): null while switched off or not set up.
  const cards = await invoiceCardViewFor(actor, inv.id);
  const cardPanel = cards.ok && cards.value ? <InvoiceCardPanel view={cards.value} /> : null;
  const hcPanel = hc.ok && hc.value ? <InvoiceHealthcodePanel view={hc.value} /> : null;
  return (
    <InvoiceDetail
      invoice={inv}
      clinic={printed?.ok ? printed.value.clinic : await printClinicOf(actor, null)}
      howToPay={printed?.ok ? printed.value.howToPay : []}
      printedBy={actor.name || actor.email}
      printedAt={pmsNow().toISOString()}
      demo={settings.isDemo}
      can={{ edit: actor.can("billing.edit"), pay: actor.can("billing.pay"), refund: actor.can("billing.refund"), void: actor.can("billing.void") }}
      extra={
        cardPanel || hcPanel ? (
          <>
            {cardPanel}
            {hcPanel}
          </>
        ) : null
      }
    />
  );
}
