/**
 * The shared access read (foundation): a member's EFFECTIVE permissions and SITE SCOPE, from their role, the
 * clinic's role overrides, their own exceptions and sites (migration 0103, src/server/repos/pms/access.ts).
 * Every clinic-system check goes through it: the actor (./actor.ts) builds `can` and `siteIds` from it on every
 * request, so a change takes effect on the next page load.
 *
 *   permissions – role default → clinic override → member exception → locks (src/modules/pms/core/permissions.ts)
 *   site scope  – null = every site (the default, "can see all sites", and always for the owner); otherwise the
 *                 sites they work at ∪ the sites they can see (K2-SITE-004). Used by the diary
 *                 (resolveDiarySiteScope), the records services (patients) and the shell's site switcher.
 *
 * Patients and sites: a patient has no site of their own. A member limited to some sites sees a patient when the
 * patient has a case or an appointment at one of those sites, or has neither anywhere yet (just registered – so
 * reception can register and then book). `patientVisibleInScope` / `patientSiteFilter`.
 */
import { visibleSiteIds, type MemberAccess } from "../../modules/pms/core/access";
import { canWith, effectivePermissions, type GrantedPermission, type PmsPermission } from "../../modules/pms/core/permissions";
import type { DbContext } from "../repos/context";
import { loadAccessInputs, patientSiteFilter } from "../repos/pms/access";

export { patientSiteFilter };

export interface MemberAccessView {
  /** Effective permissions ("clinic.view" + the grid's ids). Empty when deactivated. */
  permissions: ReadonlySet<GrantedPermission>;
  can: (permission: PmsPermission) => boolean;
  /** null = every site of the clinic. */
  siteIds: ReadonlySet<string> | null;
  /** False when their clinic-system access is switched off. */
  active: boolean;
  /** The stored access (null = nothing stored: the defaults). */
  stored: MemberAccess | null;
}

/** Effective permissions and site scope of a member with `role` at the clinic. */
export async function resolveMemberAccess(ctx: DbContext, tenantId: string, userId: string, role: string): Promise<MemberAccessView> {
  const { overrides, access } = await loadAccessInputs(ctx, tenantId, userId, role);
  const active = access?.active ?? true;
  const permissions = effectivePermissions({ role, roleOverrides: overrides, exceptions: access?.exceptions ?? {}, active });
  return { permissions, can: canWith(permissions), siteIds: visibleSiteIds(role, access), active, stored: access };
}

/** Whether one patient is visible in a site scope (null scope = always). */
export async function patientVisibleInScope(ctx: DbContext, tenantId: string, patientId: string, siteIds: ReadonlySet<string> | null): Promise<boolean> {
  if (siteIds === null) return true;
  const row = await ctx.db
    .selectFrom("pms_patients")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("id", "=", patientId)
    .where(patientSiteFilter(tenantId, siteIds))
    .executeTakeFirst();
  return Boolean(row);
}
