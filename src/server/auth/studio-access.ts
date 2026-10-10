/**
 * The guard and context of the tenant Studio (/app/studio/**, wave 2). Node only; the Edge middleware has
 * already sent requests WITHOUT a session cookie to /login.
 *
 *   no (valid) session              → /login?next=<path>
 *   no two-step verification        → /two-factor
 *   no active clinic membership     → /app/select-clinic
 *   otherwise                       → the clinic and the signed-in member (signing details from member_profile,
 *                                     drafting switch from clinic_profile) for the Studio's TenantHost, and the
 *                                     clinic's clinicians (fix wave 3: names and HCPC numbers, offered when staff
 *                                     check uploaded notes)
 *
 * Same rules as requireAppContext() (session.ts) – read past Better Auth's 5-minute cookie cache, so a revoked
 * session loses the Studio at once – but written over injected auth/db/headers so it is unit-tested
 * (studio-access.test.ts) without a Next request.
 */
import "server-only";
import type { Kysely } from "kysely";
import { roleLabel } from "../../lib/account-copy";
import type { Database } from "../db/schema";
import { getClinicProfile } from "../repos/clinic-profile";
import { getMemberProfile } from "../repos/member-profile";
import { safeNextPath } from "./config";
import type { Auth } from "./create-auth";
import { findMembership, listClinicMembers } from "./membership";
import type { MemberRole } from "./roles";

export const STUDIO_BASE_PATH = "/app/studio";

/** What the Studio needs about the clinic and the member (no secrets, no session ids). */
export interface TenantStudioContext {
  tenantId: string;
  clinicName: string;
  draftingEnabled: boolean;
  /** Members other than staff (and anyone with an HCPC number): name and HCPC number. No e-mail addresses or ids. */
  clinicians: Array<{ name: string; hcpc?: string }>;
  member: {
    name: string;
    /** The account id (scopes the Studio's in-memory records to this member; not a secret). */
    userId: string;
    email: string;
    role: MemberRole;
    roleLabel: string;
    hcpc?: string;
    jobTitle?: string;
    canSign: boolean;
  };
}

export type StudioAccess = { kind: "redirect"; to: string } | { kind: "ok"; context: TenantStudioContext };

/** `next` for the sign-in page: the requested Studio path, never anything outside /app. */
export function studioLoginRedirect(path: string | null | undefined): string {
  return `/login?next=${encodeURIComponent(safeNextPath(path, STUDIO_BASE_PATH))}`;
}

export async function resolveStudioAccess(deps: { auth: Auth; db: Kysely<Database>; headers: Headers; path?: string | null }): Promise<StudioAccess> {
  const session = await deps.auth.api.getSession({ headers: deps.headers, query: { disableCookieCache: true } }).catch(() => null);
  if (!session) return { kind: "redirect", to: studioLoginRedirect(deps.path) };
  if ((session.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled !== true) return { kind: "redirect", to: "/two-factor" };
  const organizationId = (session.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
  if (!organizationId) return { kind: "redirect", to: "/app/select-clinic" };
  const membership = await findMembership(deps.db, organizationId, session.user.id);
  if (!membership) return { kind: "redirect", to: "/app/select-clinic" };
  const [clinic, profile, members] = await Promise.all([
    getClinicProfile({ db: deps.db }, membership.tenantId).catch(() => null),
    getMemberProfile({ db: deps.db }, organizationId, session.user.id).catch(() => null),
    listClinicMembers(deps.db, organizationId).catch(() => []),
  ]);
  const clinicians = members
    .filter((m) => m.name.trim() && (m.role !== "staff" || Boolean(m.hcpcNumber)))
    .slice(0, 200)
    .map((m) => ({ name: m.name.trim(), ...(m.hcpcNumber ? { hcpc: m.hcpcNumber } : {}) }));
  return {
    kind: "ok",
    context: {
      tenantId: membership.tenantId,
      clinicName: clinic?.displayName || membership.clinicName,
      draftingEnabled: clinic?.draftingEnabled === true,
      clinicians,
      member: {
        name: session.user.name,
        userId: session.user.id,
        email: session.user.email,
        role: membership.role,
        roleLabel: roleLabel(membership.role),
        ...(profile?.hcpcNumber ? { hcpc: profile.hcpcNumber } : {}),
        ...(profile?.jobTitle ? { jobTitle: profile.jobTitle } : {}),
        canSign: profile?.canSign === true,
      },
    },
  };
}
