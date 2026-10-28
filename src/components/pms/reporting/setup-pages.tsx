"use client";
/**
 * Set-up pages without a design of their own (rooms, services, price lists, referrers and insurers, practitioners,
 * record templates, billing settings, report targets), built on the "Sites and opening hours" pattern
 * (./setup-kit.tsx): a header with the primary action, a list on the left, the chosen item's form on the right.
 * "new" in the address opens an empty form. Data and permissions come from the pages (the server checks again).
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Checkbox, FormField, PmsButton, PmsNotice, SelectInput, Switch, TextArea, TextInput, useToast } from "@/components/pms/ui";
import { CONTRIBUTION_MODES, CONTRIBUTION_MODE_HINTS, CONTRIBUTION_MODE_LABELS, type ContributionMode } from "@/modules/pms/billing/excess";
import type { BillingSettings } from "@/modules/pms/billing/types";
import { PAYER_TYPES, PROFESSIONS, REFERRER_KINDS, SERVICE_CATEGORIES } from "@/modules/pms/core/schemas";
import { formatPence, formatUkDate } from "@/modules/pms/core/text";
import type { PmsSettings, Room, Site } from "@/modules/pms/core/types";
import type { NoteTemplate } from "@/modules/pms/records/templates";
import { PAYER_TYPE_LABELS, PROFESSION_LABELS, REFERRER_KIND_LABELS, SERVICE_CATEGORY_LABELS } from "@/modules/pms/reporting/copy";
import type { PractitionersScreen, PricesScreen, ReferrersScreen, ReportTargets } from "@/modules/pms/reporting/setup-view";
import type { Service } from "@/modules/pms/core/types";
import {
  saveBillingSettingsAction,
  savePractitionerAction,
  savePriceListAction,
  saveReferrerAction,
  saveRetentionAction,
  saveRoomAction,
  saveServiceAction,
  saveTargetsAction,
  setPayerModeAction,
  setPriceAction,
} from "@/app/app/clinic/setup/actions";
import { SetupCard, SetupError, SetupFormBar, SetupGrid, SetupHeader, SetupList, SetupPage, SetupSplit, setupFocus, useSetupForm } from "./setup-kit";

const BASE = "/app/clinic/setup";
const penceInput = (p: number | null | undefined) => (typeof p === "number" ? (p / 100).toFixed(2) : "");

function NewButton({ href, label, testId }: { href: string; label: string; testId: string }) {
  return (
    <Link href={href} scroll={false} data-testid={testId} className={`inline-flex h-9 items-center rounded-[8px] bg-primary-strong px-3.5 text-sm font-medium text-white hover:bg-[#095E57] ${setupFocus}`}>
      {label}
    </Link>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Rooms
 * ----------------------------------------------------------------------------------------------*/

export function RoomsSetup({ sites, rooms, siteId, roomId }: { sites: Site[]; rooms: Room[]; siteId: string | null; roomId: string | null }) {
  const router = useRouter();
  const site = sites.find((s) => s.id === siteId) ?? sites[0] ?? null;
  const mine = site ? rooms.filter((r) => r.siteId === site.id) : [];
  const room = roomId === "new" ? null : (mine.find((r) => r.id === roomId) ?? mine[0] ?? null);
  const isNew = roomId === "new" || (!room && mine.length === 0);
  const q = (r: string) => `${BASE}/rooms?site=${site?.id ?? ""}&room=${r}`;
  return (
    <SetupPage>
      <SetupHeader title="Rooms" description="Treatment rooms at each site. A room is never double-booked; switch a room off to stop new bookings in it." action={site ? <NewButton href={q("new")} label="Add room" testId="add-room" /> : null} />
      <div className="max-w-xs">
        <FormField id="rooms-site" label="Site">
          <SelectInput value={site?.id ?? ""} onChange={(e) => router.push(`${BASE}/rooms?site=${e.target.value}`)} data-testid="rooms-site">
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectInput>
        </FormField>
      </div>
      <SetupSplit list={<SetupList label="Rooms" testId="room-row" empty="No rooms at this site yet." items={mine.map((r) => ({ id: r.id, label: r.active ? r.name : `${r.name} (switched off)`, href: q(r.id), active: !isNew && room?.id === r.id, muted: !r.active }))} />}>
        {site ? <RoomForm key={isNew ? "new" : room?.id} siteId={site.id} room={isNew ? null : room} onCreated={(id) => router.push(q(id ?? ""))} /> : <p className="text-sm text-[#475569]">Add a site first.</p>}
      </SetupSplit>
    </SetupPage>
  );
}

function RoomForm({ siteId, room, onCreated }: { siteId: string; room: Room | null; onCreated: (id: string | undefined) => void }) {
  const f = useSetupForm({ name: room?.name ?? "", active: room?.active ?? true });
  return (
    <SetupCard title={room ? room.name : "New room"}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void f.submit(() => saveRoomAction({ roomId: room?.id ?? null, siteId, name: f.values.name, active: f.values.active }), room ? "Room saved." : `${f.values.name} added.`, room ? undefined : onCreated);
        }}
      >
        <FormField id="room-name" label="Room name" required error={f.fieldErrors.name}>
          <TextInput value={f.values.name} onChange={(e) => f.set("name", e.target.value)} data-testid="room-name" />
        </FormField>
        {room ? <Switch id="room-active" checked={f.values.active} onCheckedChange={(v) => f.set("active", v)} label={f.values.active ? "In use" : "Switched off"} /> : null}
        <SetupError error={f.error} />
        <SetupFormBar dirty={f.dirty || !room} saving={f.saving} onDiscard={f.discard} saveLabel={room ? "Save" : "Add room"} testId="room-save" />
      </form>
    </SetupCard>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Services
 * ----------------------------------------------------------------------------------------------*/

