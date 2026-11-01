"use client";
/**
 * The Healthcode cards of the Set-up pages (docs/clinic-system/healthcode.md): what the clinic records so its
 * insurer bills can go through Healthcode. Presentational; the server checks every save again.
 */
import * as React from "react";
import { FormField, TextInput } from "@/components/pms/ui";
import { savePayerHealthcodeAction } from "@/app/app/clinic/setup/actions";
import type { PayerHealthcodeView } from "@/modules/pms/billing/healthcode";
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
