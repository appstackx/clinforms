"use client";
import { useFormState } from "react-dom";
import { Field, Notice } from "@/components/account/shell";
import { SecretBox, SubmitButton } from "@/components/account/form-controls";
import { INVITE_COPY, OWNER_RESET_COPY, RETENTION_MAX_DAYS, RETENTION_MIN_DAYS } from "@/lib/account-copy";
import {
  changeTrialAction,
  createClinicAction,
  createOwnerResetLinkAction,
  setLimitsAction,
  setTrialAction,
  type CreateClinicResult,
  type OwnerResetResult,
  type PlanActionResult,
} from "./actions";

const UK_DATE = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric" });
const UK_DATE_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** `emailOn`: email is set up on this deployment, so the invitation can be emailed (a choice, on by default). */
export function CreateClinicForm({ emailOn }: { emailOn: boolean }) {
  const [state, action] = useFormState(createClinicAction, null as CreateClinicResult | null);
  return (
    <div className="space-y-4">
      <form action={action} className="grid gap-4 sm:grid-cols-2">
        <Field label="Clinic name" name="name" required maxLength={200} autoComplete="off" placeholder="Riverside Physiotherapy" />
        <Field
          label="Clinic id"
          name="slug"
          required
          minLength={3}
          maxLength={63}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          autoComplete="off"
          placeholder="riverside-physio"
          hint="Lower-case letters, digits and single hyphens. It can never be changed or reused."
        />
        <Field label="Owner's email address" name="ownerEmail" type="email" required autoComplete="off" hint="They receive the owner invitation." />
        <Field
          label="Keep reports for (days)"
          name="retentionDays"
          type="number"
          inputMode="numeric"
          defaultValue={365}
          hint={`${RETENTION_MIN_DAYS}–${RETENTION_MAX_DAYS} days. The clinic can change it later.`}
        />
        {emailOn ? (
          <div className="sm:col-span-2">
            <input type="hidden" name="emailChoice" value="1" />
            <label className="flex items-center gap-2 text-sm text-slate-800">
              <input type="checkbox" name="sendEmail" className="h-4 w-4 rounded border-slate-300" />
              Email the invitation to the owner
            </label>
            <p className="mt-1 text-xs text-slate-500">
              Only for the owner&apos;s own mailbox – never a shared inbox: whoever opens the invitation first becomes the owner. Either way, the link is
              also shown here once, to copy.
            </p>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <SubmitButton pendingText="Creating…" confirmText="Create this clinic? Its id can never be changed or reused. Only do this once the data processing agreement is signed.">
            Create clinic and invite the owner
          </SubmitButton>
        </div>
      </form>
      {state?.ok === false ? <Notice tone="error">{state.error}</Notice> : null}
      {state?.ok === true ? (
        <div className="space-y-3">
          <Notice tone={state.delivery === "sent" ? "success" : "warning"}>
            {state.clinicName} ({state.tenantId}) is set up. {INVITE_COPY.outcome(state.delivery, state.ownerEmail)}
          </Notice>
          <SecretBox
            label={`${INVITE_COPY.linkLabel(state.delivery)} (owner)`}
            value={state.inviteLink}
            note={`Shown only this once. ${INVITE_COPY.linkWarning(state.delivery, `on ${UK_DATE.format(new Date(state.expiresAt))}`)}`}
          />
        </div>
      ) : null}
    </div>
  );
}

/** A one-time password reset link for a clinic owner (shown once, never emailed). */
export function OwnerResetForm({ clinics }: { clinics: PlanClinicOption[] }) {
  const [state, action] = useFormState(createOwnerResetLinkAction, null as OwnerResetResult | null);
  return (
    <div className="space-y-4">
      <form action={action} className="grid gap-4 sm:grid-cols-2" aria-label="Owner password reset link">
        <ClinicSelect clinics={clinics} id="owner-reset-clinic" />
        <Field label="Owner's email address" name="resetOwnerEmail" type="email" required autoComplete="off" hint="Must be an owner of that clinic." />
        <div className="sm:col-span-2">
          <SubmitButton
            variant="secondary"
            pendingText="Creating…"
            confirmText="Create a password reset link for this owner? Only do this after confirming who you are speaking to."
          >
            Create a reset link
          </SubmitButton>
        </div>
      </form>
      {state?.ok === false ? <Notice tone="error">{state.error}</Notice> : null}
      {state?.ok === true ? (
        <SecretBox
          label={`Password reset link for ${state.ownerEmail} (${state.tenantId}) – until ${UK_DATE_TIME.format(new Date(state.expiresAt))}`}
          value={state.link}
          note={OWNER_RESET_COPY.note}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Trials and drafting limits (10/2026)
 * ----------------------------------------------------------------------------------------------*/

export interface PlanClinicOption {
  tenantId: string;
  name: string;
}

const SELECT = "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700";
const LABEL = "mb-1 block text-sm font-medium text-slate-800";

function ClinicSelect({ clinics, id }: { clinics: PlanClinicOption[]; id: string }) {
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        Clinic
      </label>
      <select id={id} name="tenantId" required className={SELECT} defaultValue="">
        <option value="" disabled>
          Choose a clinic
        </option>
        {clinics.map((c) => (
          <option key={c.tenantId} value={c.tenantId}>
            {c.name} ({c.tenantId})
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * A submit button that says which action it is through the form's hidden "what" input (set on click, so it works
 * whether or not the browser passes the pressed button to the action), with an optional confirmation.
 */
function WhatButton({ what, confirm, tone = "primary", children }: { what: string; confirm?: string; tone?: "primary" | "secondary" | "danger"; children: React.ReactNode }) {
  const style = {
    primary: "bg-teal-700 text-white hover:bg-teal-800",
    secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
    danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50",
  }[tone];
  return (
    <button
      type="submit"
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) {
          e.preventDefault();
          return;
        }
        const input = e.currentTarget.form?.elements.namedItem("what");
        if (input instanceof HTMLInputElement) input.value = what;
      }}
      className={`inline-flex h-10 items-center rounded-lg px-4 text-sm font-semibold ${style}`}
    >
      {children}
    </button>
  );
}

function Result({ state }: { state: PlanActionResult | null }) {
  if (!state) return null;
  return state.ok ? <Notice tone="success">{state.message}</Notice> : <Notice tone="error">{state.error}</Notice>;
}

export function TrialForms({ clinics }: { clinics: PlanClinicOption[] }) {
  const [setState, setAction] = useFormState(setTrialAction, null as PlanActionResult | null);
  const [changeState, changeAction] = useFormState(changeTrialAction, null as PlanActionResult | null);
  const [limitState, limitAction] = useFormState(setLimitsAction, null as PlanActionResult | null);
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <form action={setAction} className="space-y-3" aria-label="Set up a trial">
        <h3 className="text-sm font-semibold text-slate-900">Set up a trial</h3>
        <ClinicSelect clinics={clinics} id="trial-set-clinic" />
        <Field label="Length (days)" name="days" type="number" inputMode="numeric" defaultValue={3} hint="1–366 days." />
        <fieldset className="space-y-1 text-sm text-slate-800">
          <legend className={LABEL}>Starts</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="start" value="first_sign_in" defaultChecked /> When the owner first signs in
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="start" value="now" /> Now
          </label>
        </fieldset>
        <SubmitButton pendingText="Saving…" confirmText="Set this trial? Setting a trial again restarts it.">
          Set trial
        </SubmitButton>
        <Result state={setState} />
      </form>
      <form action={changeAction} className="space-y-3" aria-label="Change a trial">
        <h3 className="text-sm font-semibold text-slate-900">Change a trial</h3>
        <ClinicSelect clinics={clinics} id="trial-change-clinic" />
        <Field label="Extend by (days)" name="days" type="number" inputMode="numeric" defaultValue={3} />
        <input type="hidden" name="what" defaultValue="extend" />
        <div className="flex flex-wrap gap-2">
          <WhatButton what="extend">Extend</WhatButton>
          <WhatButton what="paid" tone="secondary" confirm="Convert this trial to a full account?">
            Convert to full account
          </WhatButton>
          <WhatButton what="end" tone="danger" confirm="End this trial now? The clinic can still open its records but cannot create anything new.">
            End now
          </WhatButton>
        </div>
        <Result state={changeState} />
      </form>
      <form action={limitAction} className="space-y-3" aria-label="Drafting limits">
        <h3 className="text-sm font-semibold text-slate-900">Drafting limits</h3>
        <ClinicSelect clinics={clinics} id="limits-clinic" />
        <Field label="Drafting calls per minute" name="perMinute" type="number" inputMode="numeric" placeholder="Default" hint="Empty = the default." />
        <Field label="Drafting calls per day" name="perDay" type="number" inputMode="numeric" placeholder="Default" hint="Empty = the default." />
        <input type="hidden" name="what" defaultValue="save" />
        <div className="flex flex-wrap gap-2">
          <WhatButton what="save">Save limits</WhatButton>
          <WhatButton what="default" tone="secondary">
            Back to defaults
          </WhatButton>
        </div>
        <Result state={limitState} />
      </form>
    </div>
  );
}
