"use client";
/**
 * Set-up → Sites and opening hours (design round 2c, Setup.dc.html "Sites and opening hours"): the site list with
 * room counts, the chosen site's details and opening hours (one form, "Discard changes" / "Save"), its closures
 * (Add closure – this site or every site; Remove), and Add site (new sites start with the default hours).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Checkbox, FormField, PmsButton, SelectInput, Switch, TextInput, useToast } from "@/components/pms/ui";
import { formatUkDate } from "@/modules/pms/core/text";
import { WEEKDAY_NAMES } from "@/modules/pms/reporting/copy";
import type { DayHours, SitesScreen } from "@/modules/pms/reporting/setup-view";
import { addClosureAction, createSiteAction, removeClosureAction, saveOpeningHoursAction, updateSiteAction } from "@/app/app/clinic/setup/actions";
import { SetupCard, SetupError, SetupFormBar, SetupGrid, SetupHeader, SetupList, SetupPage, SetupSplit, useSetupForm } from "./setup-kit";

const PATH = "/app/clinic/setup/sites";

export function SitesSetup({ screen }: { screen: SitesScreen }) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(screen.sites.length === 0);
  const active = screen.sites.filter((s) => s.active).length;
  return (
    <SetupPage>
      <SetupHeader
        title="Sites and opening hours"
        description={`${active} ${active === 1 ? "site" : "sites"} · the diary only shows times inside opening hours.`}
        action={
          screen.canAddSite ? (
            <PmsButton onClick={() => setAdding(true)} data-testid="add-site">
              Add site
            </PmsButton>
          ) : null
        }
      />
      {adding ? <AddSite onDone={(id) => (setAdding(false), id ? router.push(`${PATH}?site=${id}`) : undefined)} onCancel={() => setAdding(false)} /> : null}
      <SetupSplit
        list={
          <SetupList
            label="Sites"
            testId="site-row"
            empty="No sites yet."
            items={screen.sites.map((s) => ({
              id: s.id,
              label: s.active ? s.name : `${s.name} (switched off)`,
              meta: `${s.rooms} ${s.rooms === 1 ? "room" : "rooms"}`,
              href: `${PATH}?site=${s.id}`,
              active: screen.selected?.site.id === s.id,
              muted: !s.active,
            }))}
          />
        }
      >
        {screen.selected ? <SiteDetail key={screen.selected.site.id} selected={screen.selected} canAllSites={screen.canAddSite} /> : <p className="text-sm text-[#475569]">Add the clinic&apos;s first site.</p>}
      </SetupSplit>
    </SetupPage>
  );
}

function AddSite({ onDone, onCancel }: { onDone: (id: string | undefined) => void; onCancel: () => void }) {
  const f = useSetupForm({ name: "", phone: "", address: "", postcode: "" });
  return (
    <SetupCard title="Add a site">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void f.submit(() => createSiteAction(f.values), `${f.values.name} added with the usual opening hours.`, onDone);
        }}
      >
        <SetupGrid>
          <FormField id="new-site-name" label="Site name" required error={f.fieldErrors.name}>
            <TextInput value={f.values.name} onChange={(e) => f.set("name", e.target.value)} data-testid="new-site-name" />
          </FormField>
          <FormField id="new-site-phone" label="Phone" error={f.fieldErrors.phone}>
            <TextInput type="tel" value={f.values.phone} onChange={(e) => f.set("phone", e.target.value)} />
          </FormField>
          <FormField id="new-site-address" label="Address" hint="Lines separated by commas" error={f.fieldErrors.address}>
            <TextInput value={f.values.address} onChange={(e) => f.set("address", e.target.value)} />
          </FormField>
          <FormField id="new-site-postcode" label="Postcode" error={f.fieldErrors.postcode}>
            <TextInput value={f.values.postcode} onChange={(e) => f.set("postcode", e.target.value)} data-testid="new-site-postcode" />
          </FormField>
        </SetupGrid>
        <p className="text-xs text-[#475569]">New sites open Monday to Friday 08:00–20:00 and Saturday 09:00–13:00 – change them after adding.</p>
        <SetupError error={f.error} />
        <div className="flex justify-end gap-2">
          <PmsButton type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </PmsButton>
          <PmsButton type="submit" loading={f.saving} disabled={!f.values.name.trim()} data-testid="new-site-save">
            Add site
          </PmsButton>
        </div>
      </form>
    </SetupCard>
  );
}

function SiteDetail({ selected, canAllSites }: { selected: NonNullable<SitesScreen["selected"]>; canAllSites: boolean }) {
  const { site } = selected;
  const f = useSetupForm({
    name: site.name,
    phone: site.phone ?? "",
    address: (site.address ?? []).join(", "),
    postcode: site.postcode ?? "",
    active: site.active,
    days: selected.days,
  });
  const disabled = !selected.canEdit;
  const setDay = (weekday: number, patch: Partial<DayHours>) => f.set("days", f.values.days.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)));
  const detailsChanged = JSON.stringify([f.values.name, f.values.phone, f.values.address, f.values.postcode, f.values.active]) !== JSON.stringify([site.name, site.phone ?? "", (site.address ?? []).join(", "), site.postcode ?? "", site.active]);
  const hoursChanged = JSON.stringify(f.values.days) !== JSON.stringify(selected.days);

  async function save() {
    let ok = true;
    if (detailsChanged) {
      ok = await f.submit(() => updateSiteAction(site.id, { name: f.values.name, phone: f.values.phone, address: f.values.address, postcode: f.values.postcode, active: f.values.active }), "Site saved.");
    }
    if (ok && hoursChanged) await f.submit(() => saveOpeningHoursAction(site.id, f.values.days), "Opening hours saved.");
  }

  return (
    <>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        aria-label={`${site.name}: details and opening hours`}
      >
        <SetupCard>
          <SetupGrid>
            <FormField id="site-name" label="Site name" required error={f.fieldErrors.name}>
              <TextInput value={f.values.name} disabled={disabled} onChange={(e) => f.set("name", e.target.value)} />
            </FormField>
            <FormField id="site-phone" label="Phone" error={f.fieldErrors.phone}>
              <TextInput type="tel" value={f.values.phone} disabled={disabled} onChange={(e) => f.set("phone", e.target.value)} />
            </FormField>
            <FormField id="site-address" label="Address" className="col-span-full" hint="Lines separated by commas" error={f.fieldErrors.address}>
              <TextInput value={f.values.address} disabled={disabled} onChange={(e) => f.set("address", e.target.value)} />
            </FormField>
            <FormField id="site-postcode" label="Postcode" error={f.fieldErrors.postcode}>
              <TextInput value={f.values.postcode} disabled={disabled} onChange={(e) => f.set("postcode", e.target.value)} />
            </FormField>
            <div className="flex items-end pb-2">
              <Switch id="site-active" checked={f.values.active} disabled={disabled} onCheckedChange={(v) => f.set("active", v)} label={f.values.active ? "In use" : "Switched off"} />
            </div>
          </SetupGrid>
        </SetupCard>
        <SetupCard title="Opening hours" padded={false}>
          {!selected.hoursSet ? <p className="border-b border-[#F1F5F9] px-5 py-2 text-xs text-[#475569]">No opening hours saved yet – the diary is not limited until you save them.</p> : null}
          <ul data-testid="opening-hours">
            {f.values.days.map((d) => {
              const day = WEEKDAY_NAMES[d.weekday];
              return (
                <li key={d.weekday} className="flex flex-wrap items-center gap-3 border-b border-[#F1F5F9] px-5 py-2" data-testid={`hours-${d.weekday}`}>
                  <span className="w-[100px] font-medium">{day}</span>
                  {d.open ? (
                    <span className="flex items-center gap-2">
                      <TextInput
                        type="time"
                        step={300}
                        className="h-8 w-[104px] tabular-nums"
                        aria-label={`${day} opens`}
                        value={d.from}
                        disabled={disabled}
                        onChange={(e) => setDay(d.weekday, { from: e.target.value })}
                        data-testid={`hours-${d.weekday}-from`}
                      />
                      <span aria-hidden>–</span>
                      <TextInput
                        type="time"
                        step={300}
                        className="h-8 w-[104px] tabular-nums"
                        aria-label={`${day} closes`}
                        value={d.to}
                        disabled={disabled}
                        onChange={(e) => setDay(d.weekday, { to: e.target.value })}
                        data-testid={`hours-${d.weekday}-to`}
                      />
                    </span>
                  ) : (
                    <span className="text-[#64748B]">Closed</span>
                  )}
                  <Checkbox className="ml-auto" label="Closed" checked={!d.open} disabled={disabled} onChange={(e) => setDay(d.weekday, { open: !e.target.checked })} data-testid={`hours-${d.weekday}-closed`} />
                  {f.fieldErrors[`hours-${d.weekday}`] ? (
                    <span role="alert" className="w-full text-xs text-destructive-strong">
                      {f.fieldErrors[`hours-${d.weekday}`]}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </SetupCard>
        <SetupError error={f.error} />
        {disabled ? <p className="text-sm text-[#475569]">You can see this site but not change it.</p> : <SetupFormBar dirty={f.dirty} saving={f.saving} onDiscard={f.discard} testId="site-save" />}
      </form>
      <Closures selected={selected} canAllSites={canAllSites} />
    </>
  );
}

function Closures({ selected, canAllSites }: { selected: NonNullable<SitesScreen["selected"]>; canAllSites: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const f = useSetupForm({ startsOn: "", endsOn: "", reason: "", everySite: false });
  const canAdd = selected.canEdit;
  async function remove(id: string) {
    setBusy(id);
    const r = await removeClosureAction(id);
    setBusy(null);
    if (!r.ok) toast.error(r.error);
    else {
      toast.success("Closure removed.");
      router.refresh();
    }
  }
  return (
    <SetupCard
      title="Closures"
      action={
        canAdd ? (
          <PmsButton variant="secondary" size="sm" className="h-8" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="add-closure">
            Add closure
          </PmsButton>
        ) : null
      }
    >
      {open ? (
        <form
          className="mb-3 flex flex-col gap-3 rounded-xl border border-border bg-[#F8FAFC] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void f.submit(
              () => addClosureAction({ siteId: f.values.everySite ? null : selected.site.id, startsOn: f.values.startsOn, endsOn: f.values.endsOn, reason: f.values.reason }),
              "Closure added – the diary and online booking are closed then.",
              () => setOpen(false),
            );
          }}
        >
          <SetupGrid>
            <FormField id="closure-from" label="From" required error={f.fieldErrors.startsOn}>
              <TextInput type="date" value={f.values.startsOn} onChange={(e) => f.set("startsOn", e.target.value)} data-testid="closure-from" />
            </FormField>
            <FormField id="closure-to" label="To (optional)" error={f.fieldErrors.endsOn}>
              <TextInput type="date" value={f.values.endsOn} onChange={(e) => f.set("endsOn", e.target.value)} data-testid="closure-to" />
            </FormField>
            <FormField id="closure-reason" label="Reason" hint="Shown to staff, e.g. Bank holiday" error={f.fieldErrors.reason}>
              <TextInput value={f.values.reason} maxLength={120} onChange={(e) => f.set("reason", e.target.value)} data-testid="closure-reason" />
            </FormField>
          </SetupGrid>
          {canAllSites ? <Checkbox label="Every site" checked={f.values.everySite} onChange={(e) => f.set("everySite", e.target.checked)} data-testid="closure-every-site" /> : null}
          <SetupError error={f.error} />
          <div className="flex justify-end gap-2">
            <PmsButton type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </PmsButton>
            <PmsButton type="submit" loading={f.saving} disabled={!f.values.startsOn} data-testid="closure-save">
              Add closure
            </PmsButton>
          </div>
        </form>
      ) : null}
      {selected.closures.length === 0 ? <p className="text-sm text-[#475569]">No closures coming up.</p> : null}
      <ul data-testid="closures">
        {selected.closures.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 border-t border-[#F1F5F9] py-2 first:border-t-0">
            <span className="w-[200px] tabular-nums">{c.startsOn === c.endsOn ? formatUkDate(c.startsOn) : `${formatUkDate(c.startsOn)} – ${formatUkDate(c.endsOn)}`}</span>
            <span className="min-w-0 flex-1">{c.reason ?? "Closed"}</span>
            <span className="text-[13px] text-[#475569]">{c.siteId === null ? "All sites" : "This site"}</span>
            {canAdd && (c.siteId !== null || canAllSites) ? (
              <PmsButton variant="ghost" size="sm" loading={busy === c.id} onClick={() => void remove(c.id)} aria-label={`Remove closure ${c.reason ?? c.startsOn}`}>
                Remove
              </PmsButton>
            ) : null}
          </li>
        ))}
      </ul>
    </SetupCard>
  );
}

/** A plain select of sites (rooms page, closures), exported for reuse. */
export function SiteSelect({ id, value, onChange, sites, label = "Site", testId }: { id: string; value: string; onChange: (v: string) => void; sites: { id: string; name: string }[]; label?: string; testId?: string }) {
  return (
    <FormField id={id} label={label}>
      <SelectInput value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </SelectInput>
    </FormField>
  );
}
