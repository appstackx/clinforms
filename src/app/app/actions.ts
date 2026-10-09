"use server";
/** Shared actions of the signed-in area: sign out, switch the active clinic. */
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth/auth";
import { findMembership } from "@/server/auth/membership";
import { getServerSession, hasTwoFactor, requestHeaders } from "@/server/auth/session";
import { getDb } from "@/server/db";

export async function signOutAction(): Promise<void> {
  try {
    await getAuth().api.signOut({ headers: requestHeaders() });
  } catch {
    // already signed out
  }
  redirect("/login");
}

export async function switchClinicAction(form: FormData): Promise<void> {
  const organizationId = String(form.get("organizationId") ?? "");
  const session = await getServerSession({ fresh: true });
  if (!session) redirect("/login");
  if (!hasTwoFactor(session)) redirect("/two-factor");
  const membership = organizationId ? await findMembership(getDb(), organizationId, session.user.id) : null;
  if (!membership) redirect("/app/select-clinic");
  await getAuth().api.setActiveOrganization({ body: { organizationId }, headers: requestHeaders() });
  redirect("/app");
}
