"use client";
/**
 * Set-up → Xero (xe03–xe05): the clinic's Xero on/off, connect / disconnect, the mapping of services, payment
 * methods, VAT codes and sites to the organisation's own accounts, tax rates and tracking options, the sending
 * options and the send list (Retry / Skip / Send now). Browser-safe: the data comes from the page, changes go
 * through the page's server actions (src/app/app/clinic/setup/xero/actions.ts).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { SetupCard, SetupError, SetupHeader, SetupPage } from "@/components/pms/reporting/setup-kit";
import { Checkbox, ConfirmDialog, FormField, PmsButton, PmsNotice, SelectInput, Switch, TextInput } from "@/components/pms/ui";
import { formatUkDateTime } from "@/modules/pms/core/access";
import { XERO_COPY, XERO_SINGLE_KEY, XERO_STATUS_LABELS, paymentMapKey, type XeroMapKind } from "@/modules/pms/integration/xero";
import type { XeroOption, XeroScreenView } from "@/modules/pms/integration/xero-view";
import {
  disconnectXeroAction,
  retryXeroItemAction,
  sendXeroNowAction,
  setXeroEnabledAction,
  setXeroMappingAction,
  setXeroOptionsAction,
  skipXeroItemAction,
  startXeroConnectAction,
} from "@/app/app/clinic/setup/xero/actions";

type Notice = { tone: "error" | "success"; text: string } | null;

function current(view: XeroScreenView, kind: XeroMapKind, key: string): string {
  return view.maps.find((m) => m.kind === kind && m.key === key)?.value ?? "";
}

function MapSelect({ id, label, hint, kind, localKey, options, view, suggested }: { id: string; label: string; hint?: string; kind: XeroMapKind; localKey: string; options: XeroOption[]; view: XeroScreenView; suggested?: string | null }) {
  const router = useRouter();
  const saved = current(view, kind, localKey);
  const [value, setValue] = React.useState(saved);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => setValue(saved), [saved]);
  const savedLabel = view.maps.find((m) => m.kind === kind && m.key === localKey)?.label;
  const offered = saved && !options.some((o) => o.value === saved) ? [{ value: saved, label: `${savedLabel ?? saved} (no longer active in Xero)` }, ...options] : options;
  return (
    <FormField id={id} label={label} hint={hint}>
      <div className="flex flex-col gap-1">
        <SelectInput
          value={value}
          disabled={saving}
          data-testid={id}
          onChange={async (e) => {
            const next = e.target.value;
            setValue(next);
            setSaving(true);
            setError(null);
            const r = await setXeroMappingAction({ kind, localKey, xeroValue: next || null });
            setSaving(false);
            if (!r.ok) {
              setValue(saved);
              return setError(r.error);
            }
            router.refresh();
          }}
        >
          <option value="">{suggested ? "Not chosen (suggested below)" : "Not chosen"}</option>
          {offered.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectInput>
        {!saved && suggested ? <p className="text-xs text-[#475569]">Suggested: {options.find((o) => o.value === suggested)?.label ?? suggested}</p> : null}
        <SetupError error={error} />
      </div>
    </FormField>
  );
}

function Connection({ view }: { view: XeroScreenView }) {
  const router = useRouter();
  const c = view.connection;
  const [enabled, setEnabled] = React.useState(c.enabled);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  React.useEffect(() => setEnabled(c.enabled), [c.enabled]);
  const connected = c.status === "connected";
  return (
    <SetupCard title="Connection">
      <div className="flex flex-col gap-3">
        <Switch
          id="xero-enabled"
          checked={enabled}
          label="Send this clinic's invoices and payments to Xero"
          onCheckedChange={async (next) => {
            setError(null);
            const r = await setXeroEnabledAction(next);
            if (!r.ok) return setError(r.error);
            setEnabled(r.value.enabled);
            router.refresh();
          }}
        />
        {!enabled ? <p className="text-sm text-[#475569]">{XERO_COPY.off}</p> : null}
        {!view.configured ? <PmsNotice tone="warning" title={XERO_COPY.notConfigured} /> : null}
        {c.status === "paused" ? <PmsNotice tone="warning" title="Reconnect Xero">{XERO_COPY.paused}</PmsNotice> : null}
        <p className="text-sm" data-testid="xero-status">
          {connected
            ? `Connected to ${c.orgName ?? "Xero"}${c.connectedAt ? ` since ${formatUkDateTime(c.connectedAt)}` : ""}.`
            : c.status === "paused"
              ? `Paused – ${c.orgName ?? "Xero"} needs connecting again.`
              : c.status === "disconnected"
                ? `Disconnected${c.orgName ? ` from ${c.orgName}` : ""}. What was already sent stays in Xero.`
                : "Not connected."}
        </p>
        {enabled && view.configured ? (
          <div className="flex flex-wrap gap-2">
            {!connected ? (
              <PmsButton
                loading={busy}
                loadingText="Opening Xero…"
                data-testid="xero-connect"
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  const r = await startXeroConnectAction();
                  if (!r.ok) {
                    setBusy(false);
                    return setError(r.error);
                  }
                  window.location.assign(r.value.url);
                }}
              >
                {c.status === "not_connected" ? "Connect to Xero" : "Connect again"}
              </PmsButton>
            ) : null}
            {connected || c.status === "paused" ? (
              <PmsButton variant="destructive" onClick={() => setConfirm(true)} data-testid="xero-disconnect">
                Disconnect
              </PmsButton>
            ) : null}
          </div>
        ) : null}
        {view.wrongHost && enabled && !connected ? <p className="text-sm text-[#475569]">{XERO_COPY.wrongHost(view.wrongHost)}</p> : null}
        {enabled && !connected ? <p className="text-xs text-[#475569]">{XERO_COPY.connectHint}</p> : null}
        <SetupError error={error} />
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Disconnect Xero?"
        description={XERO_COPY.disconnectConfirm}
        confirmLabel="Disconnect"
        cancelLabel="Keep connected"
        destructive
        pending={busy}
        onConfirm={async () => {
          setBusy(true);
          const r = await disconnectXeroAction();
          setBusy(false);
          setConfirm(false);
          if (!r.ok) return setError(r.error);
          router.refresh();
        }}
      />
    </SetupCard>
  );
}

function Options({ view }: { view: XeroScreenView }) {
  const router = useRouter();
  const [sendFrom, setSendFrom] = React.useState(view.connection.sendFrom ?? "");
  const [details, setDetails] = React.useState(view.connection.sendContactDetails);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  return (
    <SetupCard title="What is sent">
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError(null);
          const r = await setXeroOptionsAction({ sendFrom, sendContactDetails: details });
          setSaving(false);
          if (!r.ok) return setError(r.error);
          router.refresh();
        }}
      >
        <FormField id="xero-send-from" label="Send invoices issued on or after" hint="Earlier invoices, and their payments, are not sent. Change it only before the first send.">
          <TextInput type="date" value={sendFrom} onChange={(e) => setSendFrom(e.target.value)} data-testid="xero-send-from" required />
        </FormField>
        <Checkbox checked={details} onChange={() => setDetails((v) => !v)} label="Also send patients' and payers' email and postal addresses (names are always sent)" />
        <SetupError error={error} />
        <div>
          <PmsButton type="submit" loading={saving} loadingText="Saving…">
            Save
          </PmsButton>
        </div>
      </form>
    </SetupCard>
  );
}

function Mapping({ view }: { view: XeroScreenView }) {
  const lists = view.lists;
  if (view.listsError) return <SetupCard title="Accounts and tax rates"><PmsNotice tone="warning" title={view.listsError} /></SetupCard>;
  if (!lists) return null;
  return (
    <>
      <SetupCard title="Sales accounts">
        <div className="grid gap-4 sm:grid-cols-2">
          <MapSelect id="xero-map-default" label="Default sales account" hint="Required. Used for every treatment unless a service has its own." kind="default_account" localKey={XERO_SINGLE_KEY} options={lists.revenueAccounts} view={view} />
          <MapSelect id="xero-map-item" label="Items (products and other lines)" kind="item_account" localKey={XERO_SINGLE_KEY} options={lists.revenueAccounts} view={view} />
          <MapSelect id="xero-map-visit" label="Missed and late-cancelled appointments" kind="visit_account" localKey={XERO_SINGLE_KEY} options={lists.revenueAccounts} view={view} />
          <MapSelect id="xero-map-writeoff" label="Write-offs (bad debts)" hint="Needed before any write-off is sent." kind="write_off_account" localKey={XERO_SINGLE_KEY} options={lists.revenueAccounts} view={view} />
        </div>
        {view.services.length ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium">A different account for one service (optional)</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {view.services.map((s) => (
                <MapSelect key={s.id} id={`xero-map-service-${s.id}`} label={s.name} kind="service_account" localKey={s.id} options={lists.revenueAccounts} view={view} />
              ))}
            </div>
          </details>
        ) : null}
      </SetupCard>
      <SetupCard title="Payments">
        <p className="mb-3 text-sm text-[#475569]">The Xero bank or clearing account each kind of payment is paid into.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {view.methods.map((m) => (
            <MapSelect key={m.id} id={`xero-map-pay-${m.id}`} label={m.name} kind="payment_account" localKey={m.id} options={lists.paymentAccounts} view={view} />
          ))}
        </div>
        {view.sites.length > 1 ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium">A different account for one site (optional)</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {view.sites.flatMap((site) =>
                view.methods.map((m) => (
                  <MapSelect key={`${site.id}-${m.id}`} id={`xero-map-pay-${m.id}-${site.id}`} label={`${site.name} – ${m.name}`} kind="payment_account" localKey={paymentMapKey(m.id, site.id)} options={lists.paymentAccounts} view={view} />
                )),
              )}
            </div>
          </details>
        ) : null}
      </SetupCard>
      <SetupCard title="VAT">
        <p className="mb-3 text-sm text-[#475569]">The organisation&apos;s own tax rates. Not needed while the clinic is not VAT-registered (lines then go as no tax).</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {view.vatCodes.map((v) => (
            <MapSelect key={v.id} id={`xero-map-tax-${v.id}`} label={v.name} kind="tax_type" localKey={v.id} options={lists.taxRates} view={view} suggested={v.suggested} />
          ))}
        </div>
      </SetupCard>
      {lists.tracking.length && view.sites.length ? (
        <SetupCard title="Sites (optional)">
          <p className="mb-3 text-sm text-[#475569]">Tag each site&apos;s invoices with a Xero tracking option.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {view.sites.map((s) => (
              <MapSelect key={s.id} id={`xero-map-site-${s.id}`} label={s.name} kind="tracking" localKey={s.id} options={lists.tracking} view={view} />
            ))}
          </div>
        </SetupCard>
      ) : null}
    </>
  );
}

function SendList({ view }: { view: XeroScreenView }) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const c = view.counts;
  const act = async (id: string, kind: "retry" | "skip") => {
    setBusy(id);
    setError(null);
    const r = kind === "retry" ? await retryXeroItemAction(id) : await skipXeroItemAction(id);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    if (kind === "retry") setInfo(XERO_COPY.retried);
    router.refresh();
  };
  return (
    <SetupCard
      title="Sending"
      action={
        view.connection.status === "connected" ? (
          <PmsButton
            size="sm"
            variant="secondary"
            loading={busy === "now"}
            loadingText="Sending…"
            data-testid="xero-send-now"
            onClick={async () => {
              setBusy("now");
              setError(null);
              const r = await sendXeroNowAction();
              setBusy(null);
              if (!r.ok) return setError(r.error);
              setInfo(`${r.value.sent} sent${r.value.needsYou ? `, ${r.value.needsYou} need you` : ""}.`);
              router.refresh();
            }}
          >
            {XERO_COPY.sendNow}
          </PmsButton>
        ) : null
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[#475569]" data-testid="xero-counts">
          {c.done} sent · {c.pending + c.in_flight} waiting · {c.blocked} need a fix · {c.failed} failed · {c.skipped} skipped
        </p>
        {view.missing.length && view.connection.status === "connected" ? (
          <PmsNotice tone="warning" title={XERO_COPY.mappingsMissing}>
            {view.missing.join(", ")}.
          </PmsNotice>
        ) : null}
        {info ? <p className="text-sm text-[#0B5E57]">{info}</p> : null}
        <SetupError error={error} />
        {view.problems.length ? (
          <ul className="divide-y divide-border" data-testid="xero-problems">
            {view.problems.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">
                    {p.what} <span className="ml-1 rounded-full bg-[#FEF3C7] px-2 py-0.5 text-xs font-medium text-[#92400E]">{XERO_STATUS_LABELS[p.status]}</span>
                  </p>
                  <p className="text-sm text-[#334155]">{p.message ?? "Xero did not say why."}</p>
                  <p className="text-xs text-[#475569]">
                    {p.attempts} {p.attempts === 1 ? "try" : "tries"} · last {formatUkDateTime(p.updatedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {p.status !== "pending" ? (
                    <PmsButton size="sm" variant="secondary" loading={busy === p.id} onClick={() => act(p.id, "retry")}>
                      Retry
                    </PmsButton>
                  ) : null}
                  <PmsButton size="sm" variant="ghost" disabled={busy === p.id} onClick={() => act(p.id, "skip")}>
                    Skip
                  </PmsButton>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[#475569]">Nothing needs you.</p>
        )}
        {view.recent.length ? (
          <details>
            <summary className="cursor-pointer text-sm font-medium">Latest</summary>
            <ul className="mt-2 space-y-1 text-sm text-[#334155]">
              {view.recent.map((r) => (
                <li key={r.id}>
                  {r.what} – {XERO_STATUS_LABELS[r.status]} · {formatUkDateTime(r.updatedAt)}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </SetupCard>
  );
}

export function XeroSetup({ view, notice }: { view: XeroScreenView; notice: Notice }) {
  const on = view.connection.enabled;
  const connected = view.connection.status === "connected";
  return (
    <SetupPage>
      <SetupHeader title={XERO_COPY.title} description={XERO_COPY.intro} />
      {notice ? <PmsNotice tone={notice.tone} title={notice.text} /> : null}
      <Connection view={view} />
      {on && connected ? (
        <>
          <Options view={view} />
          <Mapping view={view} />
        </>
      ) : null}
      {on && view.connection.status !== "not_connected" ? <SendList view={view} /> : null}
    </SetupPage>
  );
}
