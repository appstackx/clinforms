"use client";
import { useFormState } from "react-dom";
import { Field, Notice } from "@/components/account/shell";
import { CopyButton, SubmitButton } from "@/components/account/form-controls";
import { regenerateBackupCodes, type BackupCodesResult } from "./actions";

export function BackupCodesForm() {
  const [state, action] = useFormState(regenerateBackupCodes, null as BackupCodesResult | null);
  if (state?.ok === true) {
    return (
      <div className="space-y-3">
        <Notice tone="success">New backup codes made. Your old codes no longer work. Save these now: they are shown only once.</Notice>
        <ul className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-sm sm:grid-cols-5" aria-label="Backup codes">
          {state.codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <CopyButton value={state.codes.join("\n")} label="Copy all codes" />
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="min-w-[16rem] flex-1">
        <Field label="Your password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <SubmitButton variant="secondary" pendingText="Making codes…">
        Make new backup codes
      </SubmitButton>
      {state?.ok === false ? (
        <div className="w-full">
          <Notice tone="error">{state.error}</Notice>
        </div>
      ) : null}
    </form>
  );
}
