/**
 * The seam between sign-in and the ClinForms module: src/app/api/_medreport-glue.ts wires these into
 * MedreportDeps.authenticate and MedreportDeps.clinicProfile (wave 2).
 *
 * buildAuthContext(): Better Auth session → AuthContext
 *   userId, authSessionId, name     from the session
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
  const caller = await resolveMedreportCaller(auth, db, headers).catch(() => null);
  return caller && caller.kind === "member" ? caller.context : null;
}

/**
 * Who a request comes from, as the Report API needs it (src/app/api/_medreport-glue.ts authenticate):
 *   none      – no valid sign-in session
 *   no_clinic – signed in, but no active clinic or no longer a member of it (the API refuses: it never
 *               treats a signed-in person as the public demo)
 *   member    – a member of the active clinic (AuthContext)
 * Throws when the sign-in could not be checked (database unavailable): the API answers 503 rather than
 * treating the request as anonymous.
 */
export type MedreportCaller = { kind: "none" } | { kind: "no_clinic"; userId: string } | { kind: "member"; context: AuthContext };

export async function resolveMedreportCaller(auth: Auth, db: Kysely<Database>, headers: Headers): Promise<MedreportCaller> {
  // Read past Better Auth's 5-minute cookie cache: a revoked session (signed out elsewhere, password reset,
  // "sign out other devices") must stop acting for the clinic at once.
  const session = await auth.api.getSession({ headers, query: { disableCookieCache: true } }).catch((err: unknown) => {
    // An invalid / expired session is "no session" (Better Auth answers null or a 401 APIError); anything
    // else (the database) is a failure to check.
    const status = (err as { statusCode?: unknown; status?: unknown } | null)?.statusCode ?? (err as { status?: unknown } | null)?.status;
    if (status === 401 || status === "UNAUTHORIZED") return null;
    throw err;
  });
  if (!session) return { kind: "none" };
  const organizationId = (session.session as { activeOrganizationId?: string | null }).activeOrganizationId;
  if (!organizationId) return { kind: "no_clinic", userId: session.user.id };
  const membership = await findMembership(db, organizationId, session.user.id);
  if (!membership) return { kind: "no_clinic", userId: session.user.id };
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
    kind: "member",
    context: {
      userId: session.user.id,
      authSessionId: session.session.id,
      tenantId: membership.tenantId,
      role: membership.role,
      ...(session.user.name ? { name: session.user.name } : {}),
      ...(clinician ? { clinician } : {}),
      twoFactorVerified: (session.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled === true,
    },
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
