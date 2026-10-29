/** Names of a clinic's members (who shared a document, who verified a form) – only members of THIS clinic. */
import "server-only";
import type { DbContext } from "../../repos/context";

export async function memberNames(ctx: DbContext, tenantId: string, userIds: readonly string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(userIds.filter((id): id is string => typeof id === "string" && id.length > 0))).slice(0, 90);
  if (ids.length === 0) return new Map();
  const rows = await ctx.db
    .selectFrom("member")
    .innerJoin("user", "user.id", "member.userId")
    .innerJoin("organization", "organization.id", "member.organizationId")
    .select(["user.id as id", "user.name as name"])
    .where("organization.slug", "=", tenantId)
    .where("user.id", "in", ids)
    .execute();
  return new Map(rows.map((r) => [r.id, r.name]));
}
