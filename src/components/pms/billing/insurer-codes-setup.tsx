"use client";
/**
 * Set-up → Insurer treatment codes (HC09, docs/clinic-system/healthcode.md): one insurer at a time, the insurer's
 * own code (ISC) for each service, next to the service's CCSD code. No code values are built in – the clinic types
 * them in from each insurer's schedule. The server checks every save again.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormField, PmsNotice, SelectInput, TextInput } from "@/components/pms/ui";
import { ScrollRegion } from "@/components/pms/ui/scroll-region";
import { saveInsurerCodesAction } from "@/app/app/clinic/setup/actions";
import type { InsurerCodesView } from "@/modules/pms/billing/healthcode";
import { SetupCard, SetupError, SetupFormBar, SetupHeader, SetupPage, setupFocus, useSetupForm } from "@/components/pms/reporting/setup-kit";

const BASE = "/app/clinic/setup";

export function InsurerCodesSetup({ view }: { view: InsurerCodesView }) {
  const router = useRouter();
  const insurer = view.insurers.find((i) => i.id === view.insurerId) ?? null;
  return (
    <SetupPage>
      <SetupHeader title="Insurer treatment codes" description="Each insurer's own code for every service the clinic bills them – Healthcode bills carry it on every treatment line." />
      {view.insurers.length === 0 ? (
        <PmsNotice tone="info" title="No insurers yet">
          Add the insurers the clinic works with under{" "}
          <Link href={`${BASE}/referrers?referrer=new&kind=insurer`} className={`text-primary-strong underline underline-offset-2 ${setupFocus}`}>
            Referrers and insurers
          </Link>
          , then give each service its code here.
        </PmsNotice>
      ) : (
        <>
          <div className="max-w-xs">
            <FormField id="insurer-codes-insurer" label="Insurer">
              <SelectInput value={view.insurerId ?? ""} onChange={(e) => router.push(`${BASE}/insurer-codes?insurer=${e.target.value}`)} data-testid="insurer-codes-insurer">
                {view.insurers.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </SelectInput>
            </FormField>
          </div>
          {insurer ? <CodesForm key={insurer.id} view={view} insurerId={insurer.id} insurerName={insurer.name} /> : null}
        </>
      )}
    </SetupPage>
  );
}

function CodesForm({ view, insurerId, insurerName }: { view: InsurerCodesView; insurerId: string; insurerName: string }) {
  const f = useSetupForm({ rows: view.services.map((s) => ({ serviceId: s.id, iscCode: s.iscCode })) });
  const e = f.fieldErrors;
  const missing = f.values.rows.filter((r, i) => view.services[i]?.active && !r.iscCode.trim()).length;
  return (
    <SetupCard title={`${insurerName} – treatment codes`} padded={false}>
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          void f.submit(() => saveInsurerCodesAction(insurerId, f.values.rows), `Treatment codes saved for ${insurerName}.`);
        }}
        data-testid="insurer-codes-form"
      >
        <p className="px-5 pt-4 text-sm text-[#475569]">
          {missing === 0 ? "Every service in use has a code for this insurer." : `${missing === 1 ? "1 service in use still needs" : `${missing} services in use still need`} a code for this insurer.`} CCSD codes are set on each service under{" "}
          <Link href={`${BASE}/services`} className={`text-primary-strong underline underline-offset-2 ${setupFocus}`}>
            Services
          </Link>
          .
        </p>
        <ScrollRegion label="Insurer treatment codes" className="relative mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <caption className="sr-only">Treatment codes for {insurerName}</caption>
            <thead>
              <tr className="bg-[#F8FAFC] text-left text-xs font-semibold text-[#475569]">
                <th scope="col" className="px-4 py-2.5">Service</th>
                <th scope="col" className="px-4 py-2.5">CCSD code</th>
                <th scope="col" className="px-4 py-2.5">Insurer code (ISC)</th>
              </tr>
            </thead>
            <tbody>
              {f.values.rows.map((row, i) => {
                const s = view.services[i];
                return (
                  <tr key={row.serviceId} className="border-t border-[#F1F5F9]" data-testid="insurer-code-row">
                    <td className="px-4 py-2 font-medium">{s?.active ? s.name : `${s?.name ?? "Service"} (switched off)`}</td>
                    <td className="px-4 py-2 font-mono text-xs">{s?.ccsdCode ?? "–"}</td>
                    <td className="px-4 py-2">
                      <FormField id={`isc-${row.serviceId}`} label={`Code for ${s?.name ?? "service"}`} hideLabel error={e[`isc-${row.serviceId}`]}>
                        <TextInput
                          value={row.iscCode}
                          onChange={(ev) => f.set("rows", f.values.rows.map((r, j) => (j === i ? { ...r, iscCode: ev.target.value } : r)))}
                          disabled={!view.canEdit}
                          autoComplete="off"
                          maxLength={20}
                          className="max-w-[200px]"
                        />
                      </FormField>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollRegion>
        <div className="px-5 pb-4">
          <SetupError error={f.error} />
          {view.canEdit ? <SetupFormBar dirty={f.dirty} saving={f.saving} onDiscard={f.discard} testId="insurer-codes-save" /> : <p className="pt-3 text-sm text-[#475569]">Only an owner, or an administrator who works at every site, can change these.</p>}
        </div>
      </form>
    </SetupCard>
  );
}
