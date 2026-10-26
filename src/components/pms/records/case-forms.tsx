"use client";
/** Open or edit a case (episode of care with its payer), and add or change a treatment authorisation. */
import { useState } from "react";
import { CASE_STATUS_LABELS, PAYER_KINDS, PAYER_TYPE_LABELS } from "@/modules/pms/records/copy";
import type { PayerType } from "@/modules/pms/core/types";
import { ActionForm, Fieldset, SelectField, Submit, TextAreaField, TextField, type Option, type RecordsAction } from "./form";

export interface DirectoryOptions {
  practitioners: Option[];
  sites: Option[];
  priceLists: Option[];
  /** Every referrer and payer account, with its kind. */
  referrers: (Option & { kind: string })[];
}

export interface CaseFormValues {
  caseId?: string;
  rev?: number;
  title?: string;
  status?: string;
  openedOn?: string;
  closedOn?: string | null;
  practitionerId?: string | null;
  siteId?: string | null;
  payerType?: PayerType;
  payerReferrerId?: string | null;
  membershipNumber?: string | null;
  claimReference?: string | null;
  excess?: string;
  priceListId?: string | null;
  referrerId?: string | null;
  referralReceivedOn?: string | null;
  injuryOn?: string | null;
  referralReason?: string | null;
  notes?: string | null;
}

const PAYER_OPTIONS: Option[] = (Object.keys(PAYER_TYPE_LABELS) as PayerType[]).map((p) => ({ value: p, label: PAYER_TYPE_LABELS[p] }));
const STATUS_OPTIONS: Option[] = Object.entries(CASE_STATUS_LABELS).map(([value, label]) => ({ value, label }));

export function CaseForm({ action, patientId, values = {}, options, submitLabel }: { action: RecordsAction; patientId: string; values?: CaseFormValues; options: DirectoryOptions; submitLabel: string }) {
  const [payerType, setPayerType] = useState<PayerType>(values.payerType ?? "self_pay");
  const payerChoices = options.referrers.filter((r) => (PAYER_KINDS[payerType] as readonly string[]).includes(r.kind));
  const editing = Boolean(values.caseId);
  return (
    <ActionForm action={action} successMessage="The case is saved.">
      <input type="hidden" name="patientId" value={patientId} />
      {editing ? (
        <>
          <input type="hidden" name="caseId" value={values.caseId} />
          <input type="hidden" name="expectedRev" value={values.rev} />
        </>
      ) : null}
      <Fieldset legend="The case">
        <TextField label="Title" name="title" defaultValue={values.title} required maxLength={120} hint="A short label for the diary and lists, e.g. “Right knee”. Keep clinical detail for the notes." />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Opened on" name="openedOn" type="date" defaultValue={values.openedOn} required />
          {editing ? <SelectField label="Status" name="status" options={STATUS_OPTIONS} defaultValue={values.status ?? "open"} /> : null}
          {editing ? <TextField label="Closed on" name="closedOn" type="date" defaultValue={values.closedOn} hint="Left empty, closing a case closes it today." /> : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Practitioner" name="practitionerId" options={options.practitioners} defaultValue={values.practitionerId} emptyLabel="Not assigned" />
          <SelectField label="Site" name="siteId" options={options.sites} defaultValue={values.siteId} emptyLabel="Not set" />
        </div>
      </Fieldset>

      <Fieldset legend="Who pays">
        <div className="space-y-1.5">
          <label htmlFor="case-payer-type" className="block text-sm font-medium text-slate-800">
            Payer
          </label>
          <select
            id="case-payer-type"
            name="payerType"
            value={payerType}
            onChange={(e) => setPayerType(e.target.value as PayerType)}
            className="block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30 sm:max-w-xs"
          >
            {PAYER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {payerType !== "self_pay" ? (
          <>
            <SelectField
              key={payerType}
              label="Account"
              name="payerReferrerId"
              options={payerChoices}
              defaultValue={payerChoices.some((c) => c.value === values.payerReferrerId) ? values.payerReferrerId : ""}
              emptyLabel={payerChoices.length ? "Choose…" : "No accounts of this kind yet"}
              hint="Insurers, medico-legal companies, solicitors and employers are set up in the clinic's directory."
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField label="Membership or policy number" name="membershipNumber" defaultValue={values.membershipNumber} maxLength={40} />
              <TextField label="Claim or case reference" name="claimReference" defaultValue={values.claimReference} maxLength={60} />
              <TextField label="Excess the patient pays (£)" name="excess" inputMode="decimal" defaultValue={values.excess} maxLength={12} hint="For example 100.00" />
            </div>
          </>
        ) : (
          <input type="hidden" name="payerReferrerId" value="" />
        )}
        <SelectField label="Price list" name="priceListId" options={options.priceLists} defaultValue={values.priceListId} emptyLabel="The clinic's default prices" />
      </Fieldset>

      <Fieldset legend="Referral">
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField label="Referred by" name="referrerId" options={options.referrers} defaultValue={values.referrerId} emptyLabel="Not recorded" className="sm:col-span-1" />
          <TextField label="Referral received on" name="referralReceivedOn" type="date" defaultValue={values.referralReceivedOn} />
          <TextField label="Date of injury or accident" name="injuryOn" type="date" defaultValue={values.injuryOn} />
        </div>
        <TextAreaField label="Reason for referral" name="referralReason" defaultValue={values.referralReason} rows={3} maxLength={4000} hint="Kept encrypted." />
        <TextAreaField label="Case notes (administrative)" name="notes" defaultValue={values.notes} rows={2} maxLength={8000} hint="Kept encrypted. Clinical notes go in the clinical notes." />
      </Fieldset>
      <Submit>{submitLabel}</Submit>
    </ActionForm>
  );
}

export interface AuthorisationFormValues {
  authorisationId?: string;
  rev?: number;
  code?: string;
  referrerId?: string | null;
  sessionsAuthorised?: number | null;
  valueAuthorised?: string;
  validFrom?: string | null;
  expiresOn?: string | null;
  notes?: string | null;
}

export function AuthorisationForm({
  action,
  patientId,
  caseId,
  values = {},
  issuers,
  submitLabel,
}: {
  action: RecordsAction;
  patientId: string;
  caseId: string;
  values?: AuthorisationFormValues;
  issuers: Option[];
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} successMessage="The authorisation is saved.">
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="caseId" value={caseId} />
      {values.authorisationId ? (
        <>
          <input type="hidden" name="authorisationId" value={values.authorisationId} />
          <input type="hidden" name="expectedRev" value={values.rev} />
        </>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Authorisation code" name="code" defaultValue={values.code} required maxLength={60} />
        <SelectField label="Issued by" name="referrerId" options={issuers} defaultValue={values.referrerId} emptyLabel="Not recorded" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TextField label="Sessions authorised" name="sessionsAuthorised" inputMode="numeric" defaultValue={values.sessionsAuthorised ?? ""} maxLength={3} hint="Empty = no limit" />
        <TextField label="Value authorised (£)" name="valueAuthorised" inputMode="decimal" defaultValue={values.valueAuthorised} maxLength={12} hint="Empty = no limit" />
        <TextField label="Valid from" name="validFrom" type="date" defaultValue={values.validFrom} />
        <TextField label="Expires on" name="expiresOn" type="date" defaultValue={values.expiresOn} />
      </div>
      <TextAreaField label="Notes" name="notes" defaultValue={values.notes} rows={2} maxLength={4000} hint="Kept encrypted." />
      <Submit>{submitLabel}</Submit>
    </ActionForm>
  );
}
