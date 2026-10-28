"use client";
/**
 * New patient (design round 2, "Patients – list, states, new patient"): a side drawer with details, contact and
 * consent, Save / Save and book. Registering asks the server for possible duplicates first: when patients of the
 * clinic may be the same person, nothing is created – they are listed with a link to each record, and the member
 * registers anyway only after ticking "This is a different person".
 *
 * Differences from the design (fields the shared patient record does not hold): no NHS number and no "privacy
 * notice given" tick box; no "Find address" (no paid address service – contract §1.8).
 */
import Link from "next/link";
import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { AlertTriangle } from "lucide-react";
import { formatUkDate } from "@/modules/pms/core/text";
import type { RecordsActionState } from "@/modules/pms/records/types";
import { Checkbox, FormField, PmsButton, SelectInput, SideDrawer, TextInput } from "@/components/pms/ui";
import type { RecordsAction } from "./form";

const TITLES = ["Mr", "Mrs", "Ms", "Miss", "Mx", "Dr"];

function SaveButtons({ onCancel }: { onCancel: () => void }) {
  const { pending } = useFormStatus();
  return (
    <>
      <PmsButton variant="secondary" onClick={onCancel} disabled={pending}>
        Cancel
      </PmsButton>
      <span className="flex-1" />
      <PmsButton type="submit" name="intent" value="save" variant="secondary" loading={pending} loadingText="Saving…">
        Save
      </PmsButton>
      <PmsButton type="submit" name="intent" value="book" loading={pending} loadingText="Saving…">
        Save and book
      </PmsButton>
    </>
  );
}

export function NewPatientForm({ action, initialName, onCancel, formId = "new-patient" }: { action: RecordsAction; initialName?: string; onCancel: () => void; formId?: string }) {
  const [state, formAction] = useFormState(action, null as RecordsActionState);
  const noticeRef = useRef<HTMLDivElement>(null);
  const errors = state && state.ok === false ? (state.fieldErrors ?? {}) : {};
  useEffect(() => {
    if (state && state.ok === false) noticeRef.current?.focus();
  }, [state]);
  const words = (initialName ?? "").trim().split(/\s+/).filter(Boolean);
  const first = words.length > 1 ? words.slice(0, -1).join(" ") : "";
  const last = words.length ? words[words.length - 1] : "";
  const duplicates = state && state.ok === false ? state.duplicates : undefined;
  const legend = "mb-3 text-[13px] font-semibold uppercase tracking-[0.04em] text-[#475569]";
  return (
    <form id={formId} action={formAction} className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
        <div ref={noticeRef} tabIndex={-1} className="outline-none">
          {state && state.ok === false ? (
            <div role="alert" className="flex gap-2.5 rounded-xl border border-[#FBD38D] bg-[#FFFBEB] px-3.5 py-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" aria-hidden />
              <div className="flex min-w-0 flex-col gap-2">
                <strong className="font-semibold">{duplicates?.length ? "Possible duplicate" : "Check the details"}</strong>
                <span className="text-[#334155]">{state.error}</span>
                {duplicates?.length ? (
                  <ul className="flex flex-col gap-1.5">
                    {duplicates.map((d) => (
                      <li key={d.id} className="rounded-lg border border-border bg-white px-3 py-2">
                        <Link href={`/app/clinic/patients/${encodeURIComponent(d.id)}`} className="font-semibold text-primary-strong underline underline-offset-2">
                          {d.name}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          No. {d.patientNumber}
                          {d.dateOfBirth ? ` · born ${formatUkDate(d.dateOfBirth)}` : ""}
                          {d.status !== "active" ? ` · ${d.status}` : ""} · same {d.reasons.join(", ").toLowerCase()}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {duplicates?.length ? <Checkbox name="confirmNotDuplicate" value="on" label="This is a different person – register a new record" /> : null}
              </div>
            </div>
          ) : null}
        </div>

        <fieldset>
          <legend className={legend}>Details</legend>
          <div className="grid grid-cols-2 gap-3">
            <FormField id={`${formId}-title`} label="Title" error={errors.title}>
              <SelectInput name="title" defaultValue="">
                <option value="">–</option>
                {TITLES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </SelectInput>
            </FormField>
            <FormField id={`${formId}-pronouns`} label={<>Pronouns <span className="font-normal text-muted-foreground">(optional)</span></>} error={errors.pronouns}>
              <TextInput name="pronouns" maxLength={40} autoComplete="off" />
            </FormField>
            <FormField id={`${formId}-first`} label="First name" required error={errors.firstName}>
              <TextInput name="firstName" required defaultValue={first} autoComplete="off" />
            </FormField>
            <FormField id={`${formId}-last`} label="Last name" required error={errors.lastName}>
              <TextInput name="lastName" required defaultValue={last} autoComplete="off" />
            </FormField>
            <FormField id={`${formId}-dob`} label="Date of birth" required error={errors.dateOfBirth} hint="DD/MM/YYYY" className="col-span-2 sm:col-span-1">
              <TextInput name="dateOfBirth" required placeholder="DD/MM/YYYY" inputMode="numeric" autoComplete="off" />
            </FormField>
          </div>
        </fieldset>

        <fieldset>
          <legend className={legend}>Contact</legend>
          <div className="grid grid-cols-1 gap-3">
            <FormField id={`${formId}-mobile`} label="Mobile" error={errors.phoneMobile}>
              <TextInput name="phoneMobile" type="tel" placeholder="07700 900000" autoComplete="off" />
            </FormField>
            <FormField id={`${formId}-email`} label="Email" error={errors.email}>
              <TextInput name="email" type="email" autoComplete="off" />
            </FormField>
            <FormField id={`${formId}-postcode`} label="Postcode" error={errors.postcode}>
              <TextInput name="postcode" autoComplete="off" className="max-w-[160px]" />
            </FormField>
          </div>
        </fieldset>

        <fieldset>
          <legend className={legend}>Consent</legend>
          <div className="flex flex-col gap-2.5">
            {/* Appointment reminders are service messages (on unless the patient opts out); text and email are separate in the record. */}
            <Checkbox name="reminderSms" value="on" defaultChecked label="Appointment reminders by text" />
            <Checkbox name="reminderEmail" value="on" defaultChecked label="Appointment reminders by email" />
            <Checkbox name="marketingEmail" value="on" label="News and offers by email" />
            <Checkbox name="consentTreatment" value="on" label="Consent to assessment and treatment recorded" />
            {errors.marketingConsentSource ? (
              <span role="alert" className="text-xs text-destructive-strong">
                {errors.marketingConsentSource}
              </span>
            ) : null}
          </div>
        </fieldset>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border px-5 py-4">
        <SaveButtons onCancel={onCancel} />
      </div>
    </form>
  );
}

export function NewPatientDrawer({ open, onOpenChange, action, initialName }: { open: boolean; onOpenChange: (open: boolean) => void; action: RecordsAction; initialName?: string }) {
  return (
    <SideDrawer open={open} onOpenChange={onOpenChange} title="New patient" className="max-w-[480px] [&>div:nth-child(2)]:p-0">
      <NewPatientForm action={action} initialName={initialName} onCancel={() => onOpenChange(false)} />
    </SideDrawer>
  );
}
