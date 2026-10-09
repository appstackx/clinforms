/**
 * `member_profile` – the signer identity (job title, HCPC number, may sign) of a member of an organization.
 * Scoped by organizationId (the Better Auth organization behind the tenant), passed explicitly.
 */
import { assertId, flag, nowIso, optionalText, toBool, type RepoContext } from "./context";

export interface MemberProfile {
  organizationId: string;
  userId: string;
  jobTitle: string | null;
  hcpcNumber: string | null;
  canSign: boolean;
  updatedAt: string;
}

export interface MemberProfileInput {
  jobTitle?: string | null;
  hcpcNumber?: string | null;
  canSign?: boolean;
}

function toProfile(row: {
  organization_id: string;
  user_id: string;
  job_title: string | null;
  hcpc_number: string | null;
  can_sign: number;
  updated_at: string;
}): MemberProfile {
  return {
    organizationId: row.organization_id,
    userId: row.user_id,
    jobTitle: row.job_title,
    hcpcNumber: row.hcpc_number,
    canSign: toBool(row.can_sign),
    updatedAt: row.updated_at,
  };
}

export async function getMemberProfile(ctx: RepoContext, organizationId: string, userId: string): Promise<MemberProfile | null> {
  assertId(organizationId, "organizationId");
  assertId(userId, "userId");
  const row = await ctx.db
    .selectFrom("member_profile")
    .selectAll()
    .where("organization_id", "=", organizationId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return row ? toProfile(row) : null;
}

export async function listMemberProfiles(ctx: RepoContext, organizationId: string): Promise<MemberProfile[]> {
  assertId(organizationId, "organizationId");
  const rows = await ctx.db
    .selectFrom("member_profile")
    .selectAll()
    .where("organization_id", "=", organizationId)
    .orderBy("user_id")
    .execute();
  return rows.map(toProfile);
}

export async function upsertMemberProfile(
  ctx: RepoContext,
  organizationId: string,
  userId: string,
  input: MemberProfileInput,
): Promise<MemberProfile> {
  assertId(organizationId, "organizationId");
  assertId(userId, "userId");
  const values = {
    job_title: optionalText(input.jobTitle, "jobTitle", 120),
    hcpc_number: optionalText(input.hcpcNumber, "hcpcNumber", 32),
    can_sign: flag(input.canSign ?? false),
    updated_at: nowIso(ctx),
  };
  await ctx.db
    .insertInto("member_profile")
    .values({ organization_id: organizationId, user_id: userId, ...values })
    .onConflict((oc) => oc.columns(["organization_id", "user_id"]).doUpdateSet(values))
    .execute();
  return { organizationId, userId, jobTitle: values.job_title, hcpcNumber: values.hcpc_number, canSign: values.can_sign === 1, updatedAt: values.updated_at };
}

export async function deleteMemberProfile(ctx: RepoContext, organizationId: string, userId: string): Promise<boolean> {
  assertId(organizationId, "organizationId");
  assertId(userId, "userId");
  const result = await ctx.db
    .deleteFrom("member_profile")
    .where("organization_id", "=", organizationId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return Number(result.numDeletedRows) > 0;
}
