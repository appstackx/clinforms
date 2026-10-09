"use client";
import { useState } from "react";
import { useFormState } from "react-dom";
import Link from "next/link";
import { Field, Notice } from "@/components/account/shell";
import { CopyButton, SubmitButton } from "@/components/account/form-controls";
import { confirmSetup, startSetup, type SetupState } from "./actions";

const IDLE: SetupState = { status: "idle" };

export function TwoFactorSetup({ email }: { email: string }) {
  const [start, startAction] = useFormState(startSetup, IDLE);
  const [confirm, confirmAction] = useFormState(confirmSetup, IDLE);
  const [saved, setSaved] = useState(false);

  if (confirm.status === "done" || start.status === "done") {
    const codes = start.status === "scan" ? start.backupCodes : [];
    return (
      <div className="space-y-4">
        <Notice tone="success">Two-step verification is on. From now on you will enter a code from your app each time you sign in.</Notice>
        {codes.length ? (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">Your backup codes</h2>
            <p className="text-sm text-slate-600">
              Each code signs you in once if you lose your phone. Save them somewhere safe now: they are shown only once.
            </p>
            <ul className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-sm" aria-label="Backup codes">
              {codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="flex items-center gap-2">
              <CopyButton value={codes.join("\n")} label="Copy all codes" />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              I have saved my backup codes
            </label>
          </div>
        ) : null}
        <Link
          href="/app"
          aria-disabled={codes.length > 0 && !saved}
          className={`inline-flex h-10 w-full items-center justify-center rounded-lg px-4 text-sm font-semibold text-white ${
            codes.length > 0 && !saved ? "pointer-events-none bg-slate-300" : "bg-teal-600 hover:bg-teal-700"
          }`}
        >
          Continue
        </Link>
      </div>
    );
  }

  if (start.status === "scan") {
    return (
      <form action={confirmAction} className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>Open an authenticator app on your phone (for example Google Authenticator, Microsoft Authenticator or 1Password).</li>
          <li>Scan this code, or type the key below into the app.</li>
          <li>Enter the 6-digit code the app shows.</li>
        </ol>
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URI, not an optimisable image */}
          <img src={start.qr} alt={`Authenticator set-up code for ${email}`} width={220} height={220} className="rounded-lg border border-slate-200" />
        </div>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <code className="break-all font-mono text-xs text-slate-800">{start.manualKey}</code>
          <CopyButton value={start.manualKey.replace(/\s+/g, "")} label="Copy key" />
        </div>
        {confirm.status === "error" ? <Notice tone="error">{confirm.error}</Notice> : null}
        <Field label="6-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={6} pattern="[0-9]{6}" />
        <SubmitButton className="w-full" pendingText="Checking…">
          Turn on two-step verification
        </SubmitButton>
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
