import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Panel } from "@/components/account/shell";
import { PriceItemForm, PriceListForm } from "@/components/pms/reporting/setup-directory";
import { RemoveButton } from "@/components/pms/reporting/setup-sites";
import { formatPence } from "@/modules/pms/core/text";
import { SETUP_PATH } from "@/modules/pms/reporting/catalogue";
import { penceToInput } from "@/modules/pms/reporting/forms";
import { requireClinicActor } from "@/server/pms/actor";
import { siteScopeOf } from "@/server/pms/reporting/scope";
import { listServices } from "@/server/repos/pms/directory";
import { getPriceList, listPriceListItems } from "@/server/repos/pms/price-lists";
import { listReferrers } from "@/server/repos/pms/referrers";
import { removePriceAction, setPriceAction, updatePriceListAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Price list" };

export default async function PriceListSetupPage({ params }: { params: { priceListId: string } }) {
  const actor = await requireClinicActor({ permission: "settings.manage" });
  const ctx = actor.repo();
  const list = await getPriceList(ctx, actor.tenantId, params.priceListId);
  if (!list) notFound();
  const [items, services, payers, scope] = await Promise.all([
    listPriceListItems(ctx, actor.tenantId, list.id),
    listServices(ctx, actor.tenantId, { includeInactive: true }),
    listReferrers(ctx, actor.tenantId, { kind: ["insurer", "mlc", "solicitor", "employer", "case_manager"], limit: 500 }),
    siteScopeOf(actor),
  ]);
  const editable = scope.all;
  const serviceName = new Map(services.map((s) => [s.id, s.name]));
  const priced = new Set(items.map((i) => i.serviceId));
  const unpriced = services.filter((s) => s.active && !priced.has(s.id));
  return (
    <>
      <p className="mb-2 text-sm">
        <Link href={`${SETUP_PATH}/prices`} className="font-medium text-teal-700 underline-offset-4 hover:underline">
          ← Prices
        </Link>
      </p>
      <PageHeader title={list.name} description="The prices on this list. An appointment type without a price here uses the default list, then its standard price." />
      <Panel title={`Prices (${items.length})`}>
        {items.length === 0 ? <p className="mb-4 text-sm text-slate-600">No prices on this list yet.</p> : null}
        <ul className="mb-4 space-y-2">
          {items.map((i) => (
            <li key={i.id}>
              <details className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium text-slate-900">{serviceName.get(i.serviceId) ?? "Appointment type"}</span>
                  <span className="tabular-nums text-slate-700">
                    {formatPence(i.pricePence)}
                    {i.billingCode ? <span className="ml-2 font-mono text-xs">{i.billingCode}</span> : null}
                  </span>
                </summary>
                {editable ? (
                  <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                    <PriceItemForm action={setPriceAction} priceListId={list.id} serviceId={i.serviceId} price={penceToInput(i.pricePence)} billingCode={i.billingCode ?? ""} submitLabel="Save price" />
                    <RemoveButton action={removePriceAction} hidden={{ priceListId: list.id, serviceId: i.serviceId }} label="Remove from this list" confirmText="Remove this price from the list?" />
                  </div>
                ) : null}
              </details>
            </li>
          ))}
        </ul>
        {editable && unpriced.length > 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Add a price</h3>
            <PriceItemForm action={setPriceAction} priceListId={list.id} services={unpriced.map((s) => ({ value: s.id, label: s.name }))} submitLabel="Add price" />
          </div>
        ) : null}
      </Panel>
      {editable ? (
        <Panel title="This list" className="mt-6">
          <PriceListForm
            action={updatePriceListAction}
            payers={payers.map((p) => ({ value: p.id, label: p.name }))}
            submitLabel="Save price list"
            values={{ id: list.id, name: list.name, payerType: list.payerType ?? "", referrerId: list.referrerId ?? "", isDefault: list.isDefault, validFrom: list.validFrom ?? "", validTo: list.validTo ?? "", active: list.active }}
          />
        </Panel>
      ) : null}
    </>
  );
}
