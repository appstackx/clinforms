import type { Metadata } from "next";
import Link from "next/link";
import { Notice, PageHeader, Panel } from "@/components/account/shell";
import { PriceListForm } from "@/components/pms/reporting/setup-directory";
import { formatUkDate } from "@/modules/pms/core/text";
import { SETUP_PATH } from "@/modules/pms/reporting/catalogue";
import { PAYER_TYPE_LABELS, SETUP_COPY, labelOf } from "@/modules/pms/reporting/copy";
import { requireClinicActor } from "@/server/pms/actor";
import { siteScopeOf } from "@/server/pms/reporting/scope";
import { listPriceLists } from "@/server/repos/pms/price-lists";
import { listReferrers } from "@/server/repos/pms/referrers";
import { createPriceListAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Prices" };

export default async function PricesSetupPage() {
  const actor = await requireClinicActor({ permission: "settings.manage" });
  const ctx = actor.repo();
  const [lists, payers, scope] = await Promise.all([
    listPriceLists(ctx, actor.tenantId, { includeInactive: true }),
    listReferrers(ctx, actor.tenantId, { kind: ["insurer", "mlc", "solicitor", "employer", "case_manager"], limit: 500 }),
    siteScopeOf(actor),
  ]);
  const payerName = new Map(payers.map((p) => [p.id, p.name]));
  return (
    <>
      <PageHeader title="Prices" description="Price lists: the self-pay prices and each insurer's or medico-legal company's agreed prices. A case uses its payer's list, then the default list, then the appointment type's standard price." />
      {!scope.all ? (
        <div className="mb-4">
          <Notice>{SETUP_COPY.unscopedOnly}</Notice>
        </div>
      ) : null}
      <Panel title={`Price lists (${lists.length})`}>
        {lists.length === 0 ? (
          <p className="text-sm text-slate-600">No price lists yet: every appointment uses its type's standard price.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {lists.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-slate-900">
                    {l.name}
                    {l.isDefault ? <span className="ml-2 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-900">Default</span> : null}
                    {!l.active ? <span className="ml-2 text-xs font-normal text-slate-600">(not in use)</span> : null}
                  </p>
                  <p className="text-xs text-slate-600">
                    {l.referrerId ? (payerName.get(l.referrerId) ?? "A payer's own list") : l.payerType ? labelOf(PAYER_TYPE_LABELS, l.payerType) : "Any payer"}
                    {l.validFrom || l.validTo ? ` · ${l.validFrom ? formatUkDate(l.validFrom) : "…"} to ${l.validTo ? formatUkDate(l.validTo) : "…"}` : ""}
                  </p>
                </div>
                <Link href={`${SETUP_PATH}/prices/${l.id}`} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">
                  Prices<span className="sr-only"> of {l.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {scope.all ? (
        <Panel title="Add a price list" className="mt-6">
          <PriceListForm action={createPriceListAction} payers={payers.map((p) => ({ value: p.id, label: p.name }))} submitLabel="Add price list" />
        </Panel>
      ) : null}
    </>
  );
}
