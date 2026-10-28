"use client";

import * as React from "react";
import { PmsButton } from "@/components/pms/ui";

type Answer = { ok: true } | { ok: false; error: string };

export function IntakeStarterButtons({ starters, addStarter, newForm }: { starters: { key: string; name: string }[]; addStarter: (key: string) => Promise<Answer>; newForm: () => Promise<Answer> }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<Answer>) => {
    setBusy(key);
    setError(null);
    const r = await fn();
    setBusy(null);
    if (r && !r.ok) setError(r.error);
  };
  return (
    <section aria-labelledby="if-new" className="rounded-[12px] border border-border bg-white p-5">
      <h2 id="if-new" className="text-lg font-semibold text-foreground">
        Add a form
      </h2>
      <p className="mt-1 text-sm text-[#475569]">Starter forms are written for this product – edit the wording to your own policies before publishing.</p>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive-strong">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {starters.map((s) => (
          <PmsButton key={s.key} variant="secondary" loading={busy === s.key} onClick={() => void run(s.key, () => addStarter(s.key))}>
            + {s.name}
          </PmsButton>
        ))}
        <PmsButton loading={busy === "new"} onClick={() => void run("new", newForm)}>
          New blank form
        </PmsButton>
      </div>
    </section>
  );
}
