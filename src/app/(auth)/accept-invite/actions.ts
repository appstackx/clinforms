"use server";
/**
 * Accepting an invitation: either create the account (name + password, for the invited address only) and
 * join, or – already signed in as the invited address – just join. Then two-step setup.
 */
import { redirect } from "next/navigation";
import { ACCOUNT_ERRORS, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/account-copy";
import { getAuth } from "@/server/auth/auth";
import { cookieHeaderFromSetCookie } from "@/server/auth/cookies";
import { authErrorMessage } from "@/server/auth/errors";
import { authSecret } from "@/server/auth/config";
import { findInvitationForLink } from "@/server/auth/membership";
import { clientIp, getServerSession, hasTwoFactor, requestHeaders, throttle } from "@/server/auth/session";
import { getDb } from "@/server/db";

export type AcceptState = { status: "idle" } | { status: "error"; error: string };

const WINDOW = 15 * 60_000;

export async function createAccountAndJoin(_prev: AcceptState, form: FormData): Promise<AcceptState> {
  const token = String(form.get("token") ?? "");
  const name = String(form.get("name") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (!name || name.length > 100) return { status: "error", error: "Enter your full name (up to 100 characters)." };
  if (password.length < PASSWORD_MIN_LENGTH) return { status: "error", error: ACCOUNT_ERRORS.passwordTooShort };
  if (password.length > PASSWORD_MAX_LENGTH) return { status: "error", error: ACCOUNT_ERRORS.passwordTooLong };
  if (password !== confirm) return { status: "error", error: ACCOUNT_ERRORS.passwordMismatch };
  if (!(await throttle("accept-ip", clientIp(), 20, WINDOW))) return { status: "error", error: ACCOUNT_ERRORS.tooManyAttempts };
  const invitation = await findInvitationForLink(getDb(), authSecret(), token);
  if (!invitation) return { status: "error", error: ACCOUNT_ERRORS.inviteInvalid };
  if (invitation.accountExists) return { status: "error", error: ACCOUNT_ERRORS.inviteAccountExists };
  try {
    const auth = getAuth();
    // The address comes from the invitation, never from the form.
    const signUp = await auth.api.signUpEmail({ body: { email: invitation.email, password, name }, headers: requestHeaders(), returnHeaders: true });
    const asNewUser = new Headers(requestHeaders());
    asNewUser.set("cookie", cookieHeaderFromSetCookie(signUp.headers));
    await auth.api.acceptInvitation({ body: { invitationId: invitation.id }, headers: asNewUser });
    // Refresh the cached session (it was cached before the membership existed).
    await auth.api.getSession({ headers: asNewUser, query: { disableCookieCache: true } });
  } catch (err) {
    return { status: "error", error: authErrorMessage(err, "accept_invitation_new") };
  }
  redirect("/two-factor");
}

export async function joinAsSignedIn(_prev: AcceptState, form: FormData): Promise<AcceptState> {
  const token = String(form.get("token") ?? "");
  const session = await getServerSession({ fresh: true });
  if (!session) redirect(`/login?next=${encodeURIComponent(`/accept-invite?token=${token}`)}`);
  if (!(await throttle("accept-ip", clientIp(), 20, WINDOW))) return { status: "error", error: ACCOUNT_ERRORS.tooManyAttempts };
  const invitation = await findInvitationForLink(getDb(), authSecret(), token);
  if (!invitation) return { status: "error", error: ACCOUNT_ERRORS.inviteInvalid };
  if (invitation.email.toLowerCase() !== session.user.email.toLowerCase()) return { status: "error", error: ACCOUNT_ERRORS.inviteWrongAccount };
  try {
    const auth = getAuth();
    await auth.api.acceptInvitation({ body: { invitationId: invitation.id }, headers: requestHeaders() });
    await auth.api.getSession({ headers: requestHeaders(), query: { disableCookieCache: true } });
  } catch (err) {
    return { status: "error", error: authErrorMessage(err, "accept_invitation_existing") };
  }
  redirect(hasTwoFactor(session) ? "/app" : "/two-factor");
}

export async function signOutForInvite(form: FormData): Promise<void> {
  const token = String(form.get("token") ?? "");
  try {
    await getAuth().api.signOut({ headers: requestHeaders() });
  } catch {
    // already signed out
  }
  redirect(`/accept-invite?token=${encodeURIComponent(token)}`);
}
