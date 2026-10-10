"use client";
import { useFormState } from "react-dom";
import { Field, Notice, TextLink } from "@/components/account/shell";
import { SubmitButton } from "@/components/account/form-controls";
import { PASSWORD_MIN_LENGTH } from "@/lib/account-copy";
import { requestResetLink, setNewPassword, type ResetState } from "./actions";

const IDLE: ResetState = { status: "idle" };

export function RequestResetForm() {
  const [state, action] = useFormState(requestResetLink, IDLE);
  if (state.status === "sent") {
    return (
      <Notice tone="success">
        If an account exists for that address, we have sent it a link to choose a new password. The link expires in 2 hours.
      </Notice>
    );
  }
  return (
    <form action={action} className="space-y-4">
      {state.status === "error" ? <Notice tone="error">{state.error}</Notice> : null}
      <Field label="Email address" name="email" type="email" autoComplete="username" required />
      <SubmitButton className="w-full" pendingText="Sending…">
        Email me a reset link
      </SubmitButton>
    </form>
  );
}

export function NewPasswordForm({ token }: { token: string }) {
  const [state, action] = useFormState(setNewPassword, IDLE);
  if (state.status === "done") {
    return (
      <div className="space-y-4">
        <Notice tone="success">Your password has been changed and you have been signed out everywhere.</Notice>
        <p className="text-center text-sm">
          <TextLink href="/login">Sign in</TextLink>
        </p>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {state.status === "error" ? <Notice tone="error">{state.error}</Notice> : null}
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN_LENGTH}
        hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
      />
      <Field label="Repeat the new password" name="confirm" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} />
      <SubmitButton className="w-full" pendingText="Saving…">
        Change password
      </SubmitButton>
    </form>
  );
}
