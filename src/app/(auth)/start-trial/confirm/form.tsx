"use client";
import { useFormState } from "react-dom";
import { Field, Notice, TextLink } from "@/components/account/shell";
import { SubmitButton } from "@/components/account/form-controls";
import { PASSWORD_MAX_LENGTH } from "@/lib/account-copy";
import { confirmTrial, type ConfirmTrialState } from "../actions";

const IDLE: ConfirmTrialState = { status: "idle" };

export function ConfirmTrialForm({ token, email }: { token: string; email: string }) {
  const [state, action] = useFormState(confirmTrial, IDLE);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {state.status === "error" ? (
        <Notice tone="error">
          {state.error}
          {state.signIn ? (
            <>
              {" "}
              <TextLink href="/login">Sign in</TextLink>
            </>
          ) : null}
        </Notice>
      ) : null}
      <Field label="Email address" name="email" type="email" defaultValue={email} readOnly autoComplete="username" />
      <Field label="Your password" name="password" type="password" autoComplete="current-password" required maxLength={PASSWORD_MAX_LENGTH} />
      <SubmitButton className="w-full" pendingText="Creating your clinic…">
        Confirm and create my clinic
      </SubmitButton>
      <p className="text-center text-xs text-slate-500">Next you will set up two-step verification, then choose your plan.</p>
    </form>
  );
}
