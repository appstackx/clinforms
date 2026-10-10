"use client";
import { useFormState } from "react-dom";
import { Field, Notice } from "@/components/account/shell";
import { SecretBox, SubmitButton } from "@/components/account/form-controls";
import { createApiKey, type CreateKeyResult } from "./actions";

export function CreateKeyForm() {
  const [state, action] = useFormState(createApiKey, null as CreateKeyResult | null);
  return (
    <div className="space-y-4">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1">
          <Field label="Key name" name="name" required maxLength={80} placeholder="Practice system" />
        </div>
        <SubmitButton pendingText="Creating…">Create key</SubmitButton>
      </form>
      {state?.ok === false ? <Notice tone="error">{state.error}</Notice> : null}
      {state?.ok === true ? (
        <SecretBox
          label={`New key: ${state.name}`}
          value={state.key}
          note="Copy it now and store it in your practice system's settings. It is shown only this once; ClinForms keeps only a fingerprint of it."
        />
      ) : null}
    </div>
  );
}
