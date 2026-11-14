"use client";
import { useFormState } from "react-dom";
import { Field } from "@/components/account/shell";
import { FormResult, SubmitButton } from "@/components/account/form-controls";
import { DRAFTING_COPY, RETENTION_COPY, RETENTION_MAX_DAYS, RETENTION_MIN_DAYS } from "@/lib/account-copy";
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

/** `trial`: the clinic's (hand-set) trial runs now – drafting is worded for made-up notes only. `selfServe`: the clinic
 * signed up online – drafting was switched on at sign-up (14/11/2026), worded so. */
/**
 * `reports` (01/11/2026): the clinic has Reports – false (a ClinDesk clinic without the add-on) leaves out the
 * reports-only fields (kept as hidden values, so saving never changes them) and words the rest for the clinic.
 */
export function ClinicProfileForm({ values, editable, trial = false, selfServe = false, reports = true }: { values: ClinicFormValues; editable: boolean; trial?: boolean; selfServe?: boolean; reports?: boolean }) {
  const [state, action] = useFormState(saveClinicProfile, null as ActionResult | null);
  return (
    <form action={action} className="space-y-4">
      <fieldset disabled={!editable} className="space-y-4 disabled:opacity-80">
        <Field label="Clinic name" name="displayName" defaultValue={values.displayName} required maxLength={200} hint={reports ? "Written on the forms you complete." : undefined} />
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
        <Field label={reports ? "Email for referrers" : "Clinic email"} name="email" type="email" defaultValue={values.email} maxLength={254} />
        {reports ? (
          <>
            <Field
              label="Keep reports for (days)"
              name="retentionDays"
              type="number"
              inputMode="numeric"
              defaultValue={values.retentionDays}
              required
              hint={RETENTION_COPY.hint(RETENTION_MIN_DAYS, RETENTION_MAX_DAYS)}
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
                  {DRAFTING_COPY.label}
                </label>
                <p id="f-drafting-hint" className="space-y-1 text-xs text-slate-500">
                  <span className="block">{DRAFTING_COPY.whatItDoes}</span>
                  <span className="block" data-testid="drafting-when">
                    {selfServe ? DRAFTING_COPY.whenSelfServe : trial ? DRAFTING_COPY.whenToSwitchOnTrial : DRAFTING_COPY.whenToSwitchOn}
                  </span>
                </p>
              </div>
            </div>
          </>
        ) : (
          <>
            <input type="hidden" name="retentionDays" value={values.retentionDays} />
            {values.draftingEnabled ? <input type="hidden" name="draftingEnabled" value="on" /> : null}
          </>
        )}
      </fieldset>
      {editable ? (
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingText="Saving…">Save clinic details</SubmitButton>
          <FormResult state={state} />
        </div>
      ) : null}
    </form>
  );
}
