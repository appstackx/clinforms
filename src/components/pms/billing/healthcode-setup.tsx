"use client";
/**
 * The Healthcode cards of the Set-up pages (docs/clinic-system/healthcode.md): what the clinic records so its
 * insurer bills can go through Healthcode. Presentational; the server checks every save again.
 */
import * as React from "react";
import { FormField, TextInput } from "@/components/pms/ui";
import { saveHealthcodeSettingsAction, savePayerHealthcodeAction } from "@/app/app/clinic/setup/actions";
import type { HealthcodeSettingsView, PayerHealthcodeView } from "@/modules/pms/billing/healthcode";
import { SetupCard, SetupError, SetupFormBar, SetupGrid, useSetupForm } from "@/components/pms/reporting/setup-kit";

/** HC06: the insurer's Healthcode identifier, the clinic's provider number with it, and whether bills need a diagnosis. */
export function PayerHealthcodeCard({ view }: { view: PayerHealthcodeView }) {
  const d = view.details;
  const f = useSetupForm({
    insurerCode: d?.insurerCode ?? "",
    providerNumber: d?.providerNumber ?? "",
    diagnosis: d?.diagnosisRequired === true ? "yes" : d?.diagnosisRequired === false ? "no" : "default",
  });
  const e = f.fieldErrors;
  return (
    <SetupCard title="Healthcode">
      <form
        className="flex flex-col gap-3"
        data-testid="payer-healthcode"
        onSubmit={(ev) => {
          ev.preventDefault();
          void f.submit(() => savePayerHealthcodeAction(view.referrerId, f.values), `Healthcode details saved for ${view.name}.`);
        }}
      >
        <p className="text-sm text-[#475569]">
          These details let the clinic&apos;s bills to {view.name} go through Healthcode. Use the values from the clinic&apos;s Healthcode registration and from the insurer.
        </p>
        <SetupGrid>
          <FormField id="hc-insurer-code" label="Healthcode insurer identifier" hint="As Healthcode lists the insurer, for example bup." error={e.insurerCode}>
            <TextInput value={f.values.insurerCode} onChange={(ev) => f.set("insurerCode", ev.target.value)} disabled={!view.canEdit} autoComplete="off" maxLength={12} />
          </FormField>
          <FormField id="hc-provider-number" label="Clinic's provider number with this insurer" hint="The number the insurer gave the clinic." error={e.providerNumber}>
            <TextInput value={f.values.providerNumber} onChange={(ev) => f.set("providerNumber", ev.target.value)} disabled={!view.canEdit} autoComplete="off" maxLength={30} />
          </FormField>
        </SetupGrid>
        <fieldset className="flex flex-col gap-1.5" disabled={!view.canEdit}>
          <legend className="mb-1 text-sm font-medium">Diagnosis code on every bill</legend>
          {(
            [
              ["default", `As usual for this insurer (${view.diagnosisDefault ? "needed" : "not needed"})`],
              ["yes", "Always needed"],
              ["no", "Not needed"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input type="radio" name={`hc-diagnosis-${view.referrerId}`} value={value} checked={f.values.diagnosis === value} onChange={() => f.set("diagnosis", value)} className="h-4 w-4 accent-[#0B7970]" />
              {label}
            </label>
          ))}
        </fieldset>
        {!view.canEdit ? <p className="text-sm text-[#475569]">Only an owner, or an administrator who works at every site, can change these.</p> : null}
        <SetupError error={f.error} />
        {view.canEdit ? <SetupFormBar dirty={f.dirty} saving={f.saving} onDiscard={f.discard} testId="payer-healthcode-save" /> : null}
      </form>
    </SetupCard>
  );
}

/** HC07: the clinic's Healthcode Site ID and payee provider number, and a site's own where it is registered separately. */
export function HealthcodeSettingsCard({ view }: { view: HealthcodeSettingsView }) {
  const s = view.settings;
  const f = useSetupForm({
    siteCode: s.clinic.siteCode ?? "",
    payeeProviderNumber: s.clinic.payeeProviderNumber ?? "",
    sites: view.sites.map((x) => ({ siteId: x.id, siteCode: s.sites[x.id]?.siteCode ?? "", payeeProviderNumber: s.sites[x.id]?.payeeProviderNumber ?? "" })),
  });
  const e = f.fieldErrors;
  const setSite = (i: number, k: "siteCode" | "payeeProviderNumber", v: string) => f.set("sites", f.values.sites.map((row, j) => (j === i ? { ...row, [k]: v } : row)));
  return (
    <SetupCard title="Healthcode">
      <form
        className="flex flex-col gap-4"
        data-testid="healthcode-settings"
        onSubmit={(ev) => {
          ev.preventDefault();
          void f.submit(() => saveHealthcodeSettingsAction(f.values), "Healthcode settings saved.");
        }}
      >
        <p className="text-sm text-[#475569]">
          The clinic&apos;s Healthcode Site ID and the provider number insurers pay. Both come with the clinic&apos;s Healthcode registration. A site registered on its own can have its own; leave a site blank to use the clinic&apos;s.
        </p>
        <SetupGrid>
          <FormField id="hc-site-code" label="Healthcode Site ID" error={e.siteCode}>
            <TextInput value={f.values.siteCode} onChange={(ev) => f.set("siteCode", ev.target.value)} disabled={!view.canEdit} autoComplete="off" maxLength={20} data-testid="hc-site-code" />
          </FormField>
          <FormField id="hc-payee" label="Payee provider number" hint="Who the insurers pay." error={e.payeeProviderNumber}>
            <TextInput value={f.values.payeeProviderNumber} onChange={(ev) => f.set("payeeProviderNumber", ev.target.value)} disabled={!view.canEdit} autoComplete="off" maxLength={30} />
          </FormField>
        </SetupGrid>
        {view.sites.length > 1 ? (
          <div className="flex flex-col gap-2">
            <h3 className="m-0 text-sm font-semibold">Sites registered on their own (optional)</h3>
            {f.values.sites.map((row, i) => {
              const name = view.sites[i]?.name ?? "Site";
              return (
                <div key={row.siteId} className="grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] items-end gap-3 border-t border-[#F1F5F9] pt-2">
                  <p className="m-0 pb-2 text-sm font-medium">{name}</p>
                  <FormField id={`hc-site-code-${row.siteId}`} label={`Site ID for ${name}`} error={e[`siteCode-${row.siteId}`]}>
                    <TextInput value={row.siteCode} placeholder={f.values.siteCode || "The clinic's"} onChange={(ev) => setSite(i, "siteCode", ev.target.value)} disabled={!view.canEdit} autoComplete="off" maxLength={20} />
                  </FormField>
                  <FormField id={`hc-payee-${row.siteId}`} label={`Payee provider number for ${name}`} error={e[`payeeProviderNumber-${row.siteId}`]}>
                    <TextInput value={row.payeeProviderNumber} placeholder={f.values.payeeProviderNumber || "The clinic's"} onChange={(ev) => setSite(i, "payeeProviderNumber", ev.target.value)} disabled={!view.canEdit} autoComplete="off" maxLength={30} />
                  </FormField>
                </div>
              );
            })}
          </div>
        ) : null}
        <SetupError error={f.error} />
        {view.canEdit ? <SetupFormBar dirty={f.dirty} saving={f.saving} onDiscard={f.discard} testId="healthcode-settings-save" /> : null}
      </form>
    </SetupCard>
  );
}