export function ServicesSetup({ services, serviceId }: { services: Service[]; serviceId: string | null }) {
  const router = useRouter();
  const chosen = serviceId === "new" ? null : (services.find((s) => s.id === serviceId) ?? null);
  const showForm = serviceId === "new" || chosen !== null;
  return (
    <SetupPage>
      <SetupHeader title="Services and durations" description="What can be booked, for how long, at what standard price, and whether patients can book it online." action={<NewButton href={`${BASE}/services?service=new`} label="Add service" testId="add-service" />} />
      {showForm ? <ServiceForm key={chosen?.id ?? "new"} service={chosen} onDone={() => router.push(`${BASE}/services`)} /> : null}
      <div className="overflow-x-auto rounded-2xl border border-border bg-white">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <caption className="sr-only">Services</caption>
          <thead>
            <tr className="bg-[#F8FAFC] text-left text-xs font-semibold text-[#475569]">
              <th scope="col" className="px-4 py-2.5">Service</th>
              <th scope="col" className="px-4 py-2.5">Type</th>
              <th scope="col" className="px-4 py-2.5 text-right">Duration</th>
              <th scope="col" className="px-4 py-2.5 text-right">Standard price</th>
              <th scope="col" className="px-4 py-2.5">Online</th>
              <th scope="col" className="px-4 py-2.5">
                <span className="sr-only">Change</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id} className="border-t border-[#F1F5F9]" data-testid="service-row">
                <td className="px-4 py-2.5 font-medium">{s.active ? s.name : `${s.name} (switched off)`}</td>
                <td className="px-4 py-2.5">{SERVICE_CATEGORY_LABELS[s.category] ?? s.category}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{s.durationMinutes} min</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{s.defaultPricePence === null ? "–" : formatPence(s.defaultPricePence)}</td>
                <td className="px-4 py-2.5">{s.onlineBookable ? "Yes" : "No"}</td>
                <td className="px-4 py-2.5 text-right">
                  <Link href={`${BASE}/services?service=${s.id}`} scroll={false} className={`text-primary-strong underline underline-offset-2 ${setupFocus}`}>
                    Change<span className="sr-only"> {s.name}</span>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SetupPage>
  );
}

function ServiceForm({ service, onDone }: { service: Service | null; onDone: () => void }) {
  const f = useSetupForm({
    name: service?.name ?? "",
    durationMinutes: String(service?.durationMinutes ?? 30),
    bufferMinutes: String(service?.bufferMinutes ?? 0),
    price: penceInput(service?.defaultPricePence),
    category: service?.category ?? "follow_up",
    colour: service?.colour ?? "",
    onlineBookable: service?.onlineBookable ?? false,
    active: service?.active ?? true,
  });
  return (
    <SetupCard title={service ? service.name : "New service"}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void f.submit(() => saveServiceAction({ serviceId: service?.id ?? null, ...f.values }), service ? "Service saved." : `${f.values.name} added.`, onDone);
        }}
      >
        <SetupGrid>
          <FormField id="service-name" label="Name" required error={f.fieldErrors.name}>
            <TextInput value={f.values.name} onChange={(e) => f.set("name", e.target.value)} data-testid="service-name" />
          </FormField>
          <FormField id="service-category" label="Type">
            <SelectInput value={f.values.category} onChange={(e) => f.set("category", e.target.value as typeof f.values.category)}>
              {SERVICE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {SERVICE_CATEGORY_LABELS[c]}
                </option>
              ))}
            </SelectInput>
          </FormField>
          <FormField id="service-duration" label="Duration (minutes)" required error={f.fieldErrors.durationMinutes}>
            <TextInput inputMode="numeric" value={f.values.durationMinutes} onChange={(e) => f.set("durationMinutes", e.target.value)} data-testid="service-duration" />
          </FormField>
          <FormField id="service-buffer" label="Gap after (minutes)" error={f.fieldErrors.bufferMinutes}>
            <TextInput inputMode="numeric" value={f.values.bufferMinutes} onChange={(e) => f.set("bufferMinutes", e.target.value)} />
          </FormField>
          <FormField id="service-price" label="Standard price (£)" error={f.fieldErrors.defaultPricePence}>
            <TextInput inputMode="decimal" value={f.values.price} onChange={(e) => f.set("price", e.target.value)} data-testid="service-price" />
          </FormField>
          <FormField id="service-colour" label="Colour (#RRGGBB, optional)" error={f.fieldErrors.colour}>
            <TextInput value={f.values.colour} onChange={(e) => f.set("colour", e.target.value)} />
          </FormField>
        </SetupGrid>
        <div className="flex flex-wrap gap-6">
          <Switch id="service-online" checked={f.values.onlineBookable} onCheckedChange={(v) => f.set("onlineBookable", v)} label="Patients can book it online" />
          {service ? <Switch id="service-active" checked={f.values.active} onCheckedChange={(v) => f.set("active", v)} label={f.values.active ? "In use" : "Switched off"} /> : null}
        </div>
        <SetupError error={f.error} />
        <SetupFormBar dirty={f.dirty || !service} saving={f.saving} onDiscard={service ? f.discard : onDone} discardable saveLabel={service ? "Save" : "Add service"} testId="service-save" />
      </form>
    </SetupCard>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Price lists
 * ----------------------------------------------------------------------------------------------*/

