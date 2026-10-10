"use server";
/**
 * Shared actions of the signed-in area: sign out, switch the active clinic.
 *
 * Fix wave 2: the pages call endSessionAction / chooseClinicAction through ./session-forms.tsx, which then load
 * the next page in full (window.location.assign) – a redirect from a server action is a client-side navigation
 * in Next 14, and nothing a member had in memory (the Studio's records) may survive into another sign-in or clinic.
 */
import { getAuth } from "@/server/auth/auth";
import { findMembership } from "@/server/auth/membership";
import { getServerSession, hasTwoFactor, requestHeaders } from "@/server/auth/session";
import { getDb } from "@/server/db";

/** Sign out; returns the page to load next (the caller loads it in full). */
export async function endSessionAction(): Promise<string> {
  try {
    await getAuth().api.signOut({ headers: requestHeaders() });
  } catch {
    // already signed out
  }
  return "/login";
}

/** Make `organizationId` the active clinic; returns the page to load next (the caller loads it in full). */
export async function chooseClinicAction(form: FormData): Promise<string> {
  const organizationId = String(form.get("organizationId") ?? "");
  const session = await getServerSession({ fresh: true });
  if (!session) return "/login";
  if (!hasTwoFactor(session)) return "/two-factor";
  const membership = organizationId ? await findMembership(getDb(), organizationId, session.user.id) : null;
  if (!membership) return "/app/select-clinic";
  await getAuth().api.setActiveOrganization({ body: { organizationId }, headers: requestHeaders() });
  return "/app";
}
