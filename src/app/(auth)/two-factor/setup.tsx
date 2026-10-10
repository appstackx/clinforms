"use client";
import { useFormState } from "react-dom";
import Link from "next/link";
import { Field, Notice } from "@/components/account/shell";
import { CopyButton, SubmitButton } from "@/components/account/form-controls";
import { confirmSetup, startSetup, type ConfirmState, type SetupState } from "./actions";

const IDLE_SETUP: SetupState = { status: "idle" };
const IDLE_CONFIRM: ConfirmState = { status: "idle" };

export function TwoFactorSetup({ email, enabled }: { email: string; enabled: boolean }) {
  const [start, startAction] = useFormState(startSetup, IDLE_SETUP);
  const [confirm, confirmAction] = useFormState(confirmSetup, IDLE_CONFIRM);

  if (enabled || start.status === "done") {
    return (
      <div className="space-y-4">
        <Notice tone="success">Two-step verification is on for {email}.</Notice>
        <p className="text-sm text-slate-600">You can make new backup codes and see where you are signed in under Settings → Security.</p>
        <Link href="/app" className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800">
          Continue
        </Link>
      </div>
    );
  }

  if (start.status === "scan") {
    return (
      <form action={confirmAction} className="space-y-5">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">1. Add ClinForms to your authenticator app</h2>
          <p className="text-sm text-slate-600">
            Open an authenticator app on your phone (any app that shows six-digit sign-in codes works) and scan this code, or type the key
            below into the app.
          </p>
          <div className="flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URI, not an optimisable image */}
            <img src={start.qr} alt={`Authenticator set-up code for ${email}`} width={220} height={220} className="rounded-lg border border-slate-200" />
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <code className="min-w-0 font-mono text-xs text-slate-800">
              {start.manualKey.split(/\s+/).filter(Boolean).map((group, i) => (
                <span key={i} className="mr-1.5 inline-block whitespace-nowrap">
                  {group}
                </span>
              ))}
            </code>
            <CopyButton value={start.manualKey.replace(/\s+/g, "")} label="Copy key" />
          </div>
          {/* On the phone itself (fix wave 2): the authenticator app opens the set-up link; no second device needed. */}
          <a
            href={start.uri}
            className="flex h-10 w-full items-center justify-center rounded-lg border border-teal-700 px-4 text-sm font-semibold text-teal-800 hover:bg-teal-50 sm:hidden"
          >
            Open in the authenticator app on this phone
          </a>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">2. Save your backup codes</h2>
          <p className="text-sm text-slate-600">
            Each code signs you in once if you lose your phone. They are shown only now: store them somewhere safe, away from your phone.
          </p>
          <ul className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-sm" aria-label="Backup codes">
            {start.backupCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <CopyButton value={start.backupCodes.join("\n")} label="Copy all codes" />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="saved" required className="h-4 w-4 rounded border-slate-300" />
            I have saved my backup codes
          </label>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">3. Enter the code from the app</h2>
          {confirm.status === "error" ? <Notice tone="error">{confirm.error}</Notice> : null}
          <Field label="6-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={6} pattern="[0-9]{6}" />
          <SubmitButton className="w-full" pendingText="Checking…">
            Turn on two-step verification
          </SubmitButton>
        </section>
      </form>
    );
  }

  return (
    <form action={startAction} className="space-y-4">
      <Notice>
        Every member of a clinic signs in with a password and a code from an authenticator app. Confirm your password to set it up.
      </Notice>
      {start.status === "error" ? <Notice tone="error">{start.error}</Notice> : null}
      <Field label="Email address" name="email" type="email" autoComplete="username" defaultValue={email} readOnly />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      <SubmitButton className="w-full" pendingText="Preparing…">
        Set up two-step verification
      </SubmitButton>
    </form>
  );
}