export function PricesSetup({ screen, isNew }: { screen: PricesScreen; isNew: boolean }) {
  const router = useRouter();
  const sel = isNew ? null : screen.selected;
  return (
    <SetupPage>
      <SetupHeader title="Price lists" description="Standard prices and each insurer's own list. A visit is priced from the case's list, then the default list, then the service's standard price." action={<NewButton href={`${BASE}/prices?list=new`} label="Add price list" testId="add-price-list" />} />
      <SetupSplit
        list={
          <SetupList
            label="Price lists"
            testId="price-list-row"
            empty="No price lists yet."
            items={screen.lists.map((l) => ({ id: l.id, label: l.active ? l.name : `${l.name} (switched off)`, meta: l.isDefault ? "Default" : l.payerType ? PAYER_TYPE_LABELS[l.payerType] : undefined, href: `${BASE}/prices?list=${l.id}`, active: sel?.list.id === l.id, muted: !l.active }))}
          />
        }
      >
        <PriceListForm key={sel?.list.id ?? "new"} list={sel?.list ?? null} payers={screen.payers} onCreated={(id) => router.push(`${BASE}/prices?list=${id ?? ""}`)} />
        {sel ? <PriceItems key={`items-${sel.list.id}`} listId={sel.list.id} items={sel.items} services={screen.services} /> : null}
      </SetupSplit>
    </SetupPage>
  );
}

function PriceListForm({ list, payers, onCreated }: { list: PricesScreen["lists"][number] | null; payers: PricesScreen["payers"]; onCreated: (id: string | undefined) => void }) {
  const f = useSetupForm({
    name: list?.name ?? "",
    payerType: list?.payerType ?? "",
    referrerId: list?.referrerId ?? "",
    isDefault: list?.isDefault ?? false,
    validFrom: list?.validFrom ?? "",
    validTo: list?.validTo ?? "",
    active: list?.active ?? true,
  });
  return (
    <SetupCard title={list ? list.name : "New price list"}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void f.submit(() => savePriceListAction({ listId: list?.id ?? null, ...f.values }), list ? "Price list saved." : `${f.values.name} added.`, list ? undefined : onCreated);
        }}
      >
        <SetupGrid>
          <FormField id="pl-name" label="Name" required error={f.fieldErrors.name}>
            <TextInput value={f.values.name} onChange={(e) => f.set("name", e.target.value)} data-testid="price-list-name" />
          </FormField>
          <FormField id="pl-payer-type" label="For payers">
            <SelectInput value={f.values.payerType} onChange={(e) => f.set("payerType", e.target.value)}>
              <option value="">Any payer</option>
              {PAYER_TYPES.map((p) => (
                <option key={p} value={p}>
                  {PAYER_TYPE_LABELS[p]}
                </option>
              ))}
            </SelectInput>
          </FormField>
          <FormField id="pl-referrer" label="One insurer's own list" error={f.fieldErrors.referrerId}>
            <SelectInput value={f.values.referrerId} onChange={(e) => f.set("referrerId", e.target.value)} data-testid="price-list-insurer">
              <option value="">Not for one payer</option>
              {payers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </SelectInput>
          </FormField>
          <FormField id="pl-from" label="Valid from" error={f.fieldErrors.validFrom}>
            <TextInput type="date" value={f.values.validFrom} onChange={(e) => f.set("validFrom", e.target.value)} />
          </FormField>
          <FormField id="pl-to" label="Valid to" error={f.fieldErrors.validTo}>
            <TextInput type="date" value={f.values.validTo} onChange={(e) => f.set("validTo", e.target.value)} />
          </FormField>
        </SetupGrid>
        <div className="flex flex-wrap gap-6">
          <Checkbox label="The clinic's default list" checked={f.values.isDefault} onChange={(e) => f.set("isDefault", e.target.checked)} />
          {list ? <Switch id="pl-active" checked={f.values.active} onCheckedChange={(v) => f.set("active", v)} label={f.values.active ? "In use" : "Switched off"} /> : null}
        </div>
        <SetupError error={f.error} />
        <SetupFormBar dirty={f.dirty || !list} saving={f.saving} onDiscard={f.discard} saveLabel={list ? "Save" : "Add price list"} testId="price-list-save" />
      </form>
    </SetupCard>
  );
}

