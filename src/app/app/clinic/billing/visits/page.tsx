import type { Metadata } from "next";
import Link from "next/link";
import { BILLING_PATH } from "@/components/pms/billing/format";
import { VisitsTable } from "@/components/pms/billing/visits-table";
import { requireClinicActor } from "@/server/pms/actor";
import { uninvoicedVisitsFor } from "@/server/pms/billing/views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invoice visits" };

/**
 * /app/clinic/billing/visits (design round 3 "Invoice attended visits"): completed visits, and missed or
 * late-cancelled ones with a fee, up to today without an invoice – Choose visits → Preview drafts → Issue and send.
 * billing.edit. The lines are built again on the server from the diary; the screen sends appointment ids only.
 */
export default async function InvoiceVisitsPage() {
  const actor = await requireClinicActor({ permission: "billing.edit" });
  const r = await uninvoicedVisitsFor(actor);
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1232px] flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-[#475569]">
        <Link href={BILLING_PATH} className="text-primary-strong underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          Billing
        </Link>
        <span aria-hidden> / </span>
        <span>Invoice visits</span>
      </nav>
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Invoice visits</h1>
        <p className="text-sm text-[#475569]">Visits up to today that don&apos;t have an invoice yet.</p>
      </div>
      {r.ok ? <VisitsTable visits={r.value.visits} mode="stepper" today={r.value.until} from={r.value.from} until={r.value.until} /> : <p role="alert">{r.error}</p>}
    </div>
  );
}
