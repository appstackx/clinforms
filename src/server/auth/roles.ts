/**
 * Clinic roles and what each may do (Better Auth organization plugin access control).
 *
 *   owner     – everything below, and the only role that may make or change another owner
 *   admin     – clinic settings, members and invitations, API keys, audit trail
 *   clinician – clinical work (wave 2: create reports, approve when the member profile says "can sign")
 *   staff     – clinical admin work (wave 2: create reports, never approve)
 *
 * The organization plugin's own statements (organization / member / invitation) drive its endpoints; the
 * others (clinic, apiKey, audit, report) are checked by our server code with `roleCan()`.
 * Better Auth's built-in "member" role is NOT a ClinForms role: hooks in create-auth.ts refuse it.
 */
import { createAccessControl } from "better-auth/plugins/access";

export const MEMBER_ROLES = ["owner", "admin", "clinician", "staff"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const statements = {
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  clinic: ["update"],
  apiKey: ["create", "revoke"],
  audit: ["read"],
  report: ["create", "sign"],
} as const;

export const accessControl = createAccessControl(statements);

const manage = {
  organization: ["update"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  clinic: ["update"],
  apiKey: ["create", "revoke"],
  audit: ["read"],
  report: ["create", "sign"],
} as const;

export const roles = {
  owner: accessControl.newRole(manage),
  admin: accessControl.newRole(manage),
  clinician: accessControl.newRole({ report: ["create", "sign"] }),
  staff: accessControl.newRole({ report: ["create"] }),
};

export function isMemberRole(value: unknown): value is MemberRole {
  return typeof value === "string" && (MEMBER_ROLES as readonly string[]).includes(value);
}

/** Better Auth stores roles as a comma-separated string; ClinForms members always hold exactly one. */
export function parseMemberRole(value: unknown): MemberRole | null {
  if (typeof value !== "string") return null;
  const parts = value.split(",").map((r) => r.trim()).filter(Boolean);
  return parts.length === 1 && isMemberRole(parts[0]) ? parts[0] : null;
}

type Statements = typeof statements;
export type Permission = { [K in keyof Statements]?: Statements[K][number][] };

/** Whether a role grants every listed permission (server-side checks for our own statements). */
export function roleCan(role: MemberRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  const result = roles[role].authorize(permission as never);
  return result.success === true;
}

/** Roles a member with `actor` role may give to others (invite or change to). */
export function assignableRoles(actor: MemberRole): MemberRole[] {
  if (actor === "owner") return ["owner", "admin", "clinician", "staff"];
  if (actor === "admin") return ["admin", "clinician", "staff"];
  return [];
}

export function isManager(role: MemberRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}
