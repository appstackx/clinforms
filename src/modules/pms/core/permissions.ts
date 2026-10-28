/**
 * What each clinic member may do in the clinic system. Pure (no Better Auth import): the roles are ClinForms' own
 * (src/server/auth/roles.ts MEMBER_ROLES), mirrored here as strings so this file stays browser-safe.
 *
 * The permission list is the "Roles and permissions" grid (design round 2, 28/10/2026 –
 * docs/clinic-system/design/round2/roles-and-permissions): 26 permissions in 7 groups, each with a default per role.
 * A clinic can change a role's defaults (clinic role overrides) and give one member more or less (member
 * exceptions). The EFFECTIVE permission of a member is, in this order:
 *
 *   role default  →  the clinic's override for the role  →  the member's own exception  →  locks (always win)
 *
 * Locks can never be changed by any stored row (the server also refuses and audits a request to change one):
 *   - the owner always has every permission;
 *   - only the owner can change the owner ("settings.owner" is never granted to another role);
 *   - reception (ClinForms role "staff") can never get a clinical permission or "create clinical letters".
 *
 * Old permission ids (the fixed list of the first build, still used by module branches not merged yet) stay valid
 * as ALIASES: `can("clinical.sign")` asks for "clinical.write", `can("settings.manage")` for "settings.setup" and so
 * on (LEGACY_ALIASES). "clinic.view" is granted to every active member of a known role.
 */

export const PMS_ROLES = ["owner", "admin", "clinician", "staff"] as const;
export type PmsRole = (typeof PMS_ROLES)[number];

/** The roles' names on screen (ClinForms' "staff" is "Reception" in the clinic system). */
export const PMS_ROLE_LABELS: Readonly<Record<PmsRole, string>> = { owner: "Owner", admin: "Admin", clinician: "Clinician", staff: "Reception" };

/** One line about each role (member access role cards). */
export const PMS_ROLE_DESCRIPTIONS: Readonly<Record<PmsRole, string>> = {
  owner: "Everything, including ownership.",
  admin: "Runs the clinics. No clinical writing by default.",
  clinician: "Diary, patients, clinical notes. Billing read-only.",
  staff: "Diary, patient details, billing, messages. No clinical notes.",
};

export const ACCESS_GROUPS = ["Diary", "Patients", "Clinical", "Billing", "Messages", "Reports", "Settings"] as const;
export type AccessGroup = (typeof ACCESS_GROUPS)[number];

export interface AccessPermissionDef {
  id: string;
  group: AccessGroup;
  /** The grid's label ("Book, move and cancel appointments"). */
  label: string;
  /** A second line under the label, or "". */
  hint: string;
  /** As a verb phrase for "What X can do" ("book, move and cancel appointments"). */
  phrase: string;
  /** Defaults: [owner, admin, clinician, reception]. */
  defaults: readonly [boolean, boolean, boolean, boolean];
}

const Y = true;
const N = false;

