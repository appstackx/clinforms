/**
 * Read models over Better Auth's tables plus our member_profile / clinic_profile (pure functions over a
 * Kysely instance, so tests and scripts use them too). Better Auth owns the writes to its tables.
 */
import type { Kysely } from "kysely";
import { authBool, type Database } from "../db/schema";
import { invitationIdFromToken } from "./invite-token";
import { parseMemberRole, type MemberRole } from "./roles";

export interface Membership {
  memberId: string;
  organizationId: string;
  /** = organization slug */
  tenantId: string;
  clinicName: string;
  role: MemberRole;
  joinedAt: string;
}

function toMembership(row: { id: string; organizationId: string; role: string; createdAt: string; slug: string; name: string }): Membership | null {
  const role = parseMemberRole(row.role);
  if (!role) return null;
  return {
    memberId: row.id,
    organizationId: row.organizationId,
    tenantId: row.slug,
    clinicName: row.name,
    role,
    joinedAt: row.createdAt,
  };
}

export async function findMembership(db: Kysely<Database>, organizationId: string, userId: string): Promise<Membership | null> {
  const row = await db
    .selectFrom("member")
    .innerJoin("organization", "organization.id", "member.organizationId")
    .select(["member.id", "member.organizationId", "member.role", "member.createdAt", "organization.slug", "organization.name"])
    .where("member.organizationId", "=", organizationId)
    .where("member.userId", "=", userId)
    .executeTakeFirst();
  return row ? toMembership(row) : null;
}

export async function listMemberships(db: Kysely<Database>, userId: string): Promise<Membership[]> {
  const rows = await db
    .selectFrom("member")
    .innerJoin("organization", "organization.id", "member.organizationId")
    .select(["member.id", "member.organizationId", "member.role", "member.createdAt", "organization.slug", "organization.name"])
    .where("member.userId", "=", userId)
    .orderBy("organization.name")
    .execute();
  return rows.map(toMembership).filter((m): m is Membership => m !== null);
}

export interface ClinicMemberView {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: MemberRole | null;
  joinedAt: string;
  twoFactorEnabled: boolean;
  jobTitle: string | null;
  hcpcNumber: string | null;
  canSign: boolean;
}

export async function listClinicMembers(db: Kysely<Database>, organizationId: string): Promise<ClinicMemberView[]> {
  const rows = await db
    .selectFrom("member")
    .innerJoin("user", "user.id", "member.userId")
    .leftJoin("member_profile", (join) =>
      join.onRef("member_profile.organization_id", "=", "member.organizationId").onRef("member_profile.user_id", "=", "member.userId"),
    )
    .select([
      "member.id as memberId",
      "member.userId as userId",
      "member.role as role",
      "member.createdAt as joinedAt",
      "user.name as name",
      "user.email as email",
      "user.twoFactorEnabled as twoFactorEnabled",
      "member_profile.job_title as jobTitle",
      "member_profile.hcpc_number as hcpcNumber",
      "member_profile.can_sign as canSign",
    ])
    .where("member.organizationId", "=", organizationId)
    .orderBy("user.name")
    .execute();
  return rows.map((r) => ({
    memberId: r.memberId,
    userId: r.userId,
    name: r.name,
    email: r.email,
    role: parseMemberRole(r.role),
    joinedAt: r.joinedAt,
    twoFactorEnabled: authBool(r.twoFactorEnabled),
    jobTitle: r.jobTitle ?? null,
    hcpcNumber: r.hcpcNumber ?? null,
    canSign: authBool(r.canSign),
  }));
}

export async function countMembers(db: Kysely<Database>, organizationId: string): Promise<number> {
  const row = await db
    .selectFrom("member")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("organizationId", "=", organizationId)
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}

export interface PendingInvitationView {
  id: string;
  email: string;
  role: MemberRole | null;
  expiresAt: string;
  createdAt: string;
}

export async function listPendingInvitations(db: Kysely<Database>, organizationId: string, now = new Date()): Promise<PendingInvitationView[]> {
  const rows = await db
    .selectFrom("invitation")
    .select(["id", "email", "role", "expiresAt", "createdAt"])
    .where("organizationId", "=", organizationId)
    .where("status", "=", "pending")
    .where("expiresAt", ">", now.toISOString())
    .orderBy("createdAt", "desc")
    .execute();
  return rows.map((r) => ({ id: r.id, email: r.email, role: parseMemberRole(r.role), expiresAt: r.expiresAt, createdAt: r.createdAt }));
}

export interface InvitationForAcceptance {
  id: string;
  email: string;
  role: MemberRole | null;
  expiresAt: string;
  organizationId: string;
  clinicName: string;
  tenantId: string;
  /** An account already exists for the invited address. */
  accountExists: boolean;
}

/**
 * An open (pending, unexpired) invitation by its ID, or null. Server-internal: an id is not a link secret –
 * anything that starts from a link token goes through findInvitationForLink().
 */
export async function findOpenInvitation(db: Kysely<Database>, invitationId: string, now = new Date()): Promise<InvitationForAcceptance | null> {
  if (typeof invitationId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(invitationId)) return null;
  const row = await db
    .selectFrom("invitation")
    .innerJoin("organization", "organization.id", "invitation.organizationId")
    .select(["invitation.id", "invitation.email", "invitation.role", "invitation.expiresAt", "invitation.organizationId", "organization.name", "organization.slug"])
    .where("invitation.id", "=", invitationId)
    .where("invitation.status", "=", "pending")
    .where("invitation.expiresAt", ">", now.toISOString())
    .executeTakeFirst();
  if (!row) return null;
  const user = await db.selectFrom("user").select("id").where("email", "=", row.email.toLowerCase()).executeTakeFirst();
  return {
    id: row.id,
    email: row.email,
    role: parseMemberRole(row.role),
    expiresAt: row.expiresAt,
    organizationId: row.organizationId,
    clinicName: row.name,
    tenantId: row.slug,
    accountExists: Boolean(user),
  };
}

/**
 * The open invitation an invitation LINK token (`<id>.<MAC>`, ./invite-token.ts) vouches for, or null when the
 * token is malformed, signed with another secret, or the invitation is no longer open.
 */
export async function findInvitationForLink(
  db: Kysely<Database>,
  secret: string,
  token: unknown,
  now = new Date(),
): Promise<InvitationForAcceptance | null> {
  const invitationId = invitationIdFromToken(secret, token);
  return invitationId ? findOpenInvitation(db, invitationId, now) : null;
}

export async function findUserByEmail(db: Kysely<Database>, email: string): Promise<{ id: string; name: string; email: string } | null> {
  const row = await db.selectFrom("user").select(["id", "name", "email"]).where("email", "=", email.trim().toLowerCase()).executeTakeFirst();
  return row ?? null;
}
