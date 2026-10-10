"use client";
import { useEffect, useState } from "react";
import { useFormState } from "react-dom";
import { Field, Notice, TextLink } from "@/components/account/shell";
import { SubmitButton } from "@/components/account/form-controls";
import { codeStep, passwordStep, type LoginState } from "./actions";

const IDLE: LoginState = { status: "idle" };

export function LoginForm({ next }: { next: string }) {
  const [attempt, setAttempt] = useState(0);
  return <LoginSteps key={attempt} next={next} onRestart={() => setAttempt((n) => n + 1)} />;
}

function LoginSteps({ next, onRestart }: { next: string; onRestart: () => void }) {
  const [pwState, pwAction] = useFormState(passwordStep, IDLE);
  const [codeState, codeAction] = useFormState(codeStep, IDLE);
  const [useBackup, setUseBackup] = useState(false);
  // Signed in: load the next page in full, so nothing held in memory before this sign-in survives it.
  const done = codeState.status === "done" ? codeState.next : null;
  useEffect(() => {
    if (done) window.location.assign(done);
  }, [done]);

  if (pwState.status !== "code") {
    return (
      <form action={pwAction} className="space-y-4">
        {pwState.status === "error" ? <Notice tone="error">{pwState.error}</Notice> : null}
        <Field label="Email address" name="email" type="email" autoComplete="username" required />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
        <SubmitButton className="w-full" pendingText="Signing in…">
          Continue
        </SubmitButton>
        <p className="text-center text-sm text-slate-600">
          <TextLink href="/reset-password">Forgotten your password?</TextLink>
        </p>
      </form>
    );
  }

  return (
    <form action={codeAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="method" value={useBackup ? "backup" : "totp"} />
      {codeState.status === "error" ? (
        <Notice tone="error">
          {codeState.error}{" "}
          {codeState.restart ? (
            <button type="button" onClick={onRestart} className="font-semibold underline">
              Sign in again
            </button>
          ) : null}
        </Notice>
      ) : (
        <Notice>
          {useBackup
            ? "Enter one of your backup codes. Each code works once."
            : "Open your authenticator app and enter the 6-digit code for ClinForms."}
        </Notice>
      )}
      {useBackup ? (
        <Field key="backup" label="Backup code" name="code" autoComplete="one-time-code" required maxLength={32} />
      ) : (
        <Field key="totp" label="6-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={6} pattern="[0-9 ]{6,7}" />
      )}
      <SubmitButton className="w-full" pendingText="Checking…">
        Sign in
      </SubmitButton>
      <p className="text-center text-sm">
        <button type="button" onClick={() => setUseBackup((v) => !v)} className="font-medium text-teal-700 underline-offset-4 hover:underline">
          {useBackup ? "Use my authenticator app instead" : "I can't use my authenticator app"}
        </button>
      </p>
    </form>
  );
}
