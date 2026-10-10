"use client";
import Link from "next/link";
import { useFormState } from "react-dom";
import { Field, Notice } from "@/components/account/shell";
import { SubmitButton } from "@/components/account/form-controls";
import { PASSWORD_MIN_LENGTH } from "@/lib/account-copy";
import { createAccountAndJoin, joinAsSignedIn, type AcceptState } from "./actions";

const IDLE: AcceptState = { status: "idle" };

export function CreateAccountForm({ token, email }: { token: string; email: string }) {
  const [state, action] = useFormState(createAccountAndJoin, IDLE);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {state.status === "error" ? <Notice tone="error">{state.error}</Notice> : null}
      <Field label="Email address" name="email" type="email" defaultValue={email} readOnly autoComplete="username" />
      <Field label="Full name" name="name" autoComplete="name" required maxLength={100} hint="As it should appear on forms you complete or sign." />
      <Field
        label="Choose a password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN_LENGTH}
        hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short sentence is easy to remember and hard to guess.`}
      />
      <Field label="Repeat the password" name="confirm" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} />
      <SubmitButton className="w-full" pendingText="Creating your account…">
        Create account and join
      </SubmitButton>
      <p className="text-center text-xs text-slate-500">
        By creating an account you agree to the{" "}
        <Link href="/terms" className="font-medium text-teal-700 underline underline-offset-2">
          terms
        </Link>
        . Our{" "}
        <Link href="/privacy" className="font-medium text-teal-700 underline underline-offset-2">
          privacy policy
        </Link>{" "}
        explains how your account details are used.
      </p>
    </form>
  );
}

export function JoinForm({ token, clinicName }: { token: string; clinicName: string }) {
  const [state, action] = useFormState(joinAsSignedIn, IDLE);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {state.status === "error" ? <Notice tone="error">{state.error}</Notice> : null}
      <SubmitButton className="w-full" pendingText="Joining…">
        Join {clinicName}
      </SubmitButton>
    </form>
  );
}
