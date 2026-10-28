/**
 * Staff roles and site access in the clinic system (pure). The roles are the clinic's member roles (one list for
 * the whole product – src/modules/pms/core/permissions.ts); the clinic system names them for what people do:
 *
 *   owner     → Owner          everything; always every site
 *   admin     → Administrator  everything; may be limited to some sites (a site manager)
 *   clinician → Practitioner   patients, clinical notes, diary, messages; billing read-only
 *   staff     → Reception      patients' details, diary, billing, messages; never clinical notes
 *
 * Site access: by default a member works at every site. An administrator, practitioner or receptionist can be
 * limited to chosen sites; reports, set-up and (when the modules adopt it) the diary then show only those sites.
 * Owners are never limited (someone must always see the whole clinic).
 */
import { pmsCan, type PmsPermission, type PmsRole } from "../core/permissions";

export const CLINIC_ROLE_LABELS: Readonly<Record<PmsRole, string>> = {
  owner: "Owner",
  admin: "Administrator",
  clinician: "Practitioner",
  staff: "Reception",
};

export const CLINIC_ROLE_DESCRIPTIONS: Readonly<Record<PmsRole, string>> = {
  owner: "Everything, at every site, including other owners and the clinic's packages.",
  admin: "Everything except changing owners: set-up, staff, reports, exports and the audit trail.",
  clinician: "Patients, clinical notes (write and sign), the diary and messages. Sees invoices but does not change them.",
  staff: "Patients' contact and booking details, the diary, invoices and payments, messages. Never clinical notes.",
};

/** The clinic-system name of a member role ("clinician" → "Practitioner"); unknown roles as given. */
export function clinicRoleLabel(role: string | null | undefined): string {
  return role && role in CLINIC_ROLE_LABELS ? CLINIC_ROLE_LABELS[role as PmsRole] : (role ?? "");
}

/** Where a member may work: every site, or the listed sites only. */
export type SiteScope = { all: true } | { all: false; siteIds: readonly string[] };

export const ALL_SITES: SiteScope = { all: true };

/** Roles that can be limited to some sites (owners always see every site). */
export function canBeSiteLimited(role: string | null | undefined): boolean {
  return role === "admin" || role === "clinician" || role === "staff";
}

/** The scope of a member from their role and stored access (no stored row = every site). */
export function effectiveSiteScope(role: string | null | undefined, stored: { allSites: boolean; siteIds: readonly string[] } | null): SiteScope {
  if (!canBeSiteLimited(role) || !stored || stored.allSites) return ALL_SITES;
  return { all: false, siteIds: stored.siteIds };
}

export function scopeAllows(scope: SiteScope, siteId: string | null | undefined): boolean {
  if (scope.all) return true;
  return typeof siteId === "string" && scope.siteIds.includes(siteId);
}

/** Only the sites a member may see, in the given order. */
export function sitesInScope<T extends { id: string }>(scope: SiteScope, sites: readonly T[]): T[] {
  return scope.all ? sites.slice() : sites.filter((s) => scope.siteIds.includes(s.id));
}

/**
 * The site filter a member may use: a requested site inside their scope, else (limited members) their sites,
 * else (every site) no filter. `null` = the whole clinic.
 */
export function siteFilterFor(scope: SiteScope, requested: string | null | undefined): readonly string[] | null {
  if (requested && scopeAllows(scope, requested)) return [requested];
  return scope.all ? null : scope.siteIds;
}

/** One row of the roles overview: what each role may do. */
export interface RoleMatrixRow {
  permission: PmsPermission;
  label: string;
  roles: Record<PmsRole, boolean>;
}

export const PERMISSION_LABELS: Readonly<Record<PmsPermission, string>> = {
  "clinic.view": "Open the clinic system",
  "patients.view": "See patients' details",
  "patients.edit": "Register patients and change their details",
  "patients.export": "Download patient lists",
  "clinical.view": "Read clinical notes",
  "clinical.edit": "Write clinical notes",
  "clinical.sign": "Sign and lock clinical notes",
  "diary.view": "See the diary",
  "diary.book": "Book, move and cancel appointments",
  "diary.manage": "Set working hours and diary rules",
  "billing.view": "See invoices and payments",
  "billing.edit": "Raise invoices and record payments",
  "billing.manage": "Credit notes, write-offs and payer accounts",
  "messages.view": "See messages sent to patients",
  "messages.send": "Send messages and letters",
  "messages.manage": "Message templates and reminder rules",
  "booking.manage": "Online booking and forms settings",
  "reports.view": "See reports",
  "reports.export": "Download reports",
  "directory.edit": "Add referrers and payers",
  "settings.manage": "Clinic set-up, staff and the audit trail",
  "import.run": "Import data from an earlier system",
};

export function roleMatrix(permissions: readonly PmsPermission[], roles: readonly PmsRole[]): RoleMatrixRow[] {
  return permissions.map((permission) => ({
    permission,
    label: PERMISSION_LABELS[permission],
    roles: Object.fromEntries(roles.map((r) => [r, pmsCan(r, permission)])) as Record<PmsRole, boolean>,
  }));
}
