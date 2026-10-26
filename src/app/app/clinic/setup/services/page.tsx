import type { Metadata } from "next";
import { Notice, PageHeader, Panel } from "@/components/account/shell";
import { ServiceForm } from "@/components/pms/reporting/setup-directory";
import { formatPence } from "@/modules/pms/core/text";
import { SERVICE_CATEGORY_LABELS, SETUP_COPY, labelOf } from "@/modules/pms/reporting/copy";
import { penceToInput } from "@/modules/pms/reporting/forms";
import { requireClinicActor } from "@/server/pms/actor";
import { siteScopeOf } from "@/server/pms/reporting/scope";
import { listServices } from "@/server/repos/pms/directory";
import { createServiceAction, updateServiceAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Appointment types" };

export default async function ServicesSetupPage() {
  const actor = await requireClinicActor({ permission: "settings.manage" });
  const [services, scope] = await Promise.all([listServices(actor.repo(), actor.tenantId, { includeInactive: true }), siteScopeOf(actor)]);
  const editable = scope.all;
  return (
    <>
      <PageHeader title="Appointment types" description="What can be booked, how long it takes and its standard price. Insurers' own prices are set in the price lists." />
      {!editable ? (
        <div className="mb-4">
          <Notice>{SETUP_COPY.unscopedOnly}</Notice>
        </div>
      ) : null}
      <Panel title={`Appointment types (${services.length})`}>
        {services.length === 0 ? <p className="text-sm text-slate-600">None yet. Add the first one below.</p> : null}
        <ul className="space-y-2">
          {services.map((s) => (
            <li key={s.id}>
              <details className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium text-slate-900">
                    {s.colour ? <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full border border-slate-300" style={{ backgroundColor: s.colour }} aria-hidden /> : null}
                    {s.name}
                    {!s.active ? <span className="ml-2 text-xs font-normal text-slate-600">(switched off)</span> : null}
                  </span>
                  <span className="text-slate-600">
                    {labelOf(SERVICE_CATEGORY_LABELS, s.category)} · {s.durationMinutes} min{s.bufferMinutes ? ` + ${s.bufferMinutes}` : ""} · {s.defaultPricePence !== null ? formatPence(s.defaultPricePence) : "no standard price"}
                    {s.onlineBookable ? " · online" : ""}
                  </span>
                </summary>
                {editable ? (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <ServiceForm
                      action={updateServiceAction}
                      submitLabel="Save appointment type"
                      values={{
                        id: s.id,
                        name: s.name,
                        code: s.code ?? "",
                        category: s.category,
                        durationMinutes: s.durationMinutes,
                        bufferMinutes: s.bufferMinutes,
                        price: penceToInput(s.defaultPricePence),
                        colour: s.colour ?? "",
                        onlineBookable: s.onlineBookable,
                        active: s.active,
                        sortOrder: s.sortOrder,
                      }}
                    />
                  </div>
                ) : null}
              </details>
            </li>
          ))}
        </ul>
      </Panel>
      {editable ? (
        <Panel title="Add an appointment type" className="mt-6">
          <ServiceForm action={createServiceAction} submitLabel="Add appointment type" />
        </Panel>
      ) : null}
    </>
  );
}
