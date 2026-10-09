"use server";
/** Sign-in: password, then the second factor (authenticator code or a backup code). */
import { redirect } from "next/navigation";
import { ACCOUNT_ERRORS } from "@/lib/account-copy";
import { getAuth } from "@/server/auth/auth";
import { safeNextPath } from "@/server/auth/config";
import { authErrorKey, authErrorMessage } from "@/server/auth/errors";
import { clientIp, requestHeaders, throttle } from "@/server/auth/session";

export type LoginState = { status: "idle" } | { status: "code" } | { status: "error"; error: string; restart?: boolean };

const WINDOW = 15 * 60_000;

export async function passwordStep(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { status: "error", error: ACCOUNT_ERRORS.invalidCredentials };
  if (!(await throttle("signin-ip", clientIp(), 30, WINDOW)) || !(await throttle("signin-email", email, 10, WINDOW))) {
    return { status: "error", error: ACCOUNT_ERRORS.tooManyAttempts };
  }
  try {
    const result = await getAuth().api.signInEmail({ body: { email, password, rememberMe: true }, headers: requestHeaders() });
    if ((result as { twoFactorRedirect?: boolean }).twoFactorRedirect) return { status: "code" };
  } catch (err) {
    return { status: "error", error: authErrorMessage(err, "sign_in") };
  }
  // Signed in without a second factor: only possible before it is set up – set it up now.
  redirect("/two-factor");
}

export async function codeStep(_prev: LoginState, form: FormData): Promise<LoginState> {
  const code = String(form.get("code") ?? "").replace(/\s+/g, "").slice(0, 32);
  const method = form.get("method") === "backup" ? "backup" : "totp";
  const next = safeNextPath(form.get("next"));
  if (!code) return { status: "error", error: method === "backup" ? ACCOUNT_ERRORS.invalidBackupCode : ACCOUNT_ERRORS.invalidCode };
  if (!(await throttle("second-factor-ip", clientIp(), 30, WINDOW))) return { status: "error", error: ACCOUNT_ERRORS.tooManyAttempts };
  try {
    const auth = getAuth();
    if (method === "backup") await auth.api.verifyBackupCode({ body: { code }, headers: requestHeaders() });
    else await auth.api.verifyTOTP({ body: { code }, headers: requestHeaders() });
  } catch (err) {
    const key = authErrorKey(err);
    return { status: "error", error: authErrorMessage(err, "second_factor"), restart: key === "challengeExpired" };
  }
  redirect(next);
}
