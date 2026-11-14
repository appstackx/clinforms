"use client";
/**
 * Set-up → Card payments (the clinic's own payment account): connect / continue set-up at the payment provider,
 * the account's status, the clinic's on/off switch, the missed-appointment policy, desk card readers per site and
 * membership plans. Browser-safe: data from the page, changes through ./actions (the owner only).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { SetupCard, SetupError, SetupHeader, SetupPage } from "@/components/pms/reporting/setup-kit";
import { FormField, PmsButton, PmsNotice, SelectInput, Switch, TextArea, TextInput, useToast } from "@/components/pms/ui";
import { CARD_COPY, type CardSetupView } from "@/modules/pms/billing/card-payments";
import { formatPence } from "@/modules/pms/core/text";
import {
  addReaderAction,
  createPlanAction,
  refreshCardAccountAction,
  removeReaderAction,
  setCardPaymentsEnabledAction,
  setNoShowPolicyAction,
  setPlanActiveAction,
} from "@/app/app/clinic/setup/card-payments/actions";

const STATUS: Record<CardSetupView["status"], { text: string; tone: "success" | "warning" | "error" | "neutral" }> = {
  none: { text: "Not connected", tone: "neutral" },
  pending: { text: "Set-up not finished", tone: "warning" },
  active: { text: "Active – can take payments", tone: "success" },
  restricted: { text: "Restricted – the payment provider needs more information", tone: "error" },
  closed: { text: "Closed", tone: "neutral" },
};

function Pill({ tone, children }: { tone: "success" | "warning" | "error" | "neutral"; children: React.ReactNode }) {
  const cls = { success: "bg-[#E6F4F2] text-[#0B5E57]", warning: "bg-[#FEF3C7] text-[#92400E]", error: "bg-[#FEE2E2] text-[#991B1B]", neutral: "bg-[#F1F5F9] text-[#475569]" }[tone];
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

export function CardPaymentsSetup({ view, returned, failed }: { view: CardSetupView; returned: boolean; failed: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = React.useState<string | null>(failed ? "The payment provider could not be reached to start the set-up. Try again." : null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const run = async <T,>(key: string, work: () => Promise<{ ok: true; value: T } | { ok: false; error: string }>, success?: string) => {
    setBusy(key);
    setError(null);
    const r = await work();
    setBusy(null);
    if (!r.ok) return setError(r.error);
    if (success) toast.success(success);
    router.refresh();
  };
  const st = STATUS[view.status];
  const connected = view.status !== "none" && view.status !== "closed";

  return (
    <SetupPage>
      <SetupHeader
        title="Card payments"
        description="Take card payments into the clinic's own payment account: at the desk on a card reader, from saved cards, and online in the patient portal. The clinic is the seller: payments, payouts, refunds and disputes are the clinic's, and the clinic pays the payment provider's fees."
      />
      {view.keyMode === "test" ? (
        <PmsNotice tone="info" title={CARD_COPY.testBanner}>
          Use the provider&apos;s test cards (for example 4242 4242 4242 4242) and the test card reader.
        </PmsNotice>
      ) : null}
      {!view.configured ? <PmsNotice tone="warning" title="Card payments are not available">{view.unavailableReason}</PmsNotice> : null}
      <SetupError error={error} />

      <SetupCard title="Payment account">
        <div className="flex flex-col gap-3" data-testid="card-account">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={st.tone}>{st.text}</Pill>
            {view.requirementsDue > 0 && connected ? <span className="text-sm text-[#475569]">{view.requirementsDue} thing{view.requirementsDue === 1 ? "" : "s"} still needed by the payment provider</span> : null}
          </div>
          {returned && view.status !== "active" ? <p className="text-sm text-[#334155]">Welcome back. If the provider still needs something, choose Continue set-up.</p> : null}
          <p className="text-sm text-[#334155]">
            Setting up happens on the payment provider&apos;s (Stripe&apos;s) own secure pages: the clinic&apos;s business details, the person responsible and the bank account for payouts. This system never sees or stores those details.
          </p>
          <div className="flex flex-wrap gap-2">
            {view.configured ? (
              <PmsButton asChild>
                <a href="/app/clinic/setup/card-payments/connect" data-testid="card-connect">
                  {connected ? "Continue set-up at the payment provider" : "Connect the clinic's payment account"}
                </a>
              </PmsButton>
            ) : null}
            {connected ? (
              <PmsButton variant="secondary" loading={busy === "refresh"} onClick={() => run("refresh", refreshCardAccountAction, "Status refreshed")} data-testid="card-refresh">
                Refresh status
              </PmsButton>
            ) : null}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-[#475569]">Platform fee</dt>
            <dd>{view.feeText}</dd>
            <dt className="text-[#475569]">Automatic updates</dt>
            <dd>{view.webhookReady ? "On" : "Not set up yet – use Check payment on the invoice and Refresh status here"}</dd>
          </dl>
        </div>
      </SetupCard>

      <SetupCard title="Take card payments">
        <div className="flex flex-col gap-2">
          <Switch
            checked={view.enabled}
            disabled={!connected || busy === "enable"}
            onCheckedChange={(v) => run("enable", () => setCardPaymentsEnabledAction(v), v ? "Card payments are on" : "Card payments are off")}
            label={view.enabled ? "On – staff can take card payments and patients can pay online" : "Off"}
            id="card-enabled"
          />
          {!connected ? <p className="text-sm text-[#475569]">Connect the payment account first.</p> : null}
        </div>
      </SetupCard>

      <NoShowPolicy view={view} busy={busy} run={run} />
      <Readers view={view} busy={busy} run={run} connected={connected} />
      <Plans view={view} busy={busy} run={run} />
    </SetupPage>
  );
}

type Run = <T>(key: string, work: () => Promise<{ ok: true; value: T } | { ok: false; error: string }>, success?: string) => Promise<void>;

function NoShowPolicy({ view, busy, run }: { view: CardSetupView; busy: string | null; run: Run }) {
  const [enabled, setEnabled] = React.useState(view.noShowEnabled);
  const [policy, setPolicy] = React.useState(view.noShowPolicy);
  return (
    <SetupCard title="Missed appointments">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run("noshow", () => setNoShowPolicyAction({ enabled, policy }), "Policy saved");
        }}
      >
        <p className="text-sm text-[#334155]">
          A missed-appointment or late-cancellation fee can be charged to a saved card only when this is on AND the patient agreed to it when their card was saved. The policy below is part of the words they agree to.
        </p>
        <Switch checked={enabled} onCheckedChange={setEnabled} label="Charge missed-appointment fees to saved cards" id="card-noshow" />
        <FormField id="card-noshow-policy" label="Your cancellation policy (shown to patients)" hint="For example: Appointments cancelled with less than 24 hours' notice, or missed, are charged in full.">
          <TextArea rows={3} maxLength={500} value={policy} onChange={(e) => setPolicy(e.target.value)} data-testid="card-noshow-policy" />
        </FormField>
        <div>
          <PmsButton type="submit" loading={busy === "noshow"} data-testid="card-noshow-save">
            Save policy
          </PmsButton>
        </div>
      </form>
    </SetupCard>
  );
}

function Readers({ view, busy, run, connected }: { view: CardSetupView; busy: string | null; run: Run; connected: boolean }) {
  const [siteId, setSiteId] = React.useState(view.sites[0]?.id ?? "");
  const [label, setLabel] = React.useState("Front desk");
  const [code, setCode] = React.useState("");
  const [line1, setLine1] = React.useState("");
  const [city, setCity] = React.useState("");
  const [postcode, setPostcode] = React.useState("");
  const siteHasReader = view.readers.some((r) => r.siteId === siteId);
  return (
    <SetupCard title="Card readers">
      <div className="flex flex-col gap-4">
        {view.readers.length === 0 ? <p className="text-sm text-[#475569]">No card readers yet.</p> : null}
        <ul className="divide-y divide-border rounded-md border border-border" data-testid="card-readers">
          {view.readers.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                <strong>{r.label}</strong> · {r.siteName}
                {r.simulated ? <span className="ml-2 text-xs text-[#475569]">(test reader)</span> : null}
              </span>
              <PmsButton size="sm" variant="secondary" loading={busy === `rm-${r.id}`} onClick={() => run(`rm-${r.id}`, () => removeReaderAction(r.id), "Reader removed")}>
                Remove
              </PmsButton>
            </li>
          ))}
        </ul>
        {connected ? (
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run("reader", () => addReaderAction({ siteId, label, registrationCode: code, line1, city, postcode }), "Reader added");
            }}
          >
            <FormField id="reader-site" label="Site">
              <SelectInput value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                {view.sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <FormField id="reader-label" label="Reader name">
              <TextInput value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} data-testid="reader-label" />
            </FormField>
            {view.keyMode === "live" ? (
              <FormField id="reader-code" label="Pairing code shown on the reader">
                <TextInput value={code} onChange={(e) => setCode(e.target.value)} />
              </FormField>
            ) : (
              <p className="text-sm text-[#475569] sm:col-span-2">Test mode adds the payment provider&apos;s simulated reader – no hardware needed.</p>
            )}
            {!siteHasReader ? (
              <>
                <FormField id="reader-line1" label="Site address, first line">
                  <TextInput value={line1} onChange={(e) => setLine1(e.target.value)} data-testid="reader-line1" />
                </FormField>
                <FormField id="reader-city" label="Town">
                  <TextInput value={city} onChange={(e) => setCity(e.target.value)} data-testid="reader-city" />
                </FormField>
                <FormField id="reader-postcode" label="Postcode">
                  <TextInput value={postcode} onChange={(e) => setPostcode(e.target.value)} data-testid="reader-postcode" />
                </FormField>
              </>
            ) : null}
            <div className="sm:col-span-2">
              <PmsButton type="submit" loading={busy === "reader"} data-testid="reader-add">
                Add card reader
              </PmsButton>
            </div>
          </form>
        ) : null}
      </div>
    </SetupCard>
  );
}

function Plans({ view, busy, run }: { view: CardSetupView; busy: string | null; run: Run }) {
  const [name, setName] = React.useState("");
  const [price, setPrice] = React.useState("");
  return (
    <SetupCard title="Membership plans">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[#334155]">A membership charges a patient&apos;s saved card every month, with an invoice each time. Start one from the patient&apos;s Invoices tab.</p>
        <ul className="divide-y divide-border rounded-md border border-border" data-testid="card-plans">
          {view.plans.length === 0 ? <li className="px-3 py-2 text-sm text-[#475569]">No plans yet.</li> : null}
          {view.plans.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                <strong>{p.name}</strong> · {formatPence(p.pricePence)} a month · {p.members} member{p.members === 1 ? "" : "s"}
                {!p.active ? <span className="ml-2 text-xs text-[#475569]">(off)</span> : null}
              </span>
              <PmsButton size="sm" variant="secondary" loading={busy === `plan-${p.id}`} onClick={() => run(`plan-${p.id}`, () => setPlanActiveAction(p.id, !p.active))}>
                {p.active ? "Turn off" : "Turn on"}
              </PmsButton>
            </li>
          ))}
        </ul>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run("plan", () => createPlanAction({ name, pricePence: Math.round(Number(price) * 100) }), "Plan added").then(() => {
              setName("");
              setPrice("");
            });
          }}
        >
          <FormField id="plan-name" label="Plan name">
            <TextInput value={name} maxLength={80} onChange={(e) => setName(e.target.value)} data-testid="plan-name" />
          </FormField>
          <FormField id="plan-price" label="Monthly price (£)">
            <TextInput inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="plan-price" />
          </FormField>
          <PmsButton type="submit" loading={busy === "plan"} data-testid="plan-add">
            Add plan
          </PmsButton>
        </form>
      </div>
    </SetupCard>
  );
}
