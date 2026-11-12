"use client";
import Link from "next/link";
import { useFormState } from "react-dom";
import { Field, Notice } from "@/components/account/shell";
import { SubmitButton } from "@/components/account/form-controls";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/account-copy";
import { CLINIC_NAME_MAX, DPA_PATH, OWNER_NAME_MAX, SIGNUP_COPY } from "@/lib/self-signup";
import { startTrial, type StartTrialState } from "./actions";

const IDLE: StartTrialState = { status: "idle" };

function FieldError({ name, errors }: { name: string; errors?: Record<string, string> }) {
  const message = errors?.[name];
  return message ? (
    <p id={`f-${name}-error`} className="-mt-2 text-xs font-medium text-red-700" data-testid={`error-${name}`}>
      {message}
    </p>
  ) : null;
}

const linkClass = "font-medium text-teal-700 underline underline-offset-2";

export function StartTrialForm({ stamp }: { stamp: string }) {
  const [state, action] = useFormState(startTrial, IDLE);
  if (state.status === "sent") {
    return (
      <div className="space-y-3" data-testid="signup-sent">
        <h2 className="text-base font-semibold">{SIGNUP_COPY.checkEmailTitle}</h2>
        <Notice tone="success">{SIGNUP_COPY.checkEmail}</Notice>
      </div>
    );
  }
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const values = state.status === "error" ? state.values : undefined;
  return (
    <form action={action} className="space-y-4" noValidate={false}>
      <input type="hidden" name="stamp" value={stamp} />
      {/* Honeypot: hidden from people (and from screen readers); naive bots fill it in. */}
      <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="f-website">Leave this empty</label>
        <input id="f-website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      {state.status === "error" ? <Notice tone="error">{state.error}</Notice> : null}
      <Field label="Clinic name" name="clinicName" autoComplete="organization" required maxLength={CLINIC_NAME_MAX} defaultValue={values?.clinicName} />
      <FieldError name="clinicName" errors={errors} />
      <Field label="Your name" name="ownerName" autoComplete="name" required maxLength={OWNER_NAME_MAX} defaultValue={values?.ownerName} />
      <FieldError name="ownerName" errors={errors} />
      <Field label="Work email" name="email" type="email" autoComplete="email" required maxLength={254} defaultValue={values?.email} />
      <FieldError name="email" errors={errors} />
      <Field
        label="Choose a password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={PASSWORD_MAX_LENGTH}
        hint={`${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters. You will type it again after opening the link in the email.`}
      />
      <FieldError name="password" errors={errors} />
      <Field label="Repeat the password" name="confirm" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} />
      <FieldError name="confirm" errors={errors} />
      <div className="flex items-start gap-2">
        <input id="f-accept" name="accept" type="checkbox" required className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600" />
        <label htmlFor="f-accept" className="text-sm text-slate-700">
          I accept the{" "}
          <Link href="/terms" target="_blank" rel="noopener" className={linkClass}>
            terms of service
          </Link>{" "}
          and the{" "}
          <Link href={DPA_PATH} target="_blank" rel="noopener" className={linkClass}>
            data processing agreement
          </Link>{" "}
          on behalf of the clinic, and I am authorised to do so.
        </label>
      </div>
      <FieldError name="accept" errors={errors} />
      <SubmitButton className="w-full" pendingText="Sending the link…">
        Start free trial
      </SubmitButton>
      <p className="text-center text-xs text-slate-500">
        Our{" "}
        <Link href="/privacy" className={linkClass}>
          privacy policy
        </Link>{" "}
        explains how your details are used. During the trial, use made-up patient data only.
      </p>
    </form>
  );
}
