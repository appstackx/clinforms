"use client";

/** The portal's sign-in (design round 2g "Portal"): the email address only; a one-time link by email. */
import * as React from "react";
import { Mail } from "lucide-react";
import { PmsButton } from "@/components/pms/ui";
import { HumanCheck } from "@/components/pms/portal/human-check";

type Answer = { ok: true; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function SignInForm({
  clinicId,
  contactLine,
  action,
  humanCheckSiteKey = null,
}: {
  clinicId: string;
  contactLine: string | null;
  action: (clinicId: string, input: { email: string; website?: string; humanToken?: string | null }) => Promise<Answer>;
  /** The Turnstile site key when the bot check is set up on this deployment (else null – no widget). */
  humanCheckSiteKey?: string | null;
}) {
  const [email, setEmail] = React.useState("");
  const [website, setWebsite] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [sent, setSent] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [humanToken, setHumanToken] = React.useState<string | null>(null);
  const [humanReset, setHumanReset] = React.useState(0);
  const needsToken = humanCheckSiteKey !== null && !humanToken;

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setPending(true);
    setError(null);
    setFieldError(null);
    const r = await action(clinicId, humanCheckSiteKey ? { email, website, humanToken } : { email, website });
    setPending(false);
    // A Turnstile token works once – ask for a fresh one whatever the answer.
    if (humanCheckSiteKey) setHumanReset((n) => n + 1);
    if (r.ok) setSent(email.trim());
    else {
      setError(r.error);
      setFieldError(r.fieldErrors?.email ?? null);
    }
  };

  if (sent) {
    return (
      <div className="space-y-4">
        <div role="status" className="rounded-[12px] border border-border bg-white p-4">
          <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-full bg-[#CCFBF1] text-[#0B5F58]">
            <Mail className="h-6 w-6" />
          </span>
          <h1 className="mt-3 text-[22px] font-bold text-foreground">Check your email</h1>
          <p className="mt-1 text-[15px] text-[#334155]">
            If <strong>{sent}</strong> is the address we hold for you, we&apos;ve sent a sign-in link to it. It works once, for 15 minutes.
          </p>
        </div>
        {humanCheckSiteKey ? <HumanCheck siteKey={humanCheckSiteKey} action="portal_sign_in" onToken={setHumanToken} resetKey={humanReset} /> : null}
        <PmsButton type="button" variant="secondary" size="lg" className="w-full" disabled={needsToken} onClick={() => void send()} loading={pending} loadingText="Sending…">
          Send it again
        </PmsButton>
        {error ? (
          <p role="alert" className="text-[14px] text-destructive-strong">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void send(e)} className="space-y-4" noValidate>
      <h1 className="text-[24px] font-bold leading-tight text-foreground">Your appointments and forms</h1>
      <p className="text-[15px] text-[#334155]">Enter the email you gave us. We&apos;ll send you a link to sign in – no password needed.</p>
      {error ? (
        <p role="alert" className="rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] p-3 text-[14px] text-destructive-strong">
          {error}
        </p>
      ) : null}
      <div className="space-y-1.5">
        <label htmlFor="pt-email" className="block text-[14px] font-medium text-foreground">
          Email
        </label>
        <input
          id="pt-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? "pt-email-err" : undefined}
          className="h-12 w-full rounded-[10px] border border-[#CBD5E1] bg-white px-3 text-[16px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        />
        {fieldError ? (
          <p id="pt-email-err" role="alert" className="text-[13px] text-destructive-strong">
            {fieldError}
          </p>
        ) : null}
      </div>
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="pt-website">Leave this empty</label>
        <input id="pt-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>
      {humanCheckSiteKey ? <HumanCheck siteKey={humanCheckSiteKey} action="portal_sign_in" onToken={setHumanToken} resetKey={humanReset} /> : null}
      <PmsButton type="submit" size="lg" className="h-12 w-full text-[16px]" disabled={needsToken} loading={pending} loadingText="Sending…">
        Email me a sign-in link
      </PmsButton>
      {contactLine ? <p className="text-[13px] text-[#334155]">{contactLine}</p> : null}
    </form>
  );
}
