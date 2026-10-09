/**
 * Cross-tenant housekeeping for the retention cron (/api/cron/retention, src/app/api/cron/retention/route.ts).
 * These are the ONLY repository functions that are not tenant-scoped, and they only delete expired rows.
 *
 * Report retention: a report is deleted once it has not changed for the clinic's retention period
 * (clinic_profile.retention_days, Settings → Clinic) – read at purge time, so a changed setting applies to
 * every existing report on the next run – or earlier, once its own explicit `delete_after` has passed.
 */
import { assertIso, nowIso, type DbContext } from "./context";
import { purgeExpiredLaunchTokens } from "./launch-tokens";
import { purgeRateLimits } from "./rate-limits";

const DAY_MS = 86_400_000;
/** "Request access" submissions are kept up to 24 months (privacy policy). */
export const ACCESS_REQUEST_RETENTION_DAYS = 730;

function daysBefore(nowIsoValue: string, days: number): string {
  return new Date(Date.parse(nowIsoValue) - days * DAY_MS).toISOString();
}

/**
 * Deletes every report past its explicit delete_after, and every report of a clinic that has not been updated
 * within that clinic's retention period. Returns the number deleted.
 */
export async function purgeExpiredReports(ctx: DbContext, now: string = nowIso(ctx)): Promise<number> {
  assertIso(now, "now");
  const explicit = await ctx.db.deleteFrom("reports").where("delete_after", "is not", null).where("delete_after", "<", now).executeTakeFirst();
  let deleted = Number(explicit.numDeletedRows);
  const clinics = await ctx.db.selectFrom("clinic_profile").select(["tenant_id", "retention_days"]).execute();
  for (const clinic of clinics) {
    const days = Number(clinic.retention_days);
    if (!Number.isInteger(days) || days < 1) continue; // never purge on a malformed setting
    const result = await ctx.db
      .deleteFrom("reports")
      .where("tenant_id", "=", clinic.tenant_id)
      .where("updated_at", "<", daysBefore(now, days))
      .executeTakeFirst();
    deleted += Number(result.numDeletedRows);
  }
  return deleted;
}

/** Deletes "Request access" submissions older than ACCESS_REQUEST_RETENTION_DAYS. */
export async function purgeOldAccessRequests(ctx: DbContext, now: string = nowIso(ctx)): Promise<number> {
  const result = await ctx.db
    .deleteFrom("access_requests")
    .where("created_at", "<", daysBefore(assertIso(now, "now"), ACCESS_REQUEST_RETENTION_DAYS))
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}

export interface RetentionResult {
  reports: number;
  launchTokens: number;
  rateLimits: number;
  accessRequests: number;
}

/**
 * The whole retention pass: expired reports, launch-token claims, rate-limit windows older than a day and old
 * access requests.
 */
export async function runRetention(ctx: DbContext): Promise<RetentionResult> {
  const now = nowIso(ctx);
  return {
    reports: await purgeExpiredReports(ctx, now),
    launchTokens: await purgeExpiredLaunchTokens(ctx, now),
    rateLimits: await purgeRateLimits(ctx, daysBefore(now, 1)),
    accessRequests: await purgeOldAccessRequests(ctx, now),
  };
}
