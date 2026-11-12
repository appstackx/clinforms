"use server";
/**
 * Self-serve sign-up – the form (docs/auth.md §1b). Refused unless CLINFORMS_SELF_SIGNUP is on for the request's
 * (trusted) host. The answer never says whether an address has an account.
 */
import { notFound, redirect } from "next/navigation";
import { getAuth } from "@/server/auth/auth";
import { ACCOUNT_ERRORS } from "@/lib/account-copy";
import { SIGNUP_COPY } from "@/lib/self-signup";
import { requestHeaders } from "@/server/auth/session";
import { signupBrandForAction, signupDeps } from "@/server/signup/request";
import { confirmSignup, startSignup } from "@/server/signup/self-signup";

export type StartTrialState =
  | { status: "idle" }
  | { status: "sent" }
  | { status: "error"; error: string; fieldErrors?: Record<string, string>; values?: { clinicName: string; ownerName: string; email: string } };

export async function startTrial(_prev: StartTrialState, form: FormData): Promise<StartTrialState> {
  const brand = signupBrandForAction();
  if (!brand) notFound();
  const values = {
    clinicName: String(form.get("clinicName") ?? "").slice(0, 300),
    ownerName: String(form.get("ownerName") ?? "").slice(0, 300),
    email: String(form.get("email") ?? "").slice(0, 300),
  };
  try {
    const out = await startSignup(
      {
        ...values,
        password: form.get("password"),
        confirm: form.get("confirm"),
        accept: form.get("accept"),
        website: form.get("website"),
        stamp: form.get("stamp"),
      },
      signupDeps(brand),
    );
    if (out.kind === "check_email") return { status: "sent" };
    if (out.kind === "expired") return { status: "error", error: SIGNUP_COPY.formExpired, values };
    if (out.kind === "rate_limited" || out.kind === "unavailable") return { status: "error", error: out.message, values };
    return { status: "error", error: "Please check the highlighted details.", fieldErrors: out.fieldErrors, values };
  } catch {
    return { status: "error", error: ACCOUNT_ERRORS.generic, values };
  }
}

export type ConfirmTrialState = { status: "idle" } | { status: "error"; error: string; signIn?: boolean };

export async function confirmTrial(_prev: ConfirmTrialState, form: FormData): Promise<ConfirmTrialState> {
  const brand = signupBrandForAction();
  if (!brand) notFound();
  const deps = signupDeps(brand);
  let outcome: Awaited<ReturnType<typeof confirmSignup>>;
  try {
    outcome = await confirmSignup(
      { token: form.get("token"), password: form.get("password") },
      { db: deps.db, auth: getAuth(), secret: deps.secret, baseUrl: deps.baseUrl, brand, headers: requestHeaders(), isPlatformAdminEmail: deps.isPlatformAdminEmail },
    );
  } catch {
    return { status: "error", error: ACCOUNT_ERRORS.generic };
  }
  switch (outcome.kind) {
    case "created":
      // The usual two-step set-up, then Plan and billing (the brand's plans and trial, as for any new clinic).
      redirect(`/two-factor?next=${encodeURIComponent("/app/settings/billing")}`);
    case "wrong_password":
      return { status: "error", error: SIGNUP_COPY.wrongPassword };
    case "too_many":
      return { status: "error", error: SIGNUP_COPY.tooManyAttempts };
    case "busy":
      return { status: "error", error: SIGNUP_COPY.linkBusy };
    case "existing_account":
      return { status: "error", error: SIGNUP_COPY.alreadyHaveAccount, signIn: true };
    case "invalid":
      return { status: "error", error: SIGNUP_COPY.linkInvalid };
    default:
      return { status: "error", error: ACCOUNT_ERRORS.generic };
  }
}
