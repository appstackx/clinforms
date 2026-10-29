"use client";

/**
 * The device was handed back (FORM-007): the member of staff sees whose form it was, checks it is the right patient,
 * and confirms with THEIR password – "Completed in the clinic, verified by <member>" on the signed copy and in the
 * audit. Or they end the hand-off (the device stops showing the form; a completed copy stays unverified).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ShieldCheck, Tablet } from "lucide-react";
import { PmsButton, PmsNotice, TextInput, useToast } from "@/components/pms/ui";

type Answer = { ok: true; message?: string; next: string } | { ok: false; error: string };

export interface HandoffVerifyProps {
  patientName: string;
  formName: string;
  formsHref: string;
  copyHref: string;
  state: "open" | "expired" | "completed" | "verified" | "ended";
  startedAt: string;
  completedAt: string | null;
  verified: { by: string; at: string } | null;
  memberName: string;
  verify: (password: string) => Promise<Answer>;
  end: () => Promise<Answer>;
}

export function HandoffVerify(p: HandoffVerifyProps) {
  const router = useRouter();
  const toast = useToast();
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState<"verify" | "end" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const run = async (key: "verify" | "end", fn: () => Promise<Answer>) => {
    setBusy(key);
    setError(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setPassword("");
    toast.success(r.message ?? "Done.");
    router.push(r.next);
  };
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-[#475569]">
        <Link href={p.formsHref} className="text-primary-strong underline underline-offset-2">
          {p.patientName} – Forms
        </Link>
        <span aria-hidden> / </span>
        <span>Completed in the clinic</span>
      </nav>
      <section aria-labelledby="ho-h" className="rounded-2xl border border-border bg-white p-5">
        <h1 id="ho-h" className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Tablet className="h-5 w-5 text-[#475569]" aria-hidden="true" />
          {p.formName}
        </h1>
        <dl className="mt-3 grid grid-cols-[140px_minmax(0,1fr)] gap-y-1.5 text-sm">
          <dt className="text-[#475569]">Patient</dt>
          <dd className="font-medium">{p.patientName}</dd>
          <dt className="text-[#475569]">Handed over</dt>
          <dd>{p.startedAt}</dd>
          <dt className="text-[#475569]">Completed</dt>
          <dd>{p.completedAt ?? "Not yet"}</dd>
        </dl>
        {error ? (
          <p role="alert" className="mt-3 rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] p-3 text-sm text-destructive-strong">
            {error}
          </p>
        ) : null}
        {p.state === "completed" ? (
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run("verify", () => p.verify(password));
            }}
          >
            <PmsNotice tone="info" title="Check it was the right patient">
              Confirm with your password that {p.patientName} completed this form in the clinic. The signed copy then shows &quot;verified by {p.memberName}&quot;.
            </PmsNotice>
            <div className="space-y-1">
              <label htmlFor="ho-pw" className="block text-sm font-medium text-foreground">
                Your password
              </label>
              <TextInput id="ho-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="max-w-xs" />
            </div>
            <div className="flex flex-wrap gap-2">
              <PmsButton type="submit" disabled={!password} loading={busy === "verify"}>
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Verify and finish
              </PmsButton>
              <PmsButton type="button" variant="secondary" loading={busy === "end"} onClick={() => void run("end", p.end)}>
                Finish without verifying
              </PmsButton>
            </div>
          </form>
        ) : p.state === "open" ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-[#334155]">The patient has not sent the form yet. Ending the hand-off stops the device showing it.</p>
            <PmsButton variant="secondary" loading={busy === "end"} onClick={() => void run("end", p.end)}>
              End the hand-off
            </PmsButton>
          </div>
        ) : p.state === "verified" && p.verified ? (
          <p className="mt-4 text-sm text-[#166534]">
            Verified by {p.verified.by} on {p.verified.at}.{" "}
            <Link href={p.copyHref} className="text-primary-strong underline underline-offset-2">
              Open the signed copy
            </Link>
          </p>
        ) : (
          <p className="mt-4 text-sm text-[#334155]">This hand-off has ended{p.completedAt ? " – the form was completed but not verified" : ""}.</p>
        )}
      </section>
    </div>
  );
}
