"use client";
import { useFormState } from "react-dom";
import { Field, Notice } from "@/components/account/shell";
import { SecretBox, SubmitButton } from "@/components/account/form-controls";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type RoleKey } from "@/lib/account-copy";
import type { ActionResult } from "@/server/auth/session";
import { changeRole, createResetLink, inviteMember, saveMemberProfile, type InviteResult, type ResetLinkResult } from "./actions";

function RoleSelect({ roles, defaultValue, name = "role" }: { roles: RoleKey[]; defaultValue?: RoleKey; name?: string }) {
  return (
    <select
      name={name}
      defaultValue={defaultValue ?? roles[roles.length - 1]}
      className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
    >
      {roles.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABELS[r]}
        </option>
      ))}
    </select>
  );
}

export function InviteForm({ roles, emailOff }: { roles: RoleKey[]; emailOff: boolean }) {
  const [state, action] = useFormState(inviteMember, null as InviteResult | null);
  return (
    <div className="space-y-4">
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <Field label="Email address" name="email" type="email" required autoComplete="off" />
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-800">
            Role
            <span className="mt-1.5 block">
              <RoleSelect roles={roles} />
            </span>
          </label>
        </div>
        <SubmitButton pendingText="Inviting…">Invite</SubmitButton>
      </form>
      <ul className="grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
        {roles.map((r) => (
          <li key={r}>
            <strong className="text-slate-700">{ROLE_LABELS[r]}:</strong> {ROLE_DESCRIPTIONS[r]}
          </li>
        ))}
      </ul>
      {state?.ok === false ? <Notice tone="error">{state.error}</Notice> : null}
      {state?.ok === true && state.link ? (
        <SecretBox
          label={`Invitation link for ${state.email}`}
          value={state.link}
          note={
            emailOff
              ? "Email is not set up yet, so nothing was sent. Pass this link to the person yourself. It works once and expires in 7 days."
              : "The email could not be sent. Pass this link to the person yourself. It works once and expires in 7 days."
          }
        />
      ) : null}
      {state?.ok === true && state.sent ? <Notice tone="success">Invitation sent to {state.email}. The link expires in 7 days.</Notice> : null}
    </div>
  );
}

export function RoleForm({ memberId, roles, current }: { memberId: string; roles: RoleKey[]; current: RoleKey }) {
  const [state, action] = useFormState(changeRole, null as ActionResult | null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="memberId" value={memberId} />
      <RoleSelect roles={roles} defaultValue={current} />
      <SubmitButton variant="secondary" pendingText="Saving…">
        Change role
      </SubmitButton>
      {state?.ok === false ? <span className="text-sm text-red-700">{state.error}</span> : null}
      {state?.ok === true ? <span className="text-sm text-teal-700">Role changed.</span> : null}
    </form>
  );
}

export function SigningForm({
  memberId,
  jobTitle,
  hcpcNumber,
  canSign,
  staff,
}: {
  memberId: string;
  jobTitle: string;
  hcpcNumber: string;
  canSign: boolean;
  staff: boolean;
}) {
  const [state, action] = useFormState(saveMemberProfile, null as ActionResult | null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="memberId" value={memberId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Job title" name="jobTitle" defaultValue={jobTitle} maxLength={120} placeholder="Senior Physiotherapist" />
        <Field label="HCPC registration number" name="hcpcNumber" defaultValue={hcpcNumber} maxLength={12} placeholder="As on the HCPC register" />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="canSign" defaultChecked={canSign} disabled={staff} className="h-4 w-4 rounded border-slate-300" />
        May sign (approve) completed forms
        {staff ? <span className="text-xs text-slate-500">(not for staff)</span> : null}
      </label>
      <div className="flex items-center gap-3">
        <SubmitButton variant="secondary" pendingText="Saving…">
          Save signing details
        </SubmitButton>
        {state?.ok === false ? <span className="text-sm text-red-700">{state.error}</span> : null}
        {state?.ok === true ? <span className="text-sm text-teal-700">Saved.</span> : null}
      </div>
    </form>
  );
}

export function ResetLinkForm({ memberId, emailOff }: { memberId: string; emailOff: boolean }) {
  const [state, action] = useFormState(createResetLink, null as ResetLinkResult | null);
  return (
    <div className="space-y-2">
      <form action={action}>
        <input type="hidden" name="memberId" value={memberId} />
        <SubmitButton variant="secondary" pendingText="Creating…">
          {emailOff ? "Create a password reset link" : "Email a password reset link"}
        </SubmitButton>
      </form>
      {state?.ok === false ? <Notice tone="error">{state.error}</Notice> : null}
      {state?.ok === true && state.link ? (
        <SecretBox
          label="Password reset link"
          value={state.link}
          note="Pass this link to the member yourself. It works once and expires in 2 hours. They still need their authenticator app to sign in."
        />
      ) : null}
      {state?.ok === true && state.sent ? <Notice tone="success">Reset link sent. It expires in 2 hours.</Notice> : null}
    </div>
  );
}
