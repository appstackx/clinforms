/**
 * Cross-tenant housekeeping for the retention cron (/api/cron/retention). These are the ONLY repository
 * functions that are not tenant-scoped, and they only delete expired rows.
 */
import { assertIso, nowIso, type DbContext } from "./context";
import { purgeExpiredLaunchTokens } from "./launch-tokens";
import { purgeRateLimits } from "./rate-limits";

/** Deletes every report whose delete_after has passed. Returns the number deleted. */
export async function purgeExpiredReports(ctx: DbContext, now: string = nowIso(ctx)): Promise<number> {
  const result = await ctx.db
    .deleteFrom("reports")
    .where("delete_after", "is not", null)
    .where("delete_after", "<", assertIso(now, "now"))
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}

export interface RetentionResult {
  reports: number;
  launchTokens: number;
  rateLimits: number;
}

/** The whole retention pass: expired reports, launch-token claims, and rate-limit windows older than a day. */
export async function runRetention(ctx: DbContext): Promise<RetentionResult> {
  const now = nowIso(ctx);
  const dayAgo = new Date(Date.parse(now) - 86_400_000).toISOString();
  return {
    reports: await purgeExpiredReports(ctx, now),
    launchTokens: await purgeExpiredLaunchTokens(ctx, now),
    rateLimits: await purgeRateLimits(ctx, dayAgo),
  };
}
