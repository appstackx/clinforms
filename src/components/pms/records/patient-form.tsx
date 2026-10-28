"use client";
/** Register or edit a patient: demographics, contact details, emergency contact, GP, consents, alerts. */
import { ActionForm, CheckboxField, Fieldset, SelectField, Submit, TextAreaField, TextField, type RecordsAction } from "./form";

export interface PatientFormValues {
  patientId?: string;
  rev?: number;
  title?: string | null;
  firstName?: string;
  lastName?: string;
  preferredName?: string | null;
  dateOfBirth?: string | null;
  sex?: string | null;
  email?: string | null;
  phoneMobile?: string | null;
  phoneHome?: string | null;
  phoneWork?: string | null;
  address?: string[] | null;
  postcode?: string | null;
  occupation?: string | null;
  employer?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
  emergencyRelationship?: string | null;
  gpName?: string | null;
  gpPractice?: string | null;
  gpPhone?: string | null;
  gpAddress?: string[] | null;
  gpPostcode?: string | null;
  consentTreatment?: boolean;
  consentTreatmentAt?: string | null;
  consentShareGp?: boolean;
  reminderSms?: boolean;
  reminderEmail?: boolean;
  marketingEmail?: boolean;
  marketingSms?: boolean;
  marketingConsentSource?: string | null;
  alerts?: string | null;
  notes?: string | null;
}

const SEX = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" },
  { value: "unknown", label: "Not known" },
];
const SOURCES = [
  { value: "verbal", label: "Verbally" },
  { value: "written", label: "In writing" },
  { value: "online", label: "Online" },
];

export function PatientForm({ action, values = {}, submitLabel, consentRecordedOn }: { action: RecordsAction; values?: PatientFormValues; submitLabel: string; consentRecordedOn?: string | null }) {
  const editing = Boolean(values.patientId);
  return (
    <ActionForm action={action} successMessage="The patient's details are saved.">
      {editing ? (
        <>
          <input type="hidden" name="patientId" value={values.patientId} />
          <input type="hidden" name="expectedRev" value={values.rev} />
        </>
      ) : null}
      <Fieldset legend="Name and date of birth">
        <div className="grid gap-4 sm:grid-cols-[7rem_1fr_1fr]">
          <TextField label="Title" name="title" defaultValue={values.title} maxLength={20} autoComplete="off" />
          <TextField label="First name" name="firstName" defaultValue={values.firstName} required maxLength={80} autoComplete="off" />
          <TextField label="Last name" name="lastName" defaultValue={values.lastName} required maxLength={80} autoComplete="off" />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Known as" name="preferredName" defaultValue={values.preferredName} maxLength={80} hint="If different from the first name." />
          <TextField label="Date of birth" name="dateOfBirth" type="date" defaultValue={values.dateOfBirth} />
          <SelectField label="Sex" name="sex" options={SEX} defaultValue={values.sex} emptyLabel="Not recorded" />
        </div>
      </Fieldset>

      <Fieldset legend="Contact details">
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Mobile" name="phoneMobile" type="tel" inputMode="tel" defaultValue={values.phoneMobile} maxLength={24} />
          <TextField label="Home phone" name="phoneHome" type="tel" inputMode="tel" defaultValue={values.phoneHome} maxLength={24} />
          <TextField label="Work phone" name="phoneWork" type="tel" inputMode="tel" defaultValue={values.phoneWork} maxLength={24} />
        </div>
        <TextField label="Email address" name="email" type="email" inputMode="email" defaultValue={values.email} maxLength={254} />
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <TextAreaField label="Address" name="address" defaultValue={(values.address ?? []).join("\n")} rows={3} hint="One line per row, without the postcode." />
          <TextField label="Postcode" name="postcode" defaultValue={values.postcode} maxLength={10} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Occupation" name="occupation" defaultValue={values.occupation} maxLength={120} />
          <TextField label="Employer" name="employer" defaultValue={values.employer} maxLength={160} />
        </div>
      </Fieldset>

      <Fieldset legend="Emergency contact">
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Name" name="emergencyName" defaultValue={values.emergencyName} maxLength={120} />
          <TextField label="Phone" name="emergencyPhone" type="tel" inputMode="tel" defaultValue={values.emergencyPhone} maxLength={24} />
          <TextField label="Relationship" name="emergencyRelationship" defaultValue={values.emergencyRelationship} maxLength={60} />
        </div>
      </Fieldset>

      <Fieldset legend="GP">
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="GP's name" name="gpName" defaultValue={values.gpName} maxLength={120} />
          <TextField label="GP surgery" name="gpPractice" defaultValue={values.gpPractice} maxLength={160} />
          <TextField label="Surgery phone" name="gpPhone" type="tel" inputMode="tel" defaultValue={values.gpPhone} maxLength={24} />
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <TextAreaField label="Surgery address" name="gpAddress" defaultValue={(values.gpAddress ?? []).join("\n")} rows={2} />
          <TextField label="Surgery postcode" name="gpPostcode" defaultValue={values.gpPostcode} maxLength={10} />
        </div>
      </Fieldset>

      <Fieldset legend="Consent and contact preferences">
        <CheckboxField
          label="Consent to assessment and treatment recorded"
          name="consentTreatment"
          defaultChecked={values.consentTreatment}
          hint={consentRecordedOn ? `Recorded on ${consentRecordedOn}. Untick only if the patient withdraws consent.` : "The date is recorded when you tick this."}
        />
        <CheckboxField label="The clinic may write to the patient's GP" name="consentShareGp" defaultChecked={values.consentShareGp} />
        <div className="grid gap-3 sm:grid-cols-2">
          <CheckboxField label="Appointment reminders by text" name="reminderSms" defaultChecked={values.reminderSms ?? true} />
          <CheckboxField label="Appointment reminders by email" name="reminderEmail" defaultChecked={values.reminderEmail ?? true} />
        </div>
        <div className="space-y-3 rounded-lg bg-[#F8FAFC] p-3">
          <p className="text-xs text-[#334155]">Marketing needs the patient&apos;s own agreement: never tick these on their behalf.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <CheckboxField label="News and offers by email" name="marketingEmail" defaultChecked={values.marketingEmail} />
            <CheckboxField label="News and offers by text" name="marketingSms" defaultChecked={values.marketingSms} />
          </div>
          <SelectField label="How the patient agreed to marketing" name="marketingConsentSource" options={SOURCES} defaultValue={values.marketingConsentSource} emptyLabel="Not agreed" className="sm:max-w-xs" />
        </div>
      </Fieldset>

      <Fieldset legend="Alerts and notes" description="Kept encrypted. Alerts show at the top of the record.">
        <TextAreaField label="Medical alerts" name="alerts" defaultValue={values.alerts} rows={2} maxLength={4000} hint="Allergies, precautions, anything every clinician must see first." />
        <TextAreaField label="Administrative notes" name="notes" defaultValue={values.notes} rows={3} maxLength={8000} hint="Not clinical notes – write those in the patient's clinical notes." />
      </Fieldset>

      <div className="flex flex-wrap gap-3">
        <Submit pendingText="Saving…">{submitLabel}</Submit>
      </div>
    </ActionForm>
  );
}
