"use client";
import { useFormState } from "react-dom";
import { Field, Notice } from "@/components/account/shell";
import { SecretBox, SubmitButton } from "@/components/account/form-controls";
import { RETENTION_MAX_DAYS, RETENTION_MIN_DAYS } from "@/lib/account-copy";
import { createClinicAction, type CreateClinicResult } from "./actions";

const UK_DATE = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric" });

export function CreateClinicForm() {
  const [state, action] = useFormState(createClinicAction, null as CreateClinicResult | null);
  return (
    <div className="space-y-4">
      <form action={action} className="grid gap-4 sm:grid-cols-2">
        <Field label="Clinic name" name="name" required maxLength={200} autoComplete="off" placeholder="Riverside Physiotherapy" />
        <Field
          label="Clinic id"
          name="slug"
          required
          minLength={3}
          maxLength={63}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          autoComplete="off"
          placeholder="riverside-physio"
          hint="Lower-case letters, digits and single hyphens. It can never be changed or reused."
        />
        <Field label="Owner's email address" name="ownerEmail" type="email" required autoComplete="off" hint="They receive the owner invitation." />
        <Field
          label="Keep reports for (days)"
          name="retentionDays"
          type="number"
          inputMode="numeric"
          defaultValue={365}
          hint={`${RETENTION_MIN_DAYS}–${RETENTION_MAX_DAYS} days. The clinic can change it later.`}
        />
        <div className="sm:col-span-2">
          <SubmitButton pendingText="Creating…" confirmText="Create this clinic? Its id can never be changed or reused. Only do this once the data processing agreement is signed.">
            Create clinic and invite the owner
          </SubmitButton>
        </div>
      </form>
      {state?.ok === false ? <Notice tone="error">{state.error}</Notice> : null}
      {state?.ok === true ? (
        <div className="space-y-3">
          <Notice tone="success">
            {state.clinicName} ({state.tenantId}) is set up.{" "}
            {state.emailSent ? "The invitation was emailed to the owner." : "Email is off, so nothing was sent: pass the link below to the owner yourself."}
          </Notice>
          <SecretBox
            label="Owner invitation link"
            value={state.inviteLink}
            note={`Shown only this once. It works once and expires on ${UK_DATE.format(new Date(state.expiresAt))}.`}
          />
        </div>
      ) : null}
    </div>
  );
}
