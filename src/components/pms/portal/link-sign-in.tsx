"use client";

import * as React from "react";
import { PmsButton } from "@/components/pms/ui";

type Answer = { ok: true } | { ok: false; error: string };

export function LinkSignIn({ clinicId, token, next, action }: { clinicId: string; token: string; next: string | null; action: (clinicId: string, token: string, next: string | null) => Promise<Answer> }) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div className="space-y-4">
      <h1 className="text-[24px] font-bold text-foreground">Sign in to your patient portal</h1>
      <p className="text-[15px] text-[#334155]">Press the button to sign in on this device. The link works once.</p>
      {error ? (
        <p role="alert" className="rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] p-3 text-[14px] text-destructive-strong">
          {error}
        </p>
      ) : null}
      <PmsButton
        type="button"
        size="lg"
        className="h-12 w-full text-[16px]"
        loading={pending}
        loadingText="Signing in…"
        onClick={async () => {
          setPending(true);
          setError(null);
          const r = await action(clinicId, token, next);
          // On success the action redirects; an answer means it did not work.
          setPending(false);
          if (r && !r.ok) setError(r.error);
        }}
      >
        Sign in
      </PmsButton>
    </div>
  );
}
