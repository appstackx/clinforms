"use client";
/** Set-up → Sites and rooms: the forms (client). Server actions come in as props. */
import { MAX_SESSIONS_PER_DAY } from "@/modules/pms/reporting/schemas";
import { WEEKDAY_NAMES } from "@/modules/pms/reporting/copy";
import { ActionForm, Checkbox, SelectInput, TextArea, TextInput, type FormAction } from "./form-kit";

export interface SiteValues {
  id?: string;
  name: string;
  code: string;
  address: string;
  postcode: string;
  phone: string;
  email: string;
  sortOrder: number;
  active: boolean;
}

export function SiteForm({ action, values, submitLabel }: { action: FormAction; values?: SiteValues; submitLabel: string }) {
  return (
    <ActionForm action={action} submitLabel={submitLabel} resetOnSuccess={!values} hidden={values?.id ? { siteId: values.id } : undefined}>
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <TextInput name="name" label="Site name" defaultValue={values?.name} required maxLength={120} hint="As staff and patients know it, e.g. “Bletchley”." />
        <TextInput name="code" label="Short code" defaultValue={values?.code} maxLength={8} hint="1–8 letters or digits, shown in the diary." />
      </div>
      <TextArea name="address" label="Address" defaultValue={values?.address} rows={3} hint="One line per row, without the postcode." />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextInput name="postcode" label="Postcode" defaultValue={values?.postcode} maxLength={10} autoComplete="postal-code" />
        <TextInput name="phone" label="Phone" type="tel" inputMode="tel" defaultValue={values?.phone} maxLength={24} />
        <TextInput name="email" label="Email" type="email" inputMode="email" defaultValue={values?.email} maxLength={254} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3 sm:items-end">
        <TextInput name="sortOrder" label="Order in lists" type="number" inputMode="numeric" defaultValue={values?.sortOrder ?? 0} min={0} step={1} />
        {values ? (
          <div className="sm:col-span-2">
            <Checkbox name="active" label="Open for bookings" defaultChecked={values.active} hint="Switched off, the site disappears from new bookings; its history stays." />
          </div>
        ) : null}
      </div>
    </ActionForm>
  );
}

export interface RoomValues {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

export function RoomAddForm({ action, siteId }: { action: FormAction; siteId: string }) {
  return (
    <ActionForm action={action} submitLabel="Add room" pendingLabel="Adding…" resetOnSuccess hidden={{ siteId }} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <TextInput name="name" label="New room" required maxLength={80} placeholder="e.g. Treatment room 3" />
        <TextInput name="sortOrder" label="Order" type="number" inputMode="numeric" defaultValue={0} min={0} step={1} />
      </div>
    </ActionForm>
  );
}

export function RoomEditForm({ action, room }: { action: FormAction; room: RoomValues }) {
  return (
    <ActionForm action={action} submitLabel="Save room" hidden={{ roomId: room.id }} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <TextInput name="name" label="Room name" defaultValue={room.name} required maxLength={80} />
        <TextInput name="sortOrder" label="Order" type="number" inputMode="numeric" defaultValue={room.sortOrder} min={0} step={1} />
      </div>
      <Checkbox name="active" label="In use" defaultChecked={room.active} />
    </ActionForm>
  );
}

export interface SessionValue {
  weekday: number;
  opensAt: string;
  closesAt: string;
}

function TimeCell({ name, label, value }: { name: string; label: string; value: string }) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <input
        type="time"
        name={name}
        step={300}
        defaultValue={value}
        aria-label={label}
        className="block h-9 w-full min-w-[6.5rem] rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 shadow-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
      />
    </label>
  );
}

/** A site's week: up to three sessions a day (leave a pair empty for none). */
export function OpeningHoursForm({ action, siteId, sessions }: { action: FormAction; siteId: string; sessions: SessionValue[] }) {
  const byDay = (day: number) => sessions.filter((s) => s.weekday === day).sort((a, b) => a.opensAt.localeCompare(b.opensAt));
  return (
    <ActionForm action={action} submitLabel="Save opening hours" hidden={{ siteId }} className="space-y-3">
      <p className="text-sm text-slate-600">UK time. Leave a day empty when the site is closed. Up to {MAX_SESSIONS_PER_DAY} sessions a day, for example a morning and an evening.</p>
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <caption className="sr-only">Opening hours by day</caption>
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
              <th scope="col" className="py-2 pr-3">
                Day
              </th>
              {Array.from({ length: MAX_SESSIONS_PER_DAY }, (_, i) => (
                <th key={i} scope="col" className="px-2 py-2" colSpan={2}>
                  Session {i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4, 5, 6, 7].map((day) => {
              const list = byDay(day);
              return (
                <tr key={day} className="border-b border-slate-100 last:border-0">
                  <th scope="row" className="py-2 pr-3 text-left font-medium text-slate-900">
                    {WEEKDAY_NAMES[day]}
                  </th>
                  {Array.from({ length: MAX_SESSIONS_PER_DAY }, (_, i) => (
                    <SessionCells key={i} day={day} n={i + 1} value={list[i]} />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </ActionForm>
  );
}

function SessionCells({ day, n, value }: { day: number; n: number; value?: SessionValue }) {
  const label = `${WEEKDAY_NAMES[day]}, session ${n}`;
  return (
    <>
      <td className="px-1 py-1.5">
        <TimeCell name={`d${day}_${n}_opens`} label={`${label}: opens`} value={value?.opensAt ?? ""} />
      </td>
      <td className="px-1 py-1.5">
        <TimeCell name={`d${day}_${n}_closes`} label={`${label}: closes`} value={value?.closesAt ?? ""} />
      </td>
    </>
  );
}

export function ClosureAddForm({ action, siteOptions, fixedSiteId }: { action: FormAction; siteOptions?: { value: string; label: string }[]; fixedSiteId?: string | null }) {
  return (
    <ActionForm action={action} submitLabel="Add closure" pendingLabel="Adding…" resetOnSuccess hidden={fixedSiteId !== undefined ? { siteId: fixedSiteId ?? "" } : undefined} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-start">
        {siteOptions ? <SelectInput name="siteId" label="Where" options={siteOptions} defaultValue="" /> : null}
        <TextInput name="startsOn" label="From" type="date" required />
        <TextInput name="endsOn" label="To (if longer)" type="date" hint="Empty for one day." />
        <TextInput name="reason" label="Reason" maxLength={120} placeholder="e.g. Bank holiday" hint="Shown to staff. No patient details." />
      </div>
    </ActionForm>
  );
}

/** A small button form (remove a closure) with a confirmation. */
export function RemoveButton({ action, hidden, label, confirmText }: { action: FormAction; hidden: Record<string, string>; label: string; confirmText: string }) {
  return <ActionForm action={action} submitLabel={label} pendingLabel="Removing…" hidden={hidden} compact variant="danger" confirmText={confirmText} />;
}
