"use client";
/**
 * A patient's saved cards and memberships (the clinic's own payment account), on the patient's Invoices tab.
 * Saving a card: the member reads the exact consent wording to the patient, ticks that they agreed (recorded with
 * who, when and the words), then the payment provider's own card form opens for the PATIENT to type their card –
 * staff never type card numbers. Memberships: a plan, a saved card, a charge day and the patient's consent.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Checkbox, FormField, PmsButton, PmsNotice, SelectInput, TextInput, useToast } from "@/components/pms/ui";
import { CARD_COPY, CONSENT_CHANNEL_LABELS, membershipConsentWording, type PatientCardsView } from "@/modules/pms/billing/card-payments";
import { formatPence } from "@/modules/pms/core/text";
import { cancelMembershipAction, removeSavedCardAction, startMembershipAction, startSaveCardAction } from "@/app/app/clinic/billing/card-actions";

const STATUS_TEXT: Record<string, string> = { active: "Active", payment_failed: "Payment failed – take payment another way", cancelled: "Cancelled" };

export function PatientCards({ patientId, view, clinicName, notice }: { patientId: string; view: PatientCardsView; clinicName: string; notice: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [agreed, setAgreed] = React.useState(false);
  const [noShow, setNoShow] = React.useState(false);
  const active = view.cards.filter((c) => c.status === "active");
  const [planId, setPlanId] = React.useState(view.plans[0]?.id ?? "");
  const [mandateId, setMandateId] = React.useState(active[0]?.id ?? "");
  const [day, setDay] = React.useState("1");
  const [msAgreed, setMsAgreed] = React.useState(false);
  const plan = view.plans.find((p) => p.id === planId);
  const wording = noShow && view.consentPreview.withNoShow ? view.consentPreview.withNoShow : view.consentPreview.plain;

  return (
    <section aria-labelledby="pt-cards" className="flex flex-col gap-4" data-testid="patient-cards">
      <h2 id="pt-cards" className="text-lg font-semibold">
        Saved cards and memberships
      </h2>
      {view.testMode ? <p className="text-xs text-[#475569]">{CARD_COPY.testBanner}</p> : null}
      {notice ? <PmsNotice tone="info" title={notice} /> : null}
      {error ? <PmsNotice tone="error" title={error} /> : null}

      <ul className="divide-y divide-border rounded-md border border-border bg-white">
        {view.cards.length === 0 ? <li className="px-3 py-2 text-sm text-[#475569]">No saved card.</li> : null}
        {view.cards.map((c) => (
          <li key={c.id} className="flex flex-col gap-1 px-3 py-2 text-sm" data-testid="saved-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>{c.label}</strong>
              {view.can.manage ? (
                <PmsButton
                  size="sm"
                  variant="secondary"
                  loading={busy === `rm-${c.id}`}
                  onClick={async () => {
                    setBusy(`rm-${c.id}`);
                    const r = await removeSavedCardAction(patientId, c.id);
                    setBusy(null);
                    if (!r.ok) return setError(r.error);
                    toast.success(r.value.membershipsCancelled ? `Card removed; ${r.value.membershipsCancelled} membership cancelled` : "Card removed");
                    router.refresh();
                  }}
                >
                  Remove
                </PmsButton>
              ) : null}
            </div>
            <details className="text-xs text-[#475569]">
              <summary className="cursor-pointer">
                Consent: {CONSENT_CHANNEL_LABELS[c.consentChannel as keyof typeof CONSENT_CHANNEL_LABELS] ?? c.consentChannel}, {new Date(c.consentAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}
                {c.allowsNoShow ? " · includes missed-appointment fees" : ""}
              </summary>
              <p className="mt-1 whitespace-pre-wrap">{c.wording}</p>
            </details>
          </li>
        ))}
      </ul>

      {view.ready && view.can.manage ? (
        adding ? (
          <div className="flex flex-col gap-3 rounded-md border border-border bg-white p-3">
            <p className="text-sm font-medium">Read this to the patient:</p>
            <blockquote className="border-l-4 border-[#0B7970] bg-[#F8FAFC] px-3 py-2 text-sm" data-testid="consent-wording">
              {wording}
            </blockquote>
            {view.consentPreview.withNoShow ? <Checkbox checked={noShow} onChange={(e) => setNoShow(e.target.checked)} label="The patient also agrees to missed-appointment and late-cancellation fees (the policy above)" data-testid="consent-noshow" /> : null}
            <Checkbox checked={agreed} onChange={(e) => setAgreed(e.target.checked)} label="The patient has read or heard these words and agreed" data-testid="consent-agreed" />
            <p className="text-xs text-[#475569]">Next, the payment provider&apos;s secure card form opens on this screen. Hand the screen to the patient to type their card – never type it for them.</p>
            <div className="flex flex-wrap gap-2">
              <PmsButton
                loading={busy === "save"}
                disabled={!agreed}
                data-testid="consent-continue"
                onClick={async () => {
                  setBusy("save");
                  setError(null);
                  const r = await startSaveCardAction(patientId, { allowsNoShow: noShow, consentConfirmed: agreed });
                  setBusy(null);
                  if (!r.ok) return setError(r.error);
                  window.location.assign(r.value.url);
                }}
              >
                Open the card form
              </PmsButton>
              <PmsButton variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </PmsButton>
            </div>
          </div>
        ) : (
          <div>
            <PmsButton variant="secondary" onClick={() => setAdding(true)} data-testid="save-card-start">
              Save a card
            </PmsButton>
          </div>
        )
      ) : null}

      <h3 className="text-base font-semibold">Memberships</h3>
      <ul className="divide-y divide-border rounded-md border border-border bg-white">
        {view.memberships.length === 0 ? <li className="px-3 py-2 text-sm text-[#475569]">No membership.</li> : null}
        {view.memberships.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm" data-testid="membership-row">
            <span>
              <strong>{m.planName}</strong> · {formatPence(m.pricePence)} a month · {m.cardLabel} · {STATUS_TEXT[m.status] ?? m.status}
              {m.nextChargeOn && m.status === "active" ? ` · next charge ${m.nextChargeOn}` : ""}
            </span>
            {m.status !== "cancelled" && view.can.manage ? (
              <PmsButton
                size="sm"
                variant="secondary"
                loading={busy === `ms-${m.id}`}
                onClick={async () => {
                  setBusy(`ms-${m.id}`);
                  const r = await cancelMembershipAction(patientId, m.id);
                  setBusy(null);
                  if (!r.ok) return setError(r.error);
                  toast.success("Membership cancelled");
                  router.refresh();
                }}
              >
                Cancel membership
              </PmsButton>
            ) : null}
          </li>
        ))}
      </ul>
      {view.ready && view.can.manage && view.plans.length > 0 && active.length > 0 ? (
        <form
          className="flex flex-col gap-3 rounded-md border border-border bg-white p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy("ms");
            setError(null);
            const r = await startMembershipAction(patientId, { planId, mandateId, chargeDay: Number(day), consentConfirmed: msAgreed });
            setBusy(null);
            if (!r.ok) return setError(r.error);
            toast.success("Membership started – the first month is charged in tonight's run");
            setMsAgreed(false);
            router.refresh();
          }}
        >
          <div className="flex flex-wrap gap-3">
            <FormField id="ms-plan" label="Plan">
              <SelectInput value={planId} onChange={(e) => setPlanId(e.target.value)}>
                {view.plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} – {formatPence(p.pricePence)} a month
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <FormField id="ms-card" label="Card">
              <SelectInput value={mandateId} onChange={(e) => setMandateId(e.target.value)}>
                {active.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <FormField id="ms-day" label="Charge day (1–28)">
              <TextInput inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value)} className="max-w-[6rem]" />
            </FormField>
          </div>
          {plan ? (
            <blockquote className="border-l-4 border-[#0B7970] bg-[#F8FAFC] px-3 py-2 text-sm">
              {membershipConsentWording({ clinicName, planName: plan.name, pricePence: plan.pricePence, chargeDay: Math.max(1, Math.min(28, Number(day) || 1)) })}
            </blockquote>
          ) : null}
          <Checkbox checked={msAgreed} onChange={(e) => setMsAgreed(e.target.checked)} label="The patient has read or heard these words and agreed" />
          <div>
            <PmsButton type="submit" loading={busy === "ms"} disabled={!msAgreed} data-testid="membership-start">
              Start membership
            </PmsButton>
          </div>
        </form>
      ) : null}
    </section>
  );
}
