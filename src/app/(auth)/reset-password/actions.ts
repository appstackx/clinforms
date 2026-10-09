"use server";
/** Password reset: ask for a link by email (when email is set up), then choose a new password. */
import { ACCOUNT_ERRORS, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/account-copy";
import { getAuth } from "@/server/auth/auth";
import { authErrorMessage } from "@/server/auth/errors";
import { clientIp, requestHeaders, throttle } from "@/server/auth/session";
import { emailProviderName } from "@/server/email";
import { logAuthEvent } from "@/server/email/log";

export type ResetState = { status: "idle" } | { status: "sent" } | { status: "done" } | { status: "error"; error: string };

export async function requestResetLink(_prev: ResetState, form: FormData): Promise<ResetState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { status: "error", error: ACCOUNT_ERRORS.invalidEmail };
  if (emailProviderName() === "none") return { status: "error", error: ACCOUNT_ERRORS.generic };
  if (!(await throttle("reset-ip", clientIp(), 10, 15 * 60_000)) || !(await throttle("reset-email", email, 3, 60 * 60_000))) {
    return { status: "error", error: ACCOUNT_ERRORS.tooManyAttempts };
  }
  try {
    await getAuth().api.requestPasswordReset({ body: { email }, headers: requestHeaders() });
  } catch (err) {
    // Same answer whatever happened: never reveal whether an account exists.
    logAuthEvent("auth.reset_request_failed", { code: (err as { body?: { code?: string } })?.body?.code ?? "error" });
  }
  return { status: "sent" };
}

export async function setNewPassword(_prev: ResetState, form: FormData): Promise<ResetState> {
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (password.length < PASSWORD_MIN_LENGTH) return { status: "error", error: ACCOUNT_ERRORS.passwordTooShort };
  if (password.length > PASSWORD_MAX_LENGTH) return { status: "error", error: ACCOUNT_ERRORS.passwordTooLong };
  if (password !== confirm) return { status: "error", error: ACCOUNT_ERRORS.passwordMismatch };
  if (!(await throttle("reset-set-ip", clientIp(), 10, 15 * 60_000))) return { status: "error", error: ACCOUNT_ERRORS.tooManyAttempts };
  try {
    await getAuth().api.resetPassword({ body: { newPassword: password, token }, headers: requestHeaders() });
  } catch (err) {
    return { status: "error", error: authErrorMessage(err, "reset_password") };
  }
  return { status: "done" };
}
