"use client";
/**
 * The patient record → Messages tab: the marketing-email consent (shown while bulk email exists on the platform) –
 * yes/no, when and how it was given, when it was last withdrawn and how; staff with "Create and edit patients"
 * record or withdraw it (audited, with how the patient agreed). The patient withdraws it with the unsubscribe link
 * in any bulk email.
 */
import { useRouter } from "next/navigation";
import * as React from "react";
import type { MarketingConsentView } from "@/modules/pms/comms/campaign-view";
import { CONSENT_SOURCE_LABELS } from "@/modules/pms/comms/copy";
import { formatUkDateTime } from "@/modules/pms/comms/schedule";
import { FormField, PmsButton, SelectInput, useToast } from "@/components/pms/ui";
import { setMarketingConsentAction } from "@/app/app/clinic/messages/campaigns/actions";

const HOW: Record<string, string> = {
  verbal: "Said so (verbal)",
  written: "In writing",
  online: "Online form",
  import: "Imported",
};

export function MarketingConsentPanel({ view }: { view: MarketingConsentView }) {
  const router = useRouter();
  const toast = useToast();
  const [how, setHow] = React.useState<string>("verbal");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function change(value: boolean) {
    setBusy(true);
    setError(null);
    const r = await setMarketingConsentAction(view.patientId, value, value ? how : null);
    setBusy(false);
    if (!r.ok) {
      setError(r.fieldErrors?.how ?? r.error);
      return;
    }
    toast.success(value ? "Marketing email consent recorded." : "Marketing email consent withdrawn.");
    router.refresh();
  }
  return (
    <section aria-labelledby="pm-mkt" className="flex flex-col gap-2 rounded-xl border border-border bg-white p-4" data-testid="marketing-consent">
      <h2 id="pm-mkt" className="text-base font-semibold">
        News and offers by email (marketing consent)
      </h2>
      <dl className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-[#475569]">Agreed</dt>
          <dd className="font-medium" data-testid="marketing-consent-state">
            {view.agreed ? "Yes" : "No"}
          </dd>
        </div>
        {view.agreed ? (
          <div>
            <dt className="text-[#475569]">Recorded</dt>
            <dd>
              {formatUkDateTime(view.agreedAt)}
              {view.how ? ` · ${HOW[view.how] ?? view.how}` : ""}
            </dd>
          </div>
        ) : null}
        {view.withdrawnAt ? (
          <div>
            <dt className="text-[#475569]">Last withdrawn</dt>
            <dd data-testid="marketing-consent-withdrawn">
              {formatUkDateTime(view.withdrawnAt)}
              {view.withdrawnHow ? ` · ${CONSENT_SOURCE_LABELS[view.withdrawnHow as keyof typeof CONSENT_SOURCE_LABELS] ?? view.withdrawnHow}` : ""}
            </dd>
          </div>
        ) : null}
      </dl>
      {view.canChange ? (
        view.agreed ? (
          <div>
            <PmsButton variant="secondary" size="sm" loading={busy} onClick={() => void change(false)} data-testid="marketing-consent-withdraw">
              Withdraw consent
            </PmsButton>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <FormField id="mkt-how" label="How the patient agreed" error={error ?? undefined}>
              <SelectInput value={how} onChange={(e) => setHow(e.target.value)}>
                {["verbal", "written", "online"].map((k) => (
                  <option key={k} value={k}>
                    {HOW[k]}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <PmsButton variant="secondary" size="sm" loading={busy} onClick={() => void change(true)} data-testid="marketing-consent-record">
              Record consent
            </PmsButton>
          </div>
        )
      ) : null}
      {error && view.agreed ? (
        <p role="alert" className="text-sm text-destructive-strong">
          {error}
        </p>
      ) : null}
    </section>
  );
}
