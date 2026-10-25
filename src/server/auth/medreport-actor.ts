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
import { COMPANY } from "../../lib/site";
import { clinicAccessOf, readClinicPlan, type ClinicPlan } from "../repos/clinic-plan";
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

/**
 * clinic_profile → the module's ClinicProfile; null when the clinic has none. A read that FAILS throws (fix wave
 * 2): the module then fails closed (no drafting it cannot check) instead of taking the failure for "no profile".
 */
export async function loadClinicProfile(db: Kysely<Database>, tenantId: string, now: Date = new Date()): Promise<ClinicProfile | null> {
  // readClinicPlan: a database before migration 0006 reads as "no plan" (security fix 24/10, ops M1).
  const [p, plan] = await Promise.all([getClinicProfile({ db }, tenantId), readClinicPlan({ db }, tenantId)]);
  if (!p) {
    // Security fix 24/10 (authz L1): an ended trial is enforced even without a clinic_profile row – a minimal profile
    // carrying the trial (drafting off, no clinic details) instead of null, which the module reads as "no trial".
    const planView = clinicPlanForModule(plan, now);
    if (planView.trial?.state !== "ended") return null;
    return { ...planView, tenantId, displayName: "", addressLines: [], retentionDays: 30, draftingEnabled: false };
  }
  return {
    ...clinicPlanForModule(plan, now),
    tenantId: p.tenantId,
    displayName: p.displayName,
    ...(p.legalName ? { legalName: p.legalName } : {}),
    addressLines: p.address ?? [],
    ...(p.postcode ? { postcode: p.postcode } : {}),
    ...(p.phone ? { phone: p.phone } : {}),
    ...(p.email ? { email: p.email } : {}),
    retentionDays: p.retentionDays,
    draftingEnabled: p.draftingEnabled,
    demoClinic: p.demoClinic,
  };
}

/**
 * clinic_plan → the module's view of it (10/2026): the trial's state (pending / running / ended – an ended trial
 * makes the Report API refuse anything new with 403 TRIAL_ENDED, auth/clinic-access.ts), the clinic's own drafting
 * limits (ai/live-gate.ts) and the contact address for the refusal. Nothing for a clinic without a plan row.
 */
export function clinicPlanForModule(plan: ClinicPlan | null, now: Date = new Date()): Pick<ClinicProfile, "trial" | "draftingLimits" | "contactEmail"> {
  if (!plan) return {};
  const access = clinicAccessOf(plan, now);
  const trial: ClinicProfile["trial"] | undefined =
    access.state === "trial"
      ? { state: access.pending ? "pending" : "running", ...(access.endsAt ? { endsAt: access.endsAt } : {}), daysLeft: access.daysLeft }
      : access.state === "trial_ended"
        ? { state: "ended", endsAt: access.endedAt }
        : undefined;
  const limits = {
    ...(plan.livePerMinute !== null ? { perMinute: plan.livePerMinute } : {}),
    ...(plan.livePerDay !== null ? { perDay: plan.livePerDay } : {}),
  };
  return {
    ...(trial ? { trial } : {}),
    ...(Object.keys(limits).length ? { draftingLimits: limits } : {}),
    contactEmail: COMPANY.contactEmail,
  };
}
