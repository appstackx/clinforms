"use client";
/**
 * Messages → Text credits: the balance, the packs (card payment on a secure page – never the provider's name), the
 * saved card and automatic top-up (owner / admin), and the history. Everyone with messages.send sees the balance and
 * the history; the buttons are only there for the owner and admins (the server checks again).
 */
import { useRouter } from "next/navigation";
import * as React from "react";
import { CreditCard, MessageSquareText } from "lucide-react";
import { CREDIT_COPY, creditsText, type TextCreditsView } from "@/modules/pms/comms/credits";
import { Checkbox, FormField, PmsButton, PmsNotice, SelectInput, TextInput, useToast } from "@/components/pms/ui";
import { buyCreditsAction, removeCardAction, saveAutoTopupAction, saveCardAction } from "@/app/app/clinic/messages/credits/actions";

const card = "flex flex-col gap-3 rounded-xl border border-border bg-white p-4";

export function TextCreditsPage({ view }: { view: TextCreditsView }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saveCard, setSaveCard] = React.useState(false);
  const [auto, setAuto] = React.useState({ enabled: view.autoTopup.enabled, threshold: String(view.autoTopup.threshold), pack: view.autoTopup.pack ?? "sms_500" });
  const low = view.balance <= view.lowThreshold;

  async function go(kind: string, run: () => Promise<{ ok: true; url: string } | { ok: false; error: string }>) {
    setBusy(kind);
    setError(null);
    const r = await run();
    if (!r.ok) {
      setBusy(null);
      setError(r.error);
      return;
    }
    window.location.assign(r.url);
  }

  async function saveAuto() {
    setBusy("auto");
    setError(null);
    const r = await saveAutoTopupAction({ enabled: auto.enabled, threshold: Number(auto.threshold), pack: auto.pack });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast.success(r.message);
    router.refresh();
  }

  async function removeCard() {
    setBusy("remove");
    const r = await removeCardAction();
    setBusy(null);
    if (!r.ok) setError(r.error);
    else toast.success(r.message);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <section className={card} aria-labelledby="balance-h">
        <h2 id="balance-h" className="sr-only">
          Balance
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <MessageSquareText className="h-6 w-6 text-[#0B7970]" aria-hidden />
          <p className="text-3xl font-semibold tabular-nums text-foreground" data-testid="credit-balance">
            {view.balance.toLocaleString("en-GB")}
          </p>
          <p className="text-sm text-[#475569]">{view.balance === 1 ? "credit left" : "credits left"}</p>
        </div>
        {view.balance <= 0 ? (
          <PmsNotice tone="warning" title="No text credits left.">
            {CREDIT_COPY.fallback}
          </PmsNotice>
        ) : low ? (
          <PmsNotice tone="warning" title={`Running low: ${creditsText(view.balance)} left.`}>
            {CREDIT_COPY.fallback}
          </PmsNotice>
        ) : null}
        <p className="text-sm text-[#475569]">{CREDIT_COPY.explain}</p>
        {view.smsMode === "outbox" ? (
          <p className="text-sm text-[#475569]" data-testid="credits-outbox-note">
            Texts are kept in the outbox at the moment and not sent, so no credits are used yet. The balance is still checked.
          </p>
        ) : null}
      </section>

      <section className={card} aria-labelledby="buy-h">
        <h2 id="buy-h" className="text-base font-semibold">
          Buy credits
        </h2>
        {!view.canManage ? (
          <p className="text-sm text-[#475569]" data-testid="credits-manage-only">
            {CREDIT_COPY.manageOnly}
          </p>
        ) : !view.paymentsReady ? (
          <PmsNotice tone="info" title={view.paymentsUnavailable ?? "Card payments are not set up yet."} />
        ) : null}
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="credit-packs">
          {view.packs.map((p) => (
            <li key={p.key} className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <p className="text-lg font-semibold">{creditsText(p.credits)}</p>
              <p className="text-sm text-[#475569]">
                {p.price} · {p.perText}
              </p>
              {view.canManage ? (
                <PmsButton
                  disabled={!view.paymentsReady || busy !== null}
                  loading={busy === p.key}
                  onClick={() => void go(p.key, () => buyCreditsAction(p.key, saveCard))}
                  data-testid={`buy-${p.key}`}
                  aria-label={`Buy ${creditsText(p.credits)} for ${p.price}`}
                >
                  <CreditCard aria-hidden />
                  Buy
                </PmsButton>
              ) : null}
            </li>
          ))}
        </ul>
        {view.canManage && view.paymentsReady ? (
          <Checkbox label="Save this card for automatic top-up" checked={saveCard} onChange={(e) => setSaveCard(e.target.checked)} data-testid="save-card-with-purchase" />
        ) : null}
        <p className="text-sm text-[#475569]">{CREDIT_COPY.cardPayment}</p>
        <p className="text-sm font-medium text-foreground" data-testid="credits-non-refundable">
          {CREDIT_COPY.nonRefundable}
        </p>
      </section>

      {view.canManage ? (
        <section className={card} aria-labelledby="auto-h">
          <h2 id="auto-h" className="text-base font-semibold">
            Automatic top-up
          </h2>
          <p className="text-sm text-[#475569]">When a text would take the balance below the number you choose, the saved card is charged for the pack first. Nothing is ever sent on credit.</p>
          {view.autoTopup.paused ? <PmsNotice tone="warning" title={CREDIT_COPY.autoTopupFailed}>Check the card or save a new one, then switch automatic top-up on again.</PmsNotice> : null}
          {view.card ? (
            <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="saved-card">
              <CreditCard className="h-4 w-4 text-[#475569]" aria-hidden />
              <span>
                Saved card: {view.card.brand.toUpperCase()} ending {view.card.last4}, expires {view.card.expires}
              </span>
              <PmsButton size="sm" variant="secondary" loading={busy === "card"} disabled={!view.paymentsReady || busy !== null} onClick={() => void go("card", saveCardAction)}>
                Change card
              </PmsButton>
              <PmsButton size="sm" variant="secondary" loading={busy === "remove"} disabled={busy !== null} onClick={() => void removeCard()}>
                Remove card
              </PmsButton>
            </div>
          ) : (
            <div>
              <PmsButton variant="secondary" loading={busy === "card"} disabled={!view.paymentsReady || busy !== null} onClick={() => void go("card", saveCardAction)} data-testid="save-card">
                <CreditCard aria-hidden />
                Save a card
              </PmsButton>
            </div>
          )}
          <Checkbox label="Top up automatically" checked={auto.enabled} disabled={!view.card} onChange={(e) => setAuto((a) => ({ ...a, enabled: e.target.checked }))} data-testid="auto-topup-on" />
          <div className="grid max-w-lg grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField id="auto-threshold" label="When the balance drops below" hint="Credits">
              <TextInput inputMode="numeric" value={auto.threshold} onChange={(e) => setAuto((a) => ({ ...a, threshold: e.target.value }))} data-testid="auto-topup-threshold" />
            </FormField>
            <FormField id="auto-pack" label="Buy this pack">
              <SelectInput value={auto.pack} onChange={(e) => setAuto((a) => ({ ...a, pack: e.target.value as typeof a.pack }))} data-testid="auto-topup-pack">
                {view.packs.map((p) => (
                  <option key={p.key} value={p.key}>
                    {creditsText(p.credits)} – {p.price}
                  </option>
                ))}
              </SelectInput>
            </FormField>
          </div>
          <div>
            <PmsButton loading={busy === "auto"} disabled={busy !== null} onClick={() => void saveAuto()} data-testid="save-auto-topup">
              Save automatic top-up
            </PmsButton>
          </div>
        </section>
      ) : null}

      {error ? <PmsNotice tone="error" title={error} /> : null}

      <section className={card} aria-labelledby="history-h">
        <h2 id="history-h" className="text-base font-semibold">
          History
        </h2>
        {view.entries.length === 0 ? (
          <p className="text-sm text-[#475569]">No credits bought or used yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm" data-testid="credit-history">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-[#475569]">
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    When
                  </th>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    What
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">
                    Credits
                  </th>
                  <th scope="col" className="py-2 text-right font-semibold">
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.entries.map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{e.at}</td>
                    <td className="py-2 pr-3">
                      {e.label}
                      {e.note ? <span className="block text-xs text-[#475569]">{e.note}</span> : null}
                    </td>
                    <td className={`whitespace-nowrap py-2 pr-3 text-right tabular-nums ${e.credits < 0 ? "text-foreground" : "text-[#166534]"}`}>
                      {e.credits > 0 ? `+${e.credits.toLocaleString("en-GB")}` : `−${Math.abs(e.credits).toLocaleString("en-GB")}`}
                    </td>
                    <td className="whitespace-nowrap py-2 text-right tabular-nums">{e.balanceAfter.toLocaleString("en-GB")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
