/**
 * PK06: the nightly expiry sweep of courses and gift cards (src/server/repos/pms/billing/expiry.ts), run by the daily
 * cron GET /api/cron/retention after the retention pass has been authorised (Vercel Hobby has one daily cron; the
 * billing extras ride on it the same way, BEFORE this sweep). Has a time budget (EXPIRY_RUN_BUDGET_MS): what is left
 * waits for the next night, and the log says `stoppedEarly`. Logs counts only – never a clinic's data. Never throws.
 */
import type { DbContext } from "../repos/context";
import { runExpirySweep, type ExpiryRunResult } from "../repos/pms/billing/expiry";

export async function expirySweepFromCron(
  ctx: DbContext | (() => DbContext),
  log: (event: string, detail: Record<string, unknown>) => void = (event, detail) => console.info(JSON.stringify({ event, ...detail })),
  options: { budgetMs?: number; nowMs?: () => number } = {},
): Promise<ExpiryRunResult | null> {
  try {
    // A factory is opened inside the try: a database that cannot be reached is logged, never thrown at the route.
    const db = typeof ctx === "function" ? ctx() : ctx;
    const r = await runExpirySweep(db, { ...options, onError: (_tenant, err) => log("cron.expiry.clinic_failed", { error: err instanceof Error ? err.name : "error" }) });
    log("cron.expiry.done", { ...r });
    return r;
  } catch (err) {
    log("cron.expiry.failed", { error: err instanceof Error ? err.name : "error" });
    return null;
  }
}

/**
 * What the daily cron runs after the retention pass, in this order: the billing extras (only when the pass succeeded,
 * 200), then the expiry sweep (200 or 500 – the call was authorised), then (13/11/2026) the self-serve trial emails
 * (200 or 500; no-op without self-serve trials – src/server/trial/emails.ts). Each step is caught on its own, so the
 * route always returns the retention pass's response.
 */
export async function afterRetentionCron(status: number, steps: { billingExtras: () => Promise<void>; expirySweep: () => Promise<unknown>; trialEmails?: () => Promise<unknown> }, warn: (event: string, detail: Record<string, unknown>) => void = (event, detail) => console.warn(JSON.stringify({ event, ...detail }))): Promise<void> {
  if (status === 200) {
    try {
      await steps.billingExtras();
    } catch (err) {
      warn("cron.billing_extras.failed", { error: err instanceof Error ? err.name : "error" });
    }
  }
  if (status === 200 || status === 500) {
    try {
      await steps.expirySweep();
    } catch (err) {
      warn("cron.expiry.failed", { error: err instanceof Error ? err.name : "error" });
    }
    if (steps.trialEmails) {
      try {
        await steps.trialEmails();
      } catch (err) {
        warn("cron.trial_emails.failed", { error: err instanceof Error ? err.name : "error" });
      }
    }
  }
}
