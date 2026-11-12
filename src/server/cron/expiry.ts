/**
 * PK06: the nightly expiry sweep of courses and gift cards (src/server/repos/pms/billing/expiry.ts), run by the daily
 * cron GET /api/cron/retention after the retention pass has been authorised (Vercel Hobby has one daily cron; the
 * billing extras ride on it the same way). Logs counts only – never a clinic's data.
 */
import type { DbContext } from "../repos/context";
import { runExpirySweep, type ExpiryRunResult } from "../repos/pms/billing/expiry";

export async function expirySweepFromCron(ctx: DbContext, log: (event: string, detail: Record<string, unknown>) => void = (event, detail) => console.info(JSON.stringify({ event, ...detail }))): Promise<ExpiryRunResult | null> {
  try {
    const r = await runExpirySweep(ctx, { onError: (_tenant, err) => log("cron.expiry.clinic_failed", { error: err instanceof Error ? err.name : "error" }) });
    log("cron.expiry.done", { ...r });
    return r;
  } catch (err) {
    log("cron.expiry.failed", { error: err instanceof Error ? err.name : "error" });
    return null;
  }
}
