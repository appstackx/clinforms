/**
 * The seam between sign-in and the ClinForms module (wave 2 wires it into MedreportDeps.authenticate and
 * MedreportDeps.clinicProfile; nothing calls it from a handler yet).
 *
 * buildAuthContext(): Better Auth session → AuthContext
 *   userId, authSessionId           from the session
 *   tenantId, role                  from the session's ACTIVE clinic and the member row (re-read, not cached)
 *   clinician                       from member_profile (name from the account)
 *   (the session is read from the database, never from the cookie cache)
 *   twoFactorVerified               the account has two-step verification on. Better Auth only issues a
 *                                   session to such an account after the second factor, and turning it on
 *                                   revokes every older session (create-auth.ts), so every live session of
 *                                   such an account passed it.
 * A session without an active clinic, or whose member row is gone, gives null.
 */
import type { Kysely } from "kysely";
import type { AuthContext, ClinicProfile } from "../../modules/medreport/api/deps";
import type { Database } from "../db/schema";
import { getClinicProfile } from "../repos/clinic-profile";
import { getMemberProfile } from "../repos/member-profile";
import type { Auth } from "./create-auth";
import { findMembership } from "./membership";

export async function buildAuthContext(auth: Auth, db: Kysely<Database>, headers: Headers): Promise<AuthContext | null> {
  // Read past Better Auth's 5-minute cookie cache: a revoked session (signed out elsewhere, password reset,
  // "sign out other devices") must stop acting for the clinic at once.
  const session = await auth.api.getSession({ headers, query: { disableCookieCache: true } }).catch(() => null);
  if (!session) return null;
  const organizationId = (session.session as { activeOrganizationId?: string | null }).activeOrganizationId;
  if (!organizationId) return null;
  const membership = await findMembership(db, organizationId, session.user.id);
  if (!membership) return null;
  const profile = await getMemberProfile({ db }, organizationId, session.user.id);
  const clinician =
    profile && (profile.hcpcNumber || profile.jobTitle || profile.canSign)
      ? {
          name: session.user.name,
          ...(profile.hcpcNumber ? { hcpc: profile.hcpcNumber } : {}),
          ...(profile.jobTitle ? { jobTitle: profile.jobTitle } : {}),
          canSign: profile.canSign,
        }
      : undefined;
  return {
    userId: session.user.id,
    authSessionId: session.session.id,
    tenantId: membership.tenantId,
    role: membership.role,
    ...(clinician ? { clinician } : {}),
    twoFactorVerified: (session.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled === true,
  };
}

/** clinic_profile → the module's ClinicProfile. */
export async function loadClinicProfile(db: Kysely<Database>, tenantId: string): Promise<ClinicProfile | null> {
  const p = await getClinicProfile({ db }, tenantId).catch(() => null);
  if (!p) return null;
  return {
    tenantId: p.tenantId,
    displayName: p.displayName,
    ...(p.legalName ? { legalName: p.legalName } : {}),
    addressLines: p.address ?? [],
    ...(p.postcode ? { postcode: p.postcode } : {}),
    ...(p.phone ? { phone: p.phone } : {}),
    ...(p.email ? { email: p.email } : {}),
    retentionDays: p.retentionDays,
    draftingEnabled: p.draftingEnabled,
  };
}
