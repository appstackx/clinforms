"use client";
/**
 * Set-up forms (client) for appointment types, prices, practitioners, referrers and payers, record keeping and
 * staff access. Server actions come in as props; options are built by the server pages.
 */
import { useFormState } from "react-dom";
import { CopyButton, SubmitButton } from "@/components/account/form-controls";
import { Notice } from "@/components/account/shell";
import { PAYER_TYPES, PROFESSIONS, REFERRER_KINDS, SERVICE_CATEGORIES } from "@/modules/pms/core/schemas";
import { PAYER_TYPE_LABELS, PROFESSION_LABELS, REFERRER_KIND_LABELS, SERVICE_CATEGORY_LABELS } from "@/modules/pms/reporting/copy";
import type { FormResult } from "@/modules/pms/reporting/forms";
import { ActionForm, Checkbox, CheckboxGroup, SelectInput, TextArea, TextInput, type FormAction, type Option } from "./form-kit";

const opts = <T extends string>(values: readonly T[], labels: Readonly<Record<T, string>>): Option[] => values.map((v) => ({ value: v, label: labels[v] }));

/* ------------------------------------------------------------------------------------------------
 * Appointment types
 * ----------------------------------------------------------------------------------------------*/

export interface ServiceValues {
  id?: string;
  name: string;
  code: string;
  category: string;
  durationMinutes: number;
  bufferMinutes: number;
  price: string;
  colour: string;
  onlineBookable: boolean;
  active: boolean;
  sortOrder: number;
}