/** The grid, in its order. Ids are stable (stored in the database) – never rename one. */
export const ACCESS_PERMISSION_DEFS = [
  { id: "diary.view", group: "Diary", label: "View the diary", hint: "", phrase: "view the diary", defaults: [Y, Y, Y, Y] },
  { id: "diary.book", group: "Diary", label: "Book, move and cancel appointments", hint: "", phrase: "book, move and cancel appointments", defaults: [Y, Y, Y, Y] },
  { id: "diary.override", group: "Diary", label: "Override clashes", hint: "Double-book a practitioner or room", phrase: "override diary clashes", defaults: [Y, Y, N, N] },
  { id: "diary.rota", group: "Diary", label: "Edit rotas and the waiting list", hint: "", phrase: "edit rotas and the waiting list", defaults: [Y, Y, N, Y] },
  { id: "patients.view", group: "Patients", label: "View patient details and contacts", hint: "", phrase: "view patient details and contacts", defaults: [Y, Y, Y, Y] },
  { id: "patients.edit", group: "Patients", label: "Create and edit patients", hint: "", phrase: "create and edit patients", defaults: [Y, Y, Y, Y] },
  {
    id: "patients.referral",
    group: "Patients",
    label: "See referral reason and case notes",
    hint: "Referral letter text and the case summary – not clinical notes",
    phrase: "see referral reasons and case notes",
    defaults: [Y, Y, Y, Y],
  },
  { id: "patients.merge", group: "Patients", label: "Merge or archive patients", hint: "", phrase: "merge or archive patients", defaults: [Y, Y, N, N] },
  { id: "clinical.view", group: "Clinical", label: "See clinical notes and outcomes", hint: "", phrase: "see clinical notes and outcomes", defaults: [Y, Y, Y, N] },
  { id: "clinical.write", group: "Clinical", label: "Write and sign notes", hint: "Needs a registration number on the member’s profile", phrase: "write and sign clinical notes", defaults: [Y, N, Y, N] },
  { id: "clinical.amend", group: "Clinical", label: "Amend signed notes", hint: "Own notes only for clinicians", phrase: "amend signed clinical notes", defaults: [Y, N, Y, N] },
  { id: "billing.view", group: "Billing", label: "View invoices and payments", hint: "", phrase: "view invoices and payments", defaults: [Y, Y, Y, Y] },
  { id: "billing.edit", group: "Billing", label: "Create and edit invoices", hint: "", phrase: "create and edit invoices", defaults: [Y, Y, N, Y] },
  { id: "billing.pay", group: "Billing", label: "Take payments", hint: "Card, cash, bank transfer and payment links", phrase: "take payments", defaults: [Y, Y, N, Y] },
  { id: "billing.refund", group: "Billing", label: "Refunds and credit notes", hint: "", phrase: "give refunds and credit notes", defaults: [Y, Y, N, N] },
  { id: "billing.void", group: "Billing", label: "Void invoices", hint: "", phrase: "void invoices", defaults: [Y, Y, N, N] },
  { id: "messages.send", group: "Messages", label: "Send messages and reply to patients", hint: "", phrase: "send messages and reply to patients", defaults: [Y, Y, Y, Y] },
  { id: "messages.templates", group: "Messages", label: "Edit message templates", hint: "", phrase: "edit message templates", defaults: [Y, Y, N, N] },
  { id: "messages.letters", group: "Messages", label: "Create clinical letters", hint: "", phrase: "create clinical letters", defaults: [Y, Y, Y, N] },
  { id: "reports.own", group: "Reports", label: "See reports for own caseload", hint: "", phrase: "see reports for their own caseload", defaults: [Y, Y, Y, N] },
  { id: "reports.all", group: "Reports", label: "View all reports", hint: "", phrase: "view all reports", defaults: [Y, Y, N, N] },
  { id: "reports.export", group: "Reports", label: "Export data", hint: "CSV downloads from reports and lists", phrase: "export data", defaults: [Y, N, N, N] },
  { id: "settings.setup", group: "Settings", label: "Change set-up", hint: "Sites, services, prices, templates", phrase: "change set-up", defaults: [Y, Y, N, N] },
  { id: "settings.members", group: "Settings", label: "Manage members and permissions", hint: "", phrase: "manage members and permissions", defaults: [Y, Y, N, N] },
  { id: "settings.import", group: "Settings", label: "Import data", hint: "", phrase: "import data", defaults: [Y, Y, N, N] },
  { id: "settings.owner", group: "Settings", label: "Change the owner", hint: "", phrase: "change the owner", defaults: [Y, N, N, N] },
] as const satisfies readonly AccessPermissionDef[];

export type AccessPermission = (typeof ACCESS_PERMISSION_DEFS)[number]["id"];
export const ACCESS_PERMISSIONS: readonly AccessPermission[] = ACCESS_PERMISSION_DEFS.map((d) => d.id);

/** Every active member of a known role has it (it opens the clinic area); not configurable. */
export const BASE_PERMISSION = "clinic.view" as const;

/**
 * Old ids → the grid's permission they now mean. Kept so code written against the first fixed list (and the
 * module branches not merged yet) keeps working; new code uses the grid's ids.
 */
export const LEGACY_ALIASES = {
  "patients.export": "reports.export",
  "clinical.edit": "clinical.write",
  "clinical.sign": "clinical.write",
  "diary.manage": "diary.rota",
  "billing.manage": "billing.refund",
  "messages.view": "messages.send",
  "messages.manage": "messages.templates",
  "booking.manage": "settings.setup",
  "reports.view": "reports.all",
  "directory.edit": "settings.setup",
  "settings.manage": "settings.setup",
  "import.run": "settings.import",
} as const satisfies Readonly<Record<string, AccessPermission>>;
export type LegacyPermission = keyof typeof LEGACY_ALIASES;

/** Every id `can()` accepts: the base permission, the grid's permissions and the old aliases. */
export const PMS_PERMISSIONS = [BASE_PERMISSION, ...ACCESS_PERMISSIONS, ...(Object.keys(LEGACY_ALIASES) as LegacyPermission[])] as const;
export type PmsPermission = typeof BASE_PERMISSION | AccessPermission | LegacyPermission;
export type GrantedPermission = typeof BASE_PERMISSION | AccessPermission;

const DEFS_BY_ID: ReadonlyMap<string, AccessPermissionDef> = new Map(ACCESS_PERMISSION_DEFS.map((d) => [d.id, d]));
const ROLE_INDEX: Readonly<Record<PmsRole, 0 | 1 | 2 | 3>> = { owner: 0, admin: 1, clinician: 2, staff: 3 };

export function isPmsRole(value: unknown): value is PmsRole {
  return typeof value === "string" && (PMS_ROLES as readonly string[]).includes(value);
}

