/**
 * What each clinic role may do in the clinic system. Pure (no Better Auth import): the roles are ClinForms' own
 * (src/server/auth/roles.ts MEMBER_ROLES), mirrored here as strings so this file stays browser-safe.
 *
 *   owner / admin – everything, including set-up (sites, rooms, services, prices, practitioners), exports, imports
 *   clinician     – patients, clinical notes (read, write, sign), diary, messages; billing read-only
 *   staff         – reception: patients (demographics, contacts, consent), diary, billing, messages;
 *                   NO clinical notes
 *
 * The list is complete for the one-week build (contract §6): a module that needs a permission not listed here
 * asks the orchestrator instead of editing this file.
 */

export const PMS_ROLES = ["owner", "admin", "clinician", "staff"] as const;
export type PmsRole = (typeof PMS_ROLES)[number];

export const PMS_PERMISSIONS = [
  "clinic.view",
  "patients.view",
  "patients.edit",
  "patients.export",
  "clinical.view",
  "clinical.edit",
  "clinical.sign",
  "diary.view",
  "diary.book",
  "diary.manage",
  "billing.view",
  "billing.edit",
  "billing.manage",
  "messages.view",
  "messages.send",
  "messages.manage",
  "booking.manage",
  "reports.view",
  "reports.export",
  "directory.edit",
  "settings.manage",
  "import.run",
] as const;
export type PmsPermission = (typeof PMS_PERMISSIONS)[number];

const ALL: readonly PmsPermission[] = PMS_PERMISSIONS;

const MATRIX: Readonly<Record<PmsRole, readonly PmsPermission[]>> = {
  owner: ALL,
  admin: ALL,
  clinician: [
    "clinic.view",
    "patients.view",
    "patients.edit",
    "clinical.view",
    "clinical.edit",
    "clinical.sign",
    "diary.view",
    "diary.book",
    "billing.view",
    "messages.view",
    "messages.send",
    "directory.edit",
  ],
  staff: [
    "clinic.view",
    "patients.view",
    "patients.edit",
    "diary.view",
    "diary.book",
    "billing.view",
    "billing.edit",
    "messages.view",
    "messages.send",
    "directory.edit",
  ],
};

export function isPmsRole(value: unknown): value is PmsRole {
  return typeof value === "string" && (PMS_ROLES as readonly string[]).includes(value);
}

export function isPmsPermission(value: unknown): value is PmsPermission {
  return typeof value === "string" && (PMS_PERMISSIONS as readonly string[]).includes(value);
}

/** Whether a role grants a permission. Unknown roles grant nothing. */
export function pmsCan(role: string | null | undefined, permission: PmsPermission): boolean {
  if (!isPmsRole(role)) return false;
  return MATRIX[role].includes(permission);
}

/** Every permission of a role (for the shell and tests). */
export function pmsPermissionsOf(role: string | null | undefined): PmsPermission[] {
  return isPmsRole(role) ? Array.from(MATRIX[role]) : [];
}
