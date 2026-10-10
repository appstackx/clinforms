"use server";
/**
 * Two-step verification setup: confirm the password → scan the QR code, save the backup codes → enter a code →
 * /app. The backup codes are shown BEFORE the code is checked (they only start working once it is): after the
 * check the session is replaced and the page is left at once.
 */
import { redirect } from "next/navigation";
import { ACCOUNT_ERRORS } from "@/lib/account-copy";
import { getAuth } from "@/server/auth/auth";
import { authErrorMessage } from "@/server/auth/errors";
import { manualEntryKey, otpauthQrDataUri } from "@/server/auth/qr";
import { getServerSession, hasTwoFactor, requestHeaders, throttle } from "@/server/auth/session";

export type SetupState =
  | { status: "idle" }
  | { status: "error"; error: string }
  | { status: "scan"; qr: string; manualKey: string; backupCodes: string[]; /** otpauth:// link (a phone opens it in its authenticator app). */ uri: string }
  | { status: "done" };

export type ConfirmState = { status: "idle" } | { status: "error"; error: string };

const WINDOW = 15 * 60_000;

export async function startSetup(_prev: SetupState, form: FormData): Promise<SetupState> {
  const session = await getServerSession({ fresh: true });
  if (!session) redirect("/login?next=%2Fapp");
  if (hasTwoFactor(session)) return { status: "done" };
  const password = String(form.get("password") ?? "");
  if (!(await throttle("two-factor-setup", session.user.id, 10, WINDOW))) return { status: "error", error: ACCOUNT_ERRORS.tooManyAttempts };
  try {
    const result = await getAuth().api.enableTwoFactor({ body: { password }, headers: requestHeaders() });
    if (result.method !== "totp" || !("totpURI" in result)) return { status: "error", error: ACCOUNT_ERRORS.generic };
    return { status: "scan", qr: otpauthQrDataUri(result.totpURI), manualKey: manualEntryKey(result.totpURI), backupCodes: result.backupCodes, uri: result.totpURI };
  } catch (err) {
    return { status: "error", error: authErrorMessage(err, "two_factor_start") };
  }
}

export async function confirmSetup(_prev: ConfirmState, form: FormData): Promise<ConfirmState> {
  const session = await getServerSession({ fresh: true });
  if (!session) redirect("/login?next=%2Fapp");
  const code = String(form.get("code") ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) return { status: "error", error: ACCOUNT_ERRORS.invalidCode };
  if (!(await throttle("two-factor-confirm", session.user.id, 10, WINDOW))) return { status: "error", error: ACCOUNT_ERRORS.tooManyAttempts };
  try {
    // Turns two-step verification on, signs every other session out and issues a new session cookie.
    await getAuth().api.verifyTOTP({ body: { code }, headers: requestHeaders() });
  } catch (err) {
    return { status: "error", error: authErrorMessage(err, "two_factor_confirm") };
  }
  // Leave this page straight away: a re-render here would still carry the old (now revoked) session cookie.
  redirect("/app");
}