export function ServiceForm({ action, values, submitLabel }: { action: FormAction; values?: ServiceValues; submitLabel: string }) {
  return (
    <ActionForm action={action} submitLabel={submitLabel} resetOnSuccess={!values} hidden={values?.id ? { serviceId: values.id } : undefined}>
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <TextInput name="name" label="Name" defaultValue={values?.name} required maxLength={120} placeholder="e.g. Follow-up appointment" />
        <TextInput name="code" label="Code" defaultValue={values?.code} maxLength={20} hint="Optional, e.g. FU30." />
        <SelectInput name="category" label="Kind" options={opts(SERVICE_CATEGORIES, SERVICE_CATEGORY_LABELS)} defaultValue={values?.category ?? "treatment"} />
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <TextInput name="durationMinutes" label="Length (minutes)" type="number" inputMode="numeric" defaultValue={values?.durationMinutes ?? 30} min={5} max={480} step={5} required />
        <TextInput name="bufferMinutes" label="Gap after (minutes)" type="number" inputMode="numeric" defaultValue={values?.bufferMinutes ?? 0} min={0} max={120} step={5} hint="Notes or cleaning time." />
        <TextInput name="price" label="Standard price (£)" inputMode="decimal" defaultValue={values?.price} maxLength={12} hint="Empty if priced by the price lists only." errorKey="defaultPricePence" />
        <TextInput name="colour" label="Diary colour" defaultValue={values?.colour} maxLength={7} placeholder="#0D9488" hint="Optional, #RRGGBB." />
      </div>
      <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
        <TextInput name="sortOrder" label="Order in lists" type="number" inputMode="numeric" defaultValue={values?.sortOrder ?? 0} min={0} step={1} />
        <Checkbox name="onlineBookable" label="Patients can book it online" defaultChecked={values?.onlineBookable ?? false} />
        {values ? <Checkbox name="active" label="Can be booked" defaultChecked={values.active} /> : null}
      </div>
    </ActionForm>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Price lists
 * ----------------------------------------------------------------------------------------------*/

export interface PriceListValues {
  id?: string;
  name: string;
  payerType: string;
  referrerId: string;
  isDefault: boolean;
  validFrom: string;
  validTo: string;
  active: boolean;
}

export function PriceListForm({ action, values, payers, submitLabel }: { action: FormAction; values?: PriceListValues; payers: Option[]; submitLabel: string }) {
  return (
    <ActionForm action={action} submitLabel={submitLabel} resetOnSuccess={!values} hidden={values?.id ? { priceListId: values.id } : undefined}>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextInput name="name" label="Name" defaultValue={values?.name} required maxLength={120} placeholder="e.g. Self-pay 2027" />
        <SelectInput name="payerType" label="For" options={[{ value: "", label: "Any payer" }, ...opts(PAYER_TYPES, PAYER_TYPE_LABELS)]} defaultValue={values?.payerType ?? ""} />
        <SelectInput name="referrerId" label="One payer's own list" options={[{ value: "", label: "No – a general list" }, ...payers]} defaultValue={values?.referrerId ?? ""} hint="An insurer's or medico-legal company's agreed prices." />
      </div>
      <div className="grid gap-4 sm:grid-cols-3 sm:items-end">
        <TextInput name="validFrom" label="Valid from" type="date" defaultValue={values?.validFrom} />
        <TextInput name="validTo" label="Valid to" type="date" defaultValue={values?.validTo} />
        <div className="space-y-2">
          <Checkbox name="isDefault" label="The default list" defaultChecked={values?.isDefault ?? false} hint="Used when a case has no list of its own." />
          {values ? <Checkbox name="active" label="In use" defaultChecked={values.active} /> : null}
        </div>
      </div>
    </ActionForm>
  );
}

export function PriceItemForm({ action, priceListId, services, serviceId, price, billingCode, submitLabel }: { action: FormAction; priceListId: string; services?: Option[]; serviceId?: string; price?: string; billingCode?: string; submitLabel: string }) {
  return (
    <ActionForm action={action} submitLabel={submitLabel} resetOnSuccess={!serviceId} hidden={serviceId ? { priceListId, serviceId } : { priceListId }} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {services ? <SelectInput name="serviceId" label="Appointment type" options={services} /> : null}
        <TextInput name="price" label="Price (£)" inputMode="decimal" defaultValue={price} required maxLength={12} errorKey="pricePence" />
        <TextInput name="billingCode" label="Payer's billing code" defaultValue={billingCode} maxLength={20} hint="Optional." />
      </div>
    </ActionForm>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Practitioners
 * ----------------------------------------------------------------------------------------------*/

export interface PractitionerValues {
  id?: string;
  displayName: string;
  profession: string;
  registrationNumber: string;
  email: string;
  phone: string;
  colour: string;
  defaultSiteId: string;
  userId: string;
  bookable: boolean;
  onlineBookable: boolean;
  active: boolean;
  sortOrder: number;
}

export function PractitionerForm({ action, values, sites, members, submitLabel }: { action: FormAction; values?: PractitionerValues; sites: Option[]; members: Option[]; submitLabel: string }) {
  return (
    <ActionForm action={action} submitLabel={submitLabel} resetOnSuccess={!values} hidden={values?.id ? { practitionerId: values.id } : undefined}>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextInput name="displayName" label="Name in the diary" defaultValue={values?.displayName} required maxLength={120} />
        <SelectInput name="profession" label="Profession" options={opts(PROFESSIONS, PROFESSION_LABELS)} defaultValue={values?.profession ?? "physiotherapist"} />
        <TextInput name="registrationNumber" label="Registration number" defaultValue={values?.registrationNumber} maxLength={20} hint="As on the professional register." />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextInput name="email" label="Email" type="email" inputMode="email" defaultValue={values?.email} maxLength={254} />
        <TextInput name="phone" label="Phone" type="tel" inputMode="tel" defaultValue={values?.phone} maxLength={24} />
        <TextInput name="colour" label="Diary colour" defaultValue={values?.colour} maxLength={7} placeholder="#0D9488" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectInput name="defaultSiteId" label="Home site" options={[{ value: "", label: "None" }, ...sites]} defaultValue={values?.defaultSiteId ?? ""} />
        <SelectInput name="userId" label="Signs in as" options={[{ value: "", label: "Does not sign in" }, ...members]} defaultValue={values?.userId ?? ""} hint="Links the diary column to a member's account." />
        <TextInput name="sortOrder" label="Order in the diary" type="number" inputMode="numeric" defaultValue={values?.sortOrder ?? 0} min={0} step={1} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Checkbox name="bookable" label="Has a diary column" defaultChecked={values?.bookable ?? true} />
        <Checkbox name="onlineBookable" label="Bookable online" defaultChecked={values?.onlineBookable ?? false} />
        {values ? <Checkbox name="active" label="Works here now" defaultChecked={values.active} /> : null}
      </div>
    </ActionForm>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Referrers and payers
 * ----------------------------------------------------------------------------------------------*/

export interface ReferrerValues {
  id?: string;
  rev?: number;
  kind: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  postcode: string;
  notes: string;
  active: boolean;
}

export function ReferrerForm({ action, values, submitLabel }: { action: FormAction; values?: ReferrerValues; submitLabel: string }) {
  return (
    <ActionForm action={action} submitLabel={submitLabel} resetOnSuccess={!values} hidden={values?.id ? { referrerId: values.id, rev: values.rev ?? 1 } : undefined}>
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <SelectInput name="kind" label="Kind" options={opts(REFERRER_KINDS, REFERRER_KIND_LABELS)} defaultValue={values?.kind ?? "gp"} />
        <TextInput name="name" label="Name" defaultValue={values?.name} required maxLength={160} hint="The organisation or the person, e.g. a GP surgery or an insurer." />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextInput name="contactName" label="Contact" defaultValue={values?.contactName} maxLength={120} />
        <TextInput name="email" label="Email" type="email" inputMode="email" defaultValue={values?.email} maxLength={254} />
        <TextInput name="phone" label="Phone" type="tel" inputMode="tel" defaultValue={values?.phone} maxLength={24} />
      </div>
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <TextArea name="address" label="Address" defaultValue={values?.address} rows={3} hint="One line per row, without the postcode." />
        <TextInput name="postcode" label="Postcode" defaultValue={values?.postcode} maxLength={10} />
      </div>
      <TextArea name="notes" label="Notes" defaultValue={values?.notes} rows={3} maxLength={4000} hint="For staff: invoicing addresses, claims process. Stored encrypted." />
      {values ? <Checkbox name="active" label="In use" defaultChecked={values.active} /> : null}
    </ActionForm>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Record keeping
 * ----------------------------------------------------------------------------------------------*/

export function RetentionForm({ action, adultYears, childUntilAge, editable }: { action: FormAction; adultYears: number; childUntilAge: number; editable: boolean }) {
  return (
    <ActionForm action={action} submitLabel="Save record keeping">
      <fieldset disabled={!editable} className="grid gap-4 sm:grid-cols-2">
        <TextInput name="retentionAdultYears" label="Adults: keep for (years after the last treatment)" type="number" inputMode="numeric" defaultValue={adultYears} min={8} max={100} step={1} hint="At least 8 years." />
        <TextInput name="retentionChildUntilAge" label="Children: keep until at least this birthday" type="number" inputMode="numeric" defaultValue={childUntilAge} min={25} max={40} step={1} hint="At least the 25th (26th if 17 at the last treatment)." />
      </fieldset>
    </ActionForm>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Staff
 * ----------------------------------------------------------------------------------------------*/

export function SiteAccessForm({ action, userId, rev, allSites, siteIds, sites }: { action: FormAction; userId: string; rev: number; allSites: boolean; siteIds: string[]; sites: Option[] }) {
  return (
    <ActionForm action={action} submitLabel="Save site access" hidden={{ userId, rev }} className="space-y-3">
      <Checkbox name="allSites" label="Works at every site" defaultChecked={allSites} hint="Including sites added later. Untick to choose sites below." />
      <CheckboxGroup name="siteIds" legend="Or only at these sites" options={sites} checked={siteIds} errorKey="siteIds" />
    </ActionForm>
  );
}

export function RoleForm({ action, memberId, current, roles }: { action: FormAction; memberId: string; current: string; roles: Option[] }) {
  return (
    <ActionForm action={action} submitLabel="Change role" hidden={{ memberId }} className="space-y-3">
      <SelectInput name="role" label="Role" options={roles} defaultValue={current} />
    </ActionForm>
  );
}

export function PractitionerLinkForm({ action, userId, practitionerId, practitioners }: { action: FormAction; userId: string; practitionerId: string; practitioners: Option[] }) {
  return (
    <ActionForm action={action} submitLabel="Save diary link" hidden={{ userId }} className="space-y-3">
      <SelectInput name="practitionerId" label="Their diary column" options={[{ value: "", label: "None (not a practitioner)" }, ...practitioners]} defaultValue={practitionerId} hint="Links the member to a practitioner, so their own day and notes are theirs." />
    </ActionForm>
  );
}

export type InviteResult = FormResult & { link?: string | null; email?: string };

/** Invite a member (the clinic's own invitation – the link is shown when email is not set up). */
export function InviteForm({ action, roles }: { action: (prev: InviteResult | null, form: FormData) => Promise<InviteResult>; roles: Option[] }) {
  const [state, run] = useFormState(action, null as InviteResult | null);
  return (
    <form action={run} className="space-y-4" noValidate>
      {state?.ok === false ? <Notice tone="error">{state.error}</Notice> : null}
      {state?.ok === true ? (
        <div className="space-y-2">
          <Notice tone="success">{state.message ?? "Invitation created."}</Notice>
          {state.link ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <span className="min-w-0 break-all font-mono">{state.link}</span>
              <CopyButton value={state.link} label="Copy link" />
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <div className="space-y-1.5">
          <label htmlFor="invite-email" className="block text-sm font-medium text-slate-800">
            Email
          </label>
          <input id="invite-email" name="email" type="email" inputMode="email" autoComplete="off" maxLength={254} required className="block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="invite-role" className="block text-sm font-medium text-slate-800">
            Role
          </label>
          <select id="invite-role" name="role" defaultValue={roles.find((r) => r.value === "staff")?.value ?? roles[0]?.value} className="block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30">
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <SubmitButton pendingText="Inviting…">Invite</SubmitButton>
    </form>
  );
}
