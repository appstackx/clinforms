import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BILLING_PATH } from "@/components/pms/billing/format";
import { PRINT_CSS, PrintInvoiceSheet } from "@/components/pms/billing/print-sheets";
import { PrintToolbar } from "@/components/pms/billing/print-toolbar";
import { requireClinicActor } from "@/server/pms/actor";
import { printInvoiceFor } from "@/server/pms/billing/views";
import { getPmsSettings } from "@/server/repos/pms/settings";
import { ScrollRegion } from "@/components/pms/ui/scroll-region";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Print invoice" };

/** /app/clinic/billing/invoices/[invoiceId]/print (design round 3 "Print – invoice A4"): the A4 sheet; only it prints. */
export default async function PrintInvoicePage({ params }: { params: { invoiceId: string } }) {
  const actor = await requireClinicActor({ permission: "billing.view" });
  const r = await printInvoiceFor(actor, params.invoiceId);
  if (!r.ok) notFound();
  const settings = await getPmsSettings(actor.repo(), actor.tenantId);
  return (
    <div className="flex flex-col gap-4">
      <style>{PRINT_CSS}</style>
      <PrintToolbar backHref={`${BILLING_PATH}/invoices/${params.invoiceId}`} backLabel="Back to the invoice" />
      <ScrollRegion label="Invoice" className="print-root overflow-x-auto">
        <div className="mx-auto w-fit shadow-[0_8px_24px_rgba(15,23,42,0.12)]">
          <PrintInvoiceSheet clinic={r.value.clinic} invoice={r.value.invoice} howToPay={r.value.howToPay} printedBy={r.value.printedBy} printedAt={r.value.printedAt} demo={settings.isDemo} />
        </div>
      </ScrollRegion>
    </div>
  );
}