function PriceItems({ listId, items, services }: { listId: string; items: PricesScreen["selected"] extends infer S ? (S extends { items: infer I } ? I : never) : never; services: Service[] }) {
  const router = useRouter();
  const toast = useToast();
  const initial = React.useMemo(() => Object.fromEntries(services.map((s) => [s.id, penceInput(items.find((i) => i.serviceId === s.id)?.pricePence)])), [items, services]);
  const [prices, setPrices] = React.useState<Record<string, string>>(initial);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  // Back to the stored prices only when they really changed (a refresh with the same list keeps what is typed).
  const initialKey = JSON.stringify(initial);
  React.useEffect(() => setPrices(JSON.parse(initialKey) as Record<string, string>), [initialKey]);
  async function save(serviceId: string) {
    setBusy(serviceId);
    const r = await setPriceAction({ listId, serviceId, price: prices[serviceId] ?? "" });
    setBusy(null);
    if (!r.ok) {
      setErrors({ ...errors, [serviceId]: r.error });
      return;
    }
    setErrors({ ...errors, [serviceId]: "" });
    toast.success(prices[serviceId] ? "Price saved." : "Price taken off the list.");
    router.refresh();
  }
  return (
    <SetupCard title="Prices on this list" padded={false}>
      <ul>
        {services.map((s) => {
          const changed = (prices[s.id] ?? "") !== (initial[s.id] ?? "");
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-3 border-b border-[#F1F5F9] px-5 py-2">
              <span className="min-w-[160px] flex-1">
                {s.name}
                <span className="block text-xs text-[#475569]">Standard {s.defaultPricePence === null ? "–" : formatPence(s.defaultPricePence)}</span>
              </span>
              <label className="sr-only" htmlFor={`price-${s.id}`}>
                Price of {s.name} on this list (£)
              </label>
              <TextInput id={`price-${s.id}`} inputMode="decimal" className="h-8 w-[110px] tabular-nums" placeholder="Not on list" value={prices[s.id] ?? ""} onChange={(e) => setPrices({ ...prices, [s.id]: e.target.value })} data-testid="price-item" data-service={s.id} />
              <PmsButton variant="secondary" size="sm" disabled={!changed} loading={busy === s.id} onClick={() => void save(s.id)} data-testid="price-item-save">
                Save<span className="sr-only"> price of {s.name}</span>
              </PmsButton>
              {errors[s.id] ? (
                <span role="alert" className="w-full text-xs text-destructive-strong">
                  {errors[s.id]}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </SetupCard>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Referrers and insurers
 * ----------------------------------------------------------------------------------------------*/

export function ReferrersSetup({ screen, isNew, kind }: { screen: ReferrersScreen; isNew: boolean; kind: string | null }) {
  const router = useRouter();
  const sel = isNew ? null : screen.selected;
  const q = (extra: string) => `${BASE}/referrers?${kind ? `kind=${kind}&` : ""}${extra}`;
  return (
    <SetupPage>
      <SetupHeader title="Referrers and insurers" description="Who refers patients and who pays: GPs, consultants, insurers, medico-legal companies, solicitors and employers." action={<NewButton href={q("referrer=new")} label="Add referrer or insurer" testId="add-referrer" />} />
      <div className="max-w-xs">
        <FormField id="referrer-kind-filter" label="Show">
          <SelectInput value={kind ?? ""} onChange={(e) => router.push(`${BASE}/referrers${e.target.value ? `?kind=${e.target.value}` : ""}`)}>
            <option value="">Everyone</option>
            {REFERRER_KINDS.map((k) => (
              <option key={k} value={k}>
                {REFERRER_KIND_LABELS[k]}
              </option>
            ))}
          </SelectInput>
        </FormField>
      </div>
      <SetupSplit
        list={
          <SetupList
            label="Referrers and insurers"
            testId="referrer-row"
            empty="Nobody here yet."
            items={screen.referrers.map((r) => ({ id: r.id, label: r.active ? r.name : `${r.name} (switched off)`, meta: REFERRER_KIND_LABELS[r.kind], href: q(`referrer=${r.id}`), active: sel?.referrer.id === r.id, muted: !r.active }))}
          />
        }
      >
        <ReferrerForm key={sel?.referrer.id ?? "new"} referrer={sel?.referrer ?? null} defaultKind={kind ?? "insurer"} onCreated={(id) => router.push(q(`referrer=${id ?? ""}`))} />
        {sel?.payer ? <PayerAccount key={`payer-${sel.referrer.id}`} referrerId={sel.referrer.id} name={sel.referrer.name} payer={sel.payer} /> : null}
      </SetupSplit>
    </SetupPage>
  );
}

function ReferrerForm({ referrer, defaultKind, onCreated }: { referrer: ReferrersScreen["referrers"][number] | null; defaultKind: string; onCreated: (id: string | undefined) => void }) {
  const f = useSetupForm({
    kind: referrer?.kind ?? defaultKind,
    name: referrer?.name ?? "",
    contactName: referrer?.contactName ?? "",
    email: referrer?.email ?? "",
    phone: referrer?.phone ?? "",
    address: (referrer?.address ?? []).join(", "),
    postcode: referrer?.postcode ?? "",
    active: referrer?.active ?? true,
  });
  return (
    <SetupCard title={referrer ? referrer.name : "New referrer or insurer"}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void f.submit(() => saveReferrerAction({ referrerId: referrer?.id ?? null, rev: referrer?.rev, ...f.values }), referrer ? "Saved." : `${f.values.name} added.`, referrer ? undefined : onCreated);
        }}
      >
        <SetupGrid>
          <FormField id="ref-kind" label="Kind">
            <SelectInput value={f.values.kind} onChange={(e) => f.set("kind", e.target.value as typeof f.values.kind)} data-testid="referrer-kind">
              {REFERRER_KINDS.map((k) => (
                <option key={k} value={k}>
                  {REFERRER_KIND_LABELS[k]}
                </option>
              ))}
            </SelectInput>
          </FormField>
          <FormField id="ref-name" label="Name" required error={f.fieldErrors.name}>
            <TextInput value={f.values.name} onChange={(e) => f.set("name", e.target.value)} data-testid="referrer-name" />
          </FormField>
          <FormField id="ref-contact" label="Contact name" error={f.fieldErrors.contactName}>
            <TextInput value={f.values.contactName} onChange={(e) => f.set("contactName", e.target.value)} />
          </FormField>
          <FormField id="ref-email" label="Email" error={f.fieldErrors.email}>
            <TextInput type="email" value={f.values.email} onChange={(e) => f.set("email", e.target.value)} />
          </FormField>
          <FormField id="ref-phone" label="Phone" error={f.fieldErrors.phone}>
            <TextInput type="tel" value={f.values.phone} onChange={(e) => f.set("phone", e.target.value)} />
          </FormField>
          <FormField id="ref-address" label="Address" hint="Lines separated by commas" error={f.fieldErrors.address}>
            <TextInput value={f.values.address} onChange={(e) => f.set("address", e.target.value)} />
          </FormField>
          <FormField id="ref-postcode" label="Postcode" error={f.fieldErrors.postcode}>
            <TextInput value={f.values.postcode} onChange={(e) => f.set("postcode", e.target.value)} />
          </FormField>
        </SetupGrid>
        {referrer ? <Switch id="ref-active" checked={f.values.active} onCheckedChange={(v) => f.set("active", v)} label={f.values.active ? "In use" : "Switched off"} /> : null}
        <SetupError error={f.error} />
        <SetupFormBar dirty={f.dirty || !referrer} saving={f.saving} onDiscard={f.discard} saveLabel={referrer ? "Save" : "Add"} testId="referrer-save" />
      </form>
    </SetupCard>
  );
}

function PayerAccount({ referrerId, name, payer }: { referrerId: string; name: string; payer: NonNullable<NonNullable<ReferrersScreen["selected"]>["payer"]> }) {
  const f = useSetupForm({ mode: payer.mode as ContributionMode });
  return (
    <SetupCard title="Payer account">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void f.submit(() => setPayerModeAction(referrerId, f.values.mode), `${name}: ${CONTRIBUTION_MODE_LABELS[f.values.mode].toLowerCase()}.`);
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">How the patient&apos;s part of an insured visit is billed</legend>
          {CONTRIBUTION_MODES.map((m) => (
            <label key={m} className="flex items-start gap-2 text-sm">
              <input type="radio" name={`mode-${referrerId}`} value={m} checked={f.values.mode === m} onChange={() => f.set("mode", m)} className="mt-0.5 h-4 w-4 accent-[#0B7970]" data-testid={`payer-mode-${m}`} />
              <span>
                <span className="font-medium">{CONTRIBUTION_MODE_LABELS[m]}</span>
                {m === "per_case" ? " (the default)" : ""}
                <span className="block text-xs text-[#475569]">{CONTRIBUTION_MODE_HINTS[m]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-[#475569]">Payment terms</dt>
          <dd>
            {payer.accountTermsDays} days (the clinic&apos;s account terms –{" "}
            <Link href={`${BASE}/billing`} className={`text-primary-strong underline underline-offset-2 ${setupFocus}`}>
              Billing settings
            </Link>
            )
          </dd>
          <dt className="text-[#475569]">Price list</dt>
          <dd>
            {payer.priceLists.length ? (
              payer.priceLists.map((l, i) => (
                <React.Fragment key={l.id}>
                  {i > 0 ? ", " : ""}
                  <Link href={`${BASE}/prices?list=${l.id}`} className={`text-primary-strong underline underline-offset-2 ${setupFocus}`}>
                    {l.name}
                  </Link>
                </React.Fragment>
              ))
            ) : (
              <>
                The clinic&apos;s default prices –{" "}
                <Link href={`${BASE}/prices?list=new`} className={`text-primary-strong underline underline-offset-2 ${setupFocus}`}>
                  add a list for {name}
                </Link>
              </>
            )}
          </dd>
        </dl>
        <SetupError error={f.error} />
        <SetupFormBar dirty={f.dirty} saving={f.saving} onDiscard={f.discard} testId="payer-mode-save" />
      </form>
    </SetupCard>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Practitioners
 * ----------------------------------------------------------------------------------------------*/

export function PractitionersSetup({ screen, isNew }: { screen: PractitionersScreen; isNew: boolean }) {
  const router = useRouter();
  const sel = isNew ? null : screen.selected;
  const memberName = new Map(screen.members.map((m) => [m.userId, m.name]));
  return (
    <SetupPage>
      <SetupHeader title="Practitioners" description="Who appears in the diary. Link a practitioner to a member's sign-in so the diary shows them their day and they can sign their notes." action={<NewButton href={`${BASE}/practitioners?practitioner=new`} label="Add practitioner" testId="add-practitioner" />} />
      <SetupSplit
        list={
          <SetupList
            label="Practitioners"
            testId="practitioner-row"
            items={screen.practitioners.map((p) => ({
              id: p.id,
              label: p.active ? p.displayName : `${p.displayName} (switched off)`,
              meta: p.userId ? `Linked · ${memberName.get(p.userId) ?? "member"}` : p.bookable ? "Diary" : "Not in the diary",
              href: `${BASE}/practitioners?practitioner=${p.id}`,
              active: sel?.id === p.id,
              muted: !p.active,
            }))}
          />
        }
      >
        <PractitionerForm key={sel?.id ?? "new"} p={sel} members={screen.members} sites={screen.sites} onCreated={(id) => router.push(`${BASE}/practitioners?practitioner=${id ?? ""}`)} />
      </SetupSplit>
    </SetupPage>
  );
}

function PractitionerForm({ p, members, sites, onCreated }: { p: PractitionersScreen["selected"]; members: PractitionersScreen["members"]; sites: Site[]; onCreated: (id: string | undefined) => void }) {
  const f = useSetupForm({
    displayName: p?.displayName ?? "",
    profession: p?.profession ?? "physiotherapist",
    registrationNumber: p?.registrationNumber ?? "",
    email: p?.email ?? "",
    phone: p?.phone ?? "",
    colour: p?.colour ?? "",
    defaultSiteId: p?.defaultSiteId ?? "",
    bookable: p?.bookable ?? true,
    onlineBookable: p?.onlineBookable ?? false,
    active: p?.active ?? true,
    userId: p?.userId ?? "",
  });
  const choices = members.filter((m) => !m.linkedTo || m.linkedTo === p?.id);
  return (
    <SetupCard title={p ? p.displayName : "New practitioner"}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void f.submit(() => savePractitionerAction({ practitionerId: p?.id ?? null, ...f.values }), p ? "Practitioner saved." : `${f.values.displayName} added.`, p ? undefined : onCreated);
        }}
      >
        <SetupGrid>
          <FormField id="pr-name" label="Name in the diary" required error={f.fieldErrors.displayName}>
            <TextInput value={f.values.displayName} onChange={(e) => f.set("displayName", e.target.value)} data-testid="practitioner-name" />
          </FormField>
          <FormField id="pr-profession" label="Profession">
            <SelectInput value={f.values.profession} onChange={(e) => f.set("profession", e.target.value as typeof f.values.profession)}>
              {PROFESSIONS.map((x) => (
                <option key={x} value={x}>
                  {PROFESSION_LABELS[x]}
                </option>
              ))}
            </SelectInput>
          </FormField>
          <FormField id="pr-reg" label="Registration number" hint="As on the register (e.g. HCPC)" error={f.fieldErrors.registrationNumber}>
            <TextInput value={f.values.registrationNumber} onChange={(e) => f.set("registrationNumber", e.target.value)} />
          </FormField>
          <FormField id="pr-member" label="Member's sign-in" hint="Links the diary column to this person" error={f.fieldErrors.userId}>
            <SelectInput value={f.values.userId} onChange={(e) => f.set("userId", e.target.value)} data-testid="practitioner-member">
              <option value="">Not linked</option>
              {choices.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name} ({m.email})
                </option>
              ))}
            </SelectInput>
          </FormField>
          <FormField id="pr-email" label="Email" error={f.fieldErrors.email}>
            <TextInput type="email" value={f.values.email} onChange={(e) => f.set("email", e.target.value)} />
          </FormField>
          <FormField id="pr-phone" label="Phone" error={f.fieldErrors.phone}>
            <TextInput type="tel" value={f.values.phone} onChange={(e) => f.set("phone", e.target.value)} />
          </FormField>
          <FormField id="pr-site" label="Usual site" error={f.fieldErrors.defaultSiteId}>
            <SelectInput value={f.values.defaultSiteId} onChange={(e) => f.set("defaultSiteId", e.target.value)}>
              <option value="">None</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </SelectInput>
          </FormField>
          <FormField id="pr-colour" label="Colour (#RRGGBB, optional)" error={f.fieldErrors.colour}>
            <TextInput value={f.values.colour} onChange={(e) => f.set("colour", e.target.value)} />
          </FormField>
        </SetupGrid>
        <div className="flex flex-wrap gap-6">
          <Switch id="pr-bookable" checked={f.values.bookable} onCheckedChange={(v) => f.set("bookable", v)} label="Bookable in the diary" />
          <Switch id="pr-online" checked={f.values.onlineBookable} onCheckedChange={(v) => f.set("onlineBookable", v)} label="Bookable online" />
          {p ? <Switch id="pr-active" checked={f.values.active} onCheckedChange={(v) => f.set("active", v)} label={f.values.active ? "In use" : "Switched off"} /> : null}
        </div>
        {p ? (
          <p className="text-sm text-[#475569]">
            Working times:{" "}
            <Link href={`/app/clinic/diary/rotas?practitioner=${p.id}`} className={`text-primary-strong underline underline-offset-2 ${setupFocus}`} data-testid="practitioner-rota">
              rota for {p.displayName}
            </Link>
            {p.userId ? (
              <>
                {" "}
                · signing details on{" "}
                <Link href={`/app/clinic/access/${p.userId}`} className={`text-primary-strong underline underline-offset-2 ${setupFocus}`}>
                  Member access
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
        <SetupError error={f.error} />
        <SetupFormBar dirty={f.dirty || !p} saving={f.saving} onDiscard={f.discard} saveLabel={p ? "Save" : "Add practitioner"} testId="practitioner-save" />
      </form>
    </SetupCard>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Record templates and record keeping
 * ----------------------------------------------------------------------------------------------*/

export function RecordsSetup({ templates, settings }: { templates: NoteTemplate[]; settings: PmsSettings }) {
  const f = useSetupForm({ retentionAdultYears: String(settings.retentionAdultYears), retentionChildUntilAge: String(settings.retentionChildUntilAge) });
  return (
    <SetupPage>
      <SetupHeader
        title="Record templates"
        description="The clinical note templates clinicians start from, and how long records are kept."
        action={<NewButton href="/app/clinic/patients/note-templates" label="Edit note templates" testId="edit-note-templates" />}
      />
      <SetupCard title="Note templates" padded={false}>
        <ul>
          {templates.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 border-b border-[#F1F5F9] px-5 py-2.5">
              <span className="min-w-0 flex-1 font-medium">{t.name}</span>
              <span className="text-xs text-[#475569]">
                {t.builtin ? "Built in" : "The clinic's own"}
                {t.active ? "" : " · switched off"} · {t.sections.length} sections
              </span>
            </li>
          ))}
        </ul>
      </SetupCard>
      <SetupCard title="Record keeping">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void f.submit(() => saveRetentionAction({ retentionAdultYears: Number(f.values.retentionAdultYears), retentionChildUntilAge: Number(f.values.retentionChildUntilAge) }), "Record keeping saved.");
          }}
        >
          <SetupGrid>
            <FormField id="ret-adult" label="Adults: keep records for (years after the last treatment)" hint="At least 8 – can only go up" error={f.fieldErrors.retentionAdultYears}>
              <TextInput inputMode="numeric" value={f.values.retentionAdultYears} onChange={(e) => f.set("retentionAdultYears", e.target.value)} />
            </FormField>
            <FormField id="ret-child" label="Children: keep records until their birthday" hint="At least 25 – can only go up" error={f.fieldErrors.retentionChildUntilAge}>
              <TextInput inputMode="numeric" value={f.values.retentionChildUntilAge} onChange={(e) => f.set("retentionChildUntilAge", e.target.value)} />
            </FormField>
          </SetupGrid>
          <SetupError error={f.error} />
          <SetupFormBar dirty={f.dirty} saving={f.saving} onDiscard={f.discard} testId="records-save" />
        </form>
      </SetupCard>
    </SetupPage>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Billing settings
 * ----------------------------------------------------------------------------------------------*/

export function BillingSetup({ settings }: { settings: BillingSettings }) {
  const f = useSetupForm({
    invoicePrefix: settings.invoicePrefix,
    creditNotePrefix: settings.creditNotePrefix,
    firstInvoiceNumber: String(settings.firstInvoiceNumber),
    firstCreditNoteNumber: String(settings.firstCreditNoteNumber),
    selfPayTermsDays: String(settings.selfPayTermsDays),
    accountTermsDays: String(settings.accountTermsDays),
    vatRegistered: settings.vatRegistered,
    vatNumber: settings.vatNumber ?? "",
    pricesIncludeVat: settings.pricesIncludeVat,
    dnaChargePercent: String(settings.dnaChargePercent),
    lateCancelChargePercent: String(settings.lateCancelChargePercent),
    paymentInstructions: settings.paymentInstructions ?? "",
    bankAccountName: settings.bankDetails?.accountName ?? "",
    bankSortCode: settings.bankDetails?.sortCode ?? "",
    bankAccountNumber: settings.bankDetails?.accountNumber ?? "",
  });
  const e = f.fieldErrors;
  return (
    <SetupPage>
      <SetupHeader title="Billing settings" description={`VAT, invoice numbers, payment terms and the bank details printed on invoices.${settings.updatedAt ? ` Last changed ${formatUkDate(settings.updatedAt.slice(0, 10))}.` : ""}`} />
      <form
        className="flex flex-col gap-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          void f.submit(() => saveBillingSettingsAction({ rev: settings.rev, ...f.values }), "Billing settings saved – new invoices use them.");
        }}
      >
        <SetupCard title="Invoice numbers">
          <SetupGrid>
            <FormField id="bs-prefix" label="Invoice prefix" hint="1–4 letters, e.g. INV" error={e.invoicePrefix}>
              <TextInput value={f.values.invoicePrefix} maxLength={4} onChange={(x) => f.set("invoicePrefix", x.target.value)} data-testid="billing-prefix" />
            </FormField>
            <FormField id="bs-first" label="First invoice number" hint="Used only before the first invoice with this prefix" error={e.firstInvoiceNumber}>
              <TextInput inputMode="numeric" value={f.values.firstInvoiceNumber} onChange={(x) => f.set("firstInvoiceNumber", x.target.value)} />
            </FormField>
            <FormField id="bs-cn-prefix" label="Credit note prefix" error={e.creditNotePrefix}>
              <TextInput value={f.values.creditNotePrefix} maxLength={4} onChange={(x) => f.set("creditNotePrefix", x.target.value)} />
            </FormField>
            <FormField id="bs-cn-first" label="First credit note number" error={e.firstCreditNoteNumber}>
              <TextInput inputMode="numeric" value={f.values.firstCreditNoteNumber} onChange={(x) => f.set("firstCreditNoteNumber", x.target.value)} />
            </FormField>
          </SetupGrid>
        </SetupCard>
        <SetupCard title="VAT">
          <div className="flex flex-col gap-3">
            <Checkbox label="The clinic is VAT registered" checked={f.values.vatRegistered} onChange={(x) => f.set("vatRegistered", x.target.checked)} />
            <SetupGrid>
              <FormField id="bs-vat" label="VAT number" hint="GB and 9 digits" error={e.vatNumber}>
                <TextInput value={f.values.vatNumber} onChange={(x) => f.set("vatNumber", x.target.value)} />
              </FormField>
            </SetupGrid>
            <Checkbox label="Prices include VAT" checked={f.values.pricesIncludeVat} onChange={(x) => f.set("pricesIncludeVat", x.target.checked)} />
          </div>
        </SetupCard>
        <SetupCard title="Payment terms and charges">
          <SetupGrid>
            <FormField id="bs-self" label="Self-pay: due after (days)" hint="0 = on the day" error={e.selfPayTermsDays}>
              <TextInput inputMode="numeric" value={f.values.selfPayTermsDays} onChange={(x) => f.set("selfPayTermsDays", x.target.value)} />
            </FormField>
            <FormField id="bs-account" label="Insurers and other accounts: due after (days)" error={e.accountTermsDays}>
              <TextInput inputMode="numeric" value={f.values.accountTermsDays} onChange={(x) => f.set("accountTermsDays", x.target.value)} />
            </FormField>
            <FormField id="bs-dna" label="Did-not-attend charge (% of the price)" error={e.dnaChargePercent}>
              <TextInput inputMode="numeric" value={f.values.dnaChargePercent} onChange={(x) => f.set("dnaChargePercent", x.target.value)} />
            </FormField>
            <FormField id="bs-late" label="Late cancellation charge (% of the price)" error={e.lateCancelChargePercent}>
              <TextInput inputMode="numeric" value={f.values.lateCancelChargePercent} onChange={(x) => f.set("lateCancelChargePercent", x.target.value)} />
            </FormField>
          </SetupGrid>
        </SetupCard>
        <SetupCard title="Bank details on invoices">
          <div className="flex flex-col gap-3">
            <SetupGrid>
              <FormField id="bs-bank-name" label="Name on the account" error={e.bankAccountName}>
                <TextInput value={f.values.bankAccountName} onChange={(x) => f.set("bankAccountName", x.target.value)} data-testid="billing-bank-name" />
              </FormField>
              <FormField id="bs-bank-sort" label="Sort code" hint="NN-NN-NN" error={e.bankSortCode}>
                <TextInput inputMode="numeric" value={f.values.bankSortCode} onChange={(x) => f.set("bankSortCode", x.target.value)} data-testid="billing-bank-sort" />
              </FormField>
              <FormField id="bs-bank-account" label="Account number" hint="8 digits" error={e.bankAccountNumber}>
                <TextInput inputMode="numeric" value={f.values.bankAccountNumber} onChange={(x) => f.set("bankAccountNumber", x.target.value)} data-testid="billing-bank-account" />
              </FormField>
            </SetupGrid>
            <FormField id="bs-instructions" label="Other payment instructions (optional)" error={e.paymentInstructions}>
              <TextArea rows={2} value={f.values.paymentInstructions} onChange={(x) => f.set("paymentInstructions", x.target.value)} />
            </FormField>
          </div>
        </SetupCard>
        <SetupError error={f.error} />
        <SetupFormBar dirty={f.dirty} saving={f.saving} onDiscard={f.discard} testId="billing-save" />
      </form>
    </SetupPage>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Report targets
 * ----------------------------------------------------------------------------------------------*/

export function TargetsSetup({ settings }: { settings: ReportTargets }) {
  const f = useSetupForm({ utilisationTarget: String(settings.utilisationTargetPercent), dnaTarget: (settings.dnaTargetTenths / 10).toFixed(1) });
  return (
    <SetupPage>
      <SetupHeader title="Report targets" description="What the dashboard and reports compare against." />
      <SetupCard>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void f.submit(() => saveTargetsAction({ rev: settings.rev, ...f.values }), "Targets saved.");
          }}
        >
          <SetupGrid>
            <FormField id="t-util" label="Utilisation target (%)" hint="Booked time against available time; bars at or above it are darker" error={f.fieldErrors.utilisationTarget}>
              <TextInput inputMode="numeric" value={f.values.utilisationTarget} onChange={(e) => f.set("utilisationTarget", e.target.value)} data-testid="target-utilisation" />
            </FormField>
            <FormField id="t-dna" label="Did-not-attend target (% – stay under)" hint="One decimal place, e.g. 4.0" error={f.fieldErrors.dnaTarget}>
              <TextInput inputMode="decimal" value={f.values.dnaTarget} onChange={(e) => f.set("dnaTarget", e.target.value)} data-testid="target-dna" />
            </FormField>
          </SetupGrid>
          <SetupError error={f.error} />
          <SetupFormBar dirty={f.dirty} saving={f.saving} onDiscard={f.discard} testId="targets-save" />
        </form>
      </SetupCard>
    </SetupPage>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Import data (M9)
 * ----------------------------------------------------------------------------------------------*/

