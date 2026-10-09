"use client";
import { useFormState } from "react-dom";
import { Field, Notice } from "@/components/account/shell";
import { SubmitButton } from "@/components/account/form-controls";
import { RETENTION_MAX_DAYS, RETENTION_MIN_DAYS } from "@/lib/account-copy";
import type { ActionResult } from "@/server/auth/session";
import { saveClinicProfile } from "./actions";

export interface ClinicFormValues {
  displayName: string;
  legalName: string;
  address: string;
  postcode: string;
  phone: string;
  email: string;
  retentionDays: number;
  draftingEnabled: boolean;
}

export function ClinicProfileForm({ values, editable }: { values: ClinicFormValues; editable: boolean }) {
  const [state, action] = useFormState(saveClinicProfile, null as ActionResult | null);
  return (
    <form action={action} className="space-y-4">
      {state?.ok === true ? <Notice tone="success">Saved.</Notice> : null}
      {state?.ok === false ? <Notice tone="error">{state.error}</Notice> : null}
      <fieldset disabled={!editable} className="space-y-4 disabled:opacity-80">
        <Field label="Clinic name" name="displayName" defaultValue={values.displayName} required maxLength={200} hint="Written on the forms you complete." />
        <Field label="Legal name" name="legalName" defaultValue={values.legalName} maxLength={200} hint="If different, for example a limited company." />
        <div className="space-y-1.5">
          <label htmlFor="f-address" className="block text-sm font-medium text-slate-800">
            Address
          </label>
          <textarea
            id="f-address"
            name="address"
            defaultValue={values.address}
            rows={3}
            className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
            aria-describedby="f-address-hint"
          />
          <p id="f-address-hint" className="text-xs text-slate-500">
            One line per row, without the postcode.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Postcode" name="postcode" defaultValue={values.postcode} maxLength={16} autoComplete="postal-code" />
          <Field label="Phone" name="phone" type="tel" defaultValue={values.phone} maxLength={40} inputMode="tel" />
        </div>
        <Field label="Email for referrers" name="email" type="email" defaultValue={values.email} maxLength={254} />
        <Field
          label="Keep reports for (days)"
          name="retentionDays"
          type="number"
          inputMode="numeric"
          defaultValue={values.retentionDays}
          required
          hint={`How long completed reports are kept: ${RETENTION_MIN_DAYS}–${RETENTION_MAX_DAYS} days. Automatic deletion after this period is coming soon.`}
        />
        <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <input
            id="f-drafting"
            name="draftingEnabled"
            type="checkbox"
            value="on"
            defaultChecked={values.draftingEnabled}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
            aria-describedby="f-drafting-hint"
          />
          <div>
            <label htmlFor="f-drafting" className="block text-sm font-medium text-slate-800">
              Draft answers from the notes
            </label>
            <p id="f-drafting-hint" className="text-xs text-slate-500">
              When this is on, ClinForms drafts each answer from the patient&apos;s notes, with the source of every fact, for a
              clinician to review and approve. When it is off, your clinicians complete the answers themselves.
            </p>
          </div>
        </div>
      </fieldset>
      {editable ? <SubmitButton pendingText="Saving…">Save clinic details</SubmitButton> : null}
    </form>
  );
}
