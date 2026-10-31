"use client";

/**
 * The clinic device's first screen (M10 H3): the code a member of staff shows on their own screen ("ABCD-EFGH",
 * valid 10 minutes) pairs THIS browser – not signed in – with the one form handed to the patient. No link into the
 * staff app; nothing about the patient is shown before the code is right.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { PmsButton } from "@/components/pms/ui";

export interface DevicePairFormProps {
  pair: (code: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** "All done" / "No form on this device" – shown above the code box. */
  heading: string;
  lead: string;
}

export function DevicePairForm({ pair, heading, lead }: DevicePairFormProps) {
  const router = useRouter();
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <section aria-labelledby="dv-h" className="space-y-4 rounded-[12px] border border-border bg-white p-5">
      <h1 id="dv-h" className="text-center text-[22px] font-bold text-foreground">
        {heading}
      </h1>
      <p className="text-center text-[16px] text-[#334155]">{lead}</p>
      <form
        className="mx-auto max-w-[320px] space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const r = await pair(code);
          setBusy(false);
          if (!r.ok) {
            setError(r.error);
            return;
          }
          setCode("");
          router.refresh();
        }}
      >
        <label htmlFor="dv-code" className="block text-[15px] font-semibold text-foreground">
          Code from a member of staff
        </label>
        <input
          id="dv-code"
          name="code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          maxLength={12}
          placeholder="ABCD-EFGH"
          aria-describedby={error ? "dv-code-error" : "dv-code-hint"}
          aria-invalid={error ? true : undefined}
          className="h-12 w-full rounded-[10px] border border-[#94A3B8] bg-white px-3 text-center font-mono text-[22px] tracking-[0.2em] text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        />
        <p id="dv-code-hint" className="text-[13px] text-[#475569]">
          8 letters and numbers. It works once, for 10 minutes.
        </p>
        {error ? (
          <p id="dv-code-error" role="alert" className="rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] p-3 text-[14px] text-destructive-strong">
            {error}
          </p>
        ) : null}
        <PmsButton type="submit" size="lg" className="h-12 w-full text-[16px]" disabled={code.trim().length < 8} loading={busy} loadingText="Checking…">
          Show the form
        </PmsButton>
      </form>
    </section>
  );
}
