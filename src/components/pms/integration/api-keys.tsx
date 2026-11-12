"use client";
/**
 * Set-up → API keys (tracker xt03): the clinic's API on/off, create a key (shown once), rotate and revoke keys, and
 * the developer docs with copyable examples. Browser-safe: the data comes from the page, changes through the
 * page's server actions (src/app/app/clinic/setup/api/actions.ts).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { SecretBox } from "@/components/account/form-controls";
import { SetupCard, SetupError, SetupHeader, SetupPage } from "@/components/pms/reporting/setup-kit";
import { Checkbox, ConfirmDialog, FormField, PmsButton, SelectInput, Switch, TextInput } from "@/components/pms/ui";
import { formatUkDateTime } from "@/modules/pms/core/access";
import { API_COPY, API_KEY_EXPIRY_DAYS, API_LIMITS, API_SCOPE_LABELS, API_SCOPES, type ApiScope } from "@/modules/pms/integration/api";
import type { ApiKeyRow, ApiScreenView } from "@/modules/pms/integration/api-view";
import { createApiKeyAction, revokeApiKeyAction, rotateApiKeyAction, setApiEnabledAction } from "@/app/app/clinic/setup/api/actions";

const STATE_TEXT: Record<ApiKeyRow["state"], string> = { active: "Active", expired: "Expired", revoked: "Revoked", replaced: "Replaced – stops at its end date" };
const STATE_CLASS: Record<ApiKeyRow["state"], string> = {
  active: "bg-[#E6F4F2] text-[#0B5E57]",
  expired: "bg-[#F1F5F9] text-[#475569]",
  revoked: "bg-[#F1F5F9] text-[#475569]",
  replaced: "bg-[#FEF3C7] text-[#92400E]",
};
const expiryLabel = (d: number) => (d === 0 ? "No expiry" : `${d} days`);

function NewKey({ shown }: { shown: { name: string; key: string } | null }) {
  if (!shown) return null;
  return (
    <div data-testid="api-new-key" className="mt-3">
      <SecretBox label={`New key: ${shown.name}`} value={shown.key} note={API_COPY.shownOnce} />
    </div>
  );
}

function CreateKey({ sites, disabled, onCreated }: { sites: ApiScreenView["sites"]; disabled: boolean; onCreated: (shown: { name: string; key: string }) => void }) {
  const [name, setName] = React.useState("");
  const [scopes, setScopes] = React.useState<ApiScope[]>(["appointments:read"]);
  const [siteIds, setSiteIds] = React.useState<string[]>([]);
  const [expires, setExpires] = React.useState<number>(90);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        const r = await createApiKeyAction({ name, scopes, siteIds, expiresInDays: expires as (typeof API_KEY_EXPIRY_DAYS)[number] });
        setSaving(false);
        if (!r.ok) return setError(r.error);
        setName("");
        onCreated(r.value);
      }}
    >
      <FormField id="api-key-name" label="Key name" hint="What uses it, e.g. the clinic's website booking">
        <TextInput required maxLength={API_LIMITS.nameMax} value={name} onChange={(e) => setName(e.target.value)} data-testid="api-key-name" />
      </FormField>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">What the key may do</legend>
        {API_SCOPES.map((s) => (
          <Checkbox
            key={s}
            checked={scopes.includes(s)}
            onChange={() => setScopes((v) => toggle(v, s))}
            data-testid={`api-scope-${s.replace(":", "-")}`}
            label={
              <>
                <span className="font-medium">{API_SCOPE_LABELS[s].label}</span> <span className="text-[#475569]">– {API_SCOPE_LABELS[s].hint}</span>
              </>
            }
          />
        ))}
      </fieldset>
      {sites.length > 1 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Sites (none ticked = every site)</legend>
          {sites.map((s) => (
            <Checkbox key={s.id} checked={siteIds.includes(s.id)} onChange={() => setSiteIds((v) => toggle(v, s.id))} label={s.name} />
          ))}
        </fieldset>
      ) : null}
      <FormField id="api-key-expiry" label="Stops working after">
        <SelectInput value={String(expires)} onChange={(e) => setExpires(Number(e.target.value))} data-testid="api-key-expiry">
          {API_KEY_EXPIRY_DAYS.map((d) => (
            <option key={d} value={d}>
              {expiryLabel(d)}
            </option>
          ))}
        </SelectInput>
      </FormField>
      <SetupError error={error} />
      <div>
        <PmsButton type="submit" loading={saving} loadingText="Creating…" disabled={disabled || scopes.length === 0} data-testid="api-key-create">
          Create key
        </PmsButton>
      </div>
    </form>
  );
}

function KeyList({ keys, onShown }: { keys: ApiKeyRow[]; onShown: (shown: { name: string; key: string }) => void }) {
  const router = useRouter();
  const [confirm, setConfirm] = React.useState<{ kind: "revoke" | "rotate"; key: ApiKeyRow } | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  if (keys.length === 0) return <p className="text-sm text-[#475569]">No keys yet.</p>;
  return (
    <>
      <SetupError error={error} />
      <ul className="divide-y divide-border" data-testid="api-key-list">
        {keys.map((k) => (
          <li key={k.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">
                {k.name} <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATE_CLASS[k.state]}`}>{STATE_TEXT[k.state]}</span>
              </p>
              <p className="break-all font-mono text-xs text-[#475569]">{k.label}</p>
              <p className="text-xs text-[#475569]">{k.scopes.map((s) => API_SCOPE_LABELS[s].label).join(", ")} · {k.sites ? k.sites.join(", ") : "Every site"}</p>
              <p className="text-xs text-[#475569]">
                Created {formatUkDateTime(k.createdAt)} by {k.createdBy} · {k.expiresAt ? `ends ${formatUkDateTime(k.expiresAt)}` : "no expiry"}
              </p>
              <p className="text-xs text-[#475569]" data-testid="api-key-usage">
                {k.lastUsedAt ? `Last used ${formatUkDateTime(k.lastUsedAt)}` : "Never used"} · {k.callsToday} calls today · {k.calls30} in 30 days · {k.patientReads30} patient records read in 30 days
              </p>
            </div>
            {k.state === "active" ? (
              <div className="flex shrink-0 gap-2">
                <PmsButton variant="secondary" size="sm" onClick={() => setConfirm({ kind: "rotate", key: k })}>
                  Replace
                </PmsButton>
                <PmsButton variant="destructive" size="sm" onClick={() => setConfirm({ kind: "revoke", key: k })} data-testid="api-key-revoke">
                  Revoke
                </PmsButton>
              </div>
            ) : k.state === "replaced" ? (
              <div className="shrink-0">
                <PmsButton variant="destructive" size="sm" onClick={() => setConfirm({ kind: "revoke", key: k })}>
                  Revoke now
                </PmsButton>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => (!open ? setConfirm(null) : undefined)}
        title={confirm?.kind === "rotate" ? "Replace this key?" : "Revoke this key?"}
        description={confirm ? (confirm.kind === "rotate" ? API_COPY.rotateConfirm(confirm.key.name) : API_COPY.revokeConfirm(confirm.key.name)) : null}
        confirmLabel={confirm?.kind === "rotate" ? "Make a new key" : "Revoke key"}
        cancelLabel="Keep it"
        destructive={confirm?.kind === "revoke"}
        pending={pending}
        onConfirm={async () => {
          if (!confirm) return;
          setPending(true);
          setError(null);
          const r = confirm.kind === "rotate" ? await rotateApiKeyAction(confirm.key.id) : await revokeApiKeyAction(confirm.key.id);
          setPending(false);
          setConfirm(null);
          if (!r.ok) return setError(r.error);
          if ("key" in r.value) onShown(r.value);
          router.refresh();
        }}
      />
    </>
  );
}

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto whitespace-pre rounded-md border border-border bg-[#F8FAFC] p-3 font-mono text-xs leading-relaxed text-[#0F172A]">{children}</pre>;
}

function Docs({ apiBase }: { apiBase: string }) {
  const key = "$CLINIC_API_KEY";
  const auth = `-H "Authorization: Bearer ${key}"`;
  return (
    <div className="flex flex-col gap-3 text-sm text-[#334155]" data-testid="api-docs">
      <p>
        Send every request over HTTPS to <code className="break-all font-mono text-xs">{apiBase}</code> with the key in the header{" "}
        <code className="font-mono text-xs">Authorization: Bearer &lt;key&gt;</code>. Keys in a web address or a cookie are never accepted, and the API cannot be called from another
        site&apos;s web pages. Answers are JSON: dates as YYYY-MM-DD (UK) or UTC times, money in pence, lists in pages – pass <code className="font-mono text-xs">nextCursor</code>{" "}
        as <code className="font-mono text-xs">?cursor=</code> for the next page. Errors look like <code className="font-mono text-xs">{`{"error": {"code": "…", "message": "…"}}`}</code>.
      </p>
      <p>
        The full description for developers:{" "}
        <a className="text-primary-strong underline underline-offset-2" href={`${apiBase}/openapi.json`}>
          openapi.json
        </a>
        .
      </p>
      <h3 className="mt-2 font-medium text-foreground">Appointments (at most {API_LIMITS.appointmentRangeDays} days at a time)</h3>
      <Code>{`curl ${auth} \\\n  "${apiBase}/appointments?from=2026-11-16&to=2026-11-20&limit=50"`}</Code>
      <h3 className="mt-2 font-medium text-foreground">Free times, then book one</h3>
      <Code>{`curl ${auth} \\\n  "${apiBase}/slots?siteId=SITE_ID&serviceId=SERVICE_ID&from=2026-11-16&days=7"\n\ncurl -X POST ${auth} \\\n  -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: booking-0001-retry-safe" \\\n  -d '{"patientId":"PATIENT_ID","serviceId":"SERVICE_ID","practitionerId":"PRACTITIONER_ID","siteId":"SITE_ID","date":"2026-11-16","startTime":"09:30"}' \\\n  "${apiBase}/appointments"`}</Code>
      <p>Send a new Idempotency-Key for every booking. Sending the same request again with the same key returns the same appointment and never books twice.</p>
      <h3 className="mt-2 font-medium text-foreground">Patients</h3>
      <Code>{`curl ${auth} "${apiBase}/patients?name=hart&dateOfBirth=1991-11-22"\ncurl ${auth} "${apiBase}/patients/PATIENT_ID"`}</Code>
      <p>Every patient record the API returns is shown in that patient&apos;s history, with the key&apos;s name.</p>
      <h3 className="mt-2 font-medium text-foreground">Invoices</h3>
      <Code>{`curl ${auth} "${apiBase}/invoices?from=2026-11-01&to=2026-11-30&status=issued"\ncurl ${auth} "${apiBase}/invoices/INVOICE_ID"`}</Code>
      <h3 className="mt-2 font-medium text-foreground">Limits and answers</h3>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          {API_LIMITS.perKeyPerMinute} requests a minute per key; too many answers 429 with a Retry-After header. Repeated wrong keys from one network are blocked for a while.
        </li>
        <li>401 – no key or a wrong, revoked or expired key. 403 – the key lacks the scope or the site, or the clinic&apos;s API is off. 404 – not found (also anything of another clinic or site). 422 – a value is not valid, or the time is not free.</li>
        <li>No clinical notes, booking notes, invoice descriptions or diagnoses are ever returned.</li>
      </ul>
    </div>
  );
}

export function ApiKeysSetup({ view, apiBase }: { view: ApiScreenView; apiBase: string }) {
  const router = useRouter();
  const [enabled, setEnabled] = React.useState(view.enabled);
  const [error, setError] = React.useState<string | null>(null);
  const [shown, setShown] = React.useState<{ name: string; key: string } | null>(null);
  React.useEffect(() => setEnabled(view.enabled), [view.enabled]);
  const onShown = (s: { name: string; key: string }) => {
    setShown(s);
    router.refresh();
  };
  return (
    <SetupPage>
      <SetupHeader title={API_COPY.title} description={API_COPY.intro} />
      <SetupCard title="Clinic API">
        <div className="flex flex-col gap-2">
          <Switch
            id="api-enabled"
            checked={enabled}
            label="Other systems may use this clinic's API"
            onCheckedChange={async (next) => {
              setError(null);
              const r = await setApiEnabledAction(next);
              if (!r.ok) return setError(r.error);
              setEnabled(r.value.enabled);
              router.refresh();
            }}
          />
          {!enabled ? <p className="text-sm text-[#475569]">{API_COPY.off}</p> : null}
          <SetupError error={error} />
        </div>
      </SetupCard>
      <SetupCard title="Create a key">
        <CreateKey sites={view.sites} disabled={false} onCreated={onShown} />
        <NewKey shown={shown} />
      </SetupCard>
      <SetupCard title="Keys">
        <KeyList keys={view.keys} onShown={onShown} />
      </SetupCard>
      <SetupCard title="For developers">
        <Docs apiBase={apiBase} />
      </SetupCard>
    </SetupPage>
  );
}