export function isAccessPermission(value: unknown): value is AccessPermission {
  return typeof value === "string" && DEFS_BY_ID.has(value);
}

export function isPmsPermission(value: unknown): value is PmsPermission {
  return typeof value === "string" && (PMS_PERMISSIONS as readonly string[]).includes(value);
}

export function accessPermissionDef(id: AccessPermission): AccessPermissionDef {
  return DEFS_BY_ID.get(id)!;
}

/** The grid permission an id stands for ("clinic.view" stays itself). */
export function resolvePermission(permission: PmsPermission): GrantedPermission {
  return Object.prototype.hasOwnProperty.call(LEGACY_ALIASES, permission) ? LEGACY_ALIASES[permission as LegacyPermission] : (permission as GrantedPermission);
}

export const LOCK_REASONS = {
  owner: "Owner always has full access",
  ownerOnly: "Only the owner can change the owner",
  noClinical: "Reception can never see clinical note content",
} as const;

/** Reception's permissions that are locked off: every clinical permission and clinical letters. */
const RECEPTION_NEVER: ReadonlySet<AccessPermission> = new Set<AccessPermission>(["clinical.view", "clinical.write", "clinical.amend", "messages.letters"]);

export interface AccessLock {
  /** What the cell always is. */
  value: boolean;
  reason: string;
}

/** The lock on a (role, permission) cell, or null when the clinic may change it. */
export function lockOf(role: PmsRole, permission: AccessPermission): AccessLock | null {
  if (role === "owner") return { value: true, reason: LOCK_REASONS.owner };
  if (permission === "settings.owner") return { value: false, reason: LOCK_REASONS.ownerOnly };
  if (role === "staff" && RECEPTION_NEVER.has(permission)) return { value: false, reason: LOCK_REASONS.noClinical };
  return null;
}

/** The design's default for a cell (before any clinic override). */
export function roleDefault(role: PmsRole, permission: AccessPermission): boolean {
  return DEFS_BY_ID.get(permission)!.defaults[ROLE_INDEX[role]];
}

export type PermissionChoices = Readonly<Partial<Record<string, boolean>>>;

export interface EffectiveInput {
  role: string | null | undefined;
  /** The clinic's overrides for this role (permission → allowed). Unknown ids are ignored. */
  roleOverrides?: PermissionChoices;
  /** This member's own exceptions (permission → allowed). Unknown ids are ignored. */
  exceptions?: PermissionChoices;
  /** False when the member's clinic-system access is switched off (Deactivate): nothing at all. */
  active?: boolean;
}

/** What the role grants at this clinic (default → clinic override → lock). */
export function rolePermission(role: PmsRole, permission: AccessPermission, roleOverrides: PermissionChoices = {}): boolean {
  const lock = lockOf(role, permission);
  if (lock) return lock.value;
  const o = roleOverrides[permission];
  return typeof o === "boolean" ? o : roleDefault(role, permission);
}

/**
 * The member's effective permissions: role default → clinic override → member exception, then the locks. Includes
 * "clinic.view" for an active member of a known role; empty for an unknown role or a deactivated member.
 */
export function effectivePermissions(input: EffectiveInput): ReadonlySet<GrantedPermission> {
  const out = new Set<GrantedPermission>();
  const role = input.role;
  if (!isPmsRole(role) || input.active === false) return out;
  out.add(BASE_PERMISSION);
  for (const p of ACCESS_PERMISSIONS) {
    const lock = lockOf(role, p);
    let on: boolean;
    if (lock) on = lock.value;
    else {
      const ex = input.exceptions?.[p];
      on = typeof ex === "boolean" ? ex : rolePermission(role, p, input.roleOverrides);
    }
    if (on) out.add(p);
  }
  return out;
}

/** A `can(permission)` over an effective set (old ids resolve through LEGACY_ALIASES). */
export function canWith(granted: ReadonlySet<string>): (permission: PmsPermission) => boolean {
  return (permission) => granted.has(resolvePermission(permission));
}

/** Whether a role grants a permission BY DEFAULT (no clinic override, no exception). Unknown roles grant nothing. */
export function pmsCan(role: string | null | undefined, permission: PmsPermission): boolean {
  return canWith(effectivePermissions({ role }))(permission);
}

/** Every permission a role has by default ("clinic.view" and the grid's ids) – for the shell and tests. */
export function pmsPermissionsOf(role: string | null | undefined): GrantedPermission[] {
  return Array.from(effectivePermissions({ role }));
}

/**
 * Amending a signed note: needs "clinical.amend"; a clinician may amend only notes they wrote or signed – owners and
 * admins holding the permission may amend anyone's ("Own notes only for clinicians").
 */
export function mayAmendNote(role: string | null | undefined, can: (permission: PmsPermission) => boolean, ownNote: boolean): boolean {
  if (!can("clinical.amend")) return false;
  return ownNote || role === "owner" || role === "admin";
}
