"use client";
/**
 * Payer accounts: how each one bills the patient's part of an insured visit – "Excess per case" (one amount for
 * the case, used up visit by visit; the default) or "Patient contribution per visit" (a fixed amount on every
 * visit). A case can override its account on the case form. Changing needs settings.setup.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { setPayerContributionModeAction } from "@/app/app/clinic/billing/actions";
import { CONTRIBUTION_MODES, CONTRIBUTION_MODE_HINTS, CONTRIBUTION_MODE_LABELS, type ContributionMode } from "@/modules/pms/billing/excess";
import type { PayerAccountTermsView } from "@/modules/pms/billing/view";
import { REFERRER_KIND_LABELS } from "@/modules/pms/records/copy";
import type { ReferrerKind } from "@/modules/pms/core/types";
import { cn } from "@/lib/utils";
import { PmsButton, PmsNotice, SelectInput, useToast } from "@/components/pms/ui";
import { BILLING_PATH, focusRing } from "./format";

export function PayerTerms({ accounts, canEdit }: { accounts: PayerAccountTermsView[]; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [chosen, setChosen] = React.useState<Record<string, ContributionMode>>(() => Object.fromEntries(accounts.map((a) => [a.id, a.mode])));
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function save(a: PayerAccountTermsView) {
    setBusy(a.id);
    setError(null);
    const r = await setPayerContributionModeAction(a.id, chosen[a.id]);
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast.success(`${a.name}: ${CONTRIBUTION_MODE_LABELS[chosen[a.id]].toLowerCase()}`);
    router.refresh();
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[980px] flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-[#475569]">
        <Link href={BILLING_PATH} className={cn("text-primary-strong underline underline-offset-2", focusRing)}>
          Billing
        </Link>
        <span aria-hidden> / </span>
        <span>Payer accounts</span>
      </nav>
      <h1 className="text-2xl font-semibold text-foreground">Payer accounts</h1>
      <PmsNotice tone="info" title="How the patient's part of an insured visit is billed">
        <span className="block">
          <strong>{CONTRIBUTION_MODE_LABELS.per_case}</strong> (the default): {CONTRIBUTION_MODE_HINTS.per_case}
        </span>
        <span className="block">
          <strong>{CONTRIBUTION_MODE_LABELS.per_visit}</strong>: {CONTRIBUTION_MODE_HINTS.per_visit}
        </span>
        <span className="block">The amount is set on each case; a case can also choose its own way. A visit the patient&apos;s part covers in full is billed to the patient only.</span>
      </PmsNotice>
      {error ? (
        <p role="alert" className="text-sm text-destructive-strong">
          {error}
        </p>
      ) : null}
      <section className="rounded-xl border border-border bg-white" aria-labelledby="payers-h">
        <h2 id="payers-h" className="sr-only">
          Payer accounts
        </h2>
        {accounts.length === 0 ? <p className="px-5 py-4 text-sm text-[#475569]">No payer accounts in the clinic&apos;s directory yet.</p> : null}
        <ul className="divide-y divide-border" data-testid="payer-terms">
          {accounts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3" data-payer={a.id}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground">{a.name}</p>
                <p className="text-xs text-[#475569]">
                  {REFERRER_KIND_LABELS[a.kind as ReferrerKind] ?? a.kind}
                  {a.active ? "" : " · no longer in use"}
                </p>
              </div>
              {canEdit ? (
                <>
                  <label className="sr-only" htmlFor={`mode-${a.id}`}>
                    How {a.name} bills the patient&apos;s part
                  </label>
                  <div className="w-full sm:w-72">
                    <SelectInput id={`mode-${a.id}`} value={chosen[a.id]} onChange={(e) => setChosen({ ...chosen, [a.id]: e.target.value as ContributionMode })} data-testid="payer-mode">
                      {CONTRIBUTION_MODES.map((m) => (
                        <option key={m} value={m}>
                          {CONTRIBUTION_MODE_LABELS[m]}
                        </option>
                      ))}
                    </SelectInput>
                  </div>
                  <PmsButton variant="secondary" size="sm" disabled={chosen[a.id] === a.mode} loading={busy === a.id} onClick={() => void save(a)} data-testid="payer-mode-save">
                    Save
                  </PmsButton>
                </>
              ) : (
                <span className="text-sm text-foreground">{CONTRIBUTION_MODE_LABELS[a.mode]}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
