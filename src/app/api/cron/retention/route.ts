/**
 * GET /api/cron/retention – the daily retention pass (vercel.json "crons"). Authorised by
 * `Authorization: Bearer $CRON_SECRET` (Vercel sends it when CRON_SECRET is set); refuses everything when
 * CRON_SECRET is unset. Logic and tests: src/server/cron/retention.ts.
 *
 * 01/11/2026: after a successful retention pass the same daily run bills extra reports that a webhook missed and
 * invoices yearly plans' extras (src/server/billing/extras.ts billExtrasFromCron) – one cron (Vercel Hobby).
 *
 * 12/11/2026 (PK06): an authorised run (the retention pass done or failed) also expires courses and gift cards past
 * their expiry date (src/server/cron/expiry.ts) – idempotent, so a retried run changes nothing more. Order: retention,
 * then the billing extras (money owed to us first), then the sweep with its own time budget (~20 s; the rest the next
 * night). 13/11/2026: then the self-serve free trial's emails (own time budget ~15 s). 14/11/2026: then – only after a
 * successful retention pass – the unpaid trials' deletion warnings and deletions (90 days after the end, 14 days'
 * notice; own budget ~10 s, at most 10 clinics a night – src/server/trial/retention.ts). Nothing after the retention
 * pass can throw: the route always returns the retention pass's response.
 */
import "server-only";
import { getDb } from "@/server/db";
import { handleRetentionCron } from "@/server/cron/retention";
import { billExtrasFromCron } from "@/server/billing/extras";
import { subscriptionPaymentsFromEnv } from "@/server/billing/payments";
import { afterRetentionCron, expirySweepFromCron } from "@/server/cron/expiry";
import { runTrialEmailSweep } from "@/server/trial/emails";
import { runTrialRetentionSweep } from "@/server/trial/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  const res = await handleRetentionCron(req, { secret: process.env.CRON_SECRET, ctx: () => ({ db: getDb() }) });
  // 200 / 500 = the call was authorised (401 / 503 never reach the database). On a 500 the database itself may be what
  // failed: getDb() is opened inside each step's own try, so the response below is always returned.
  await afterRetentionCron(res.status, {
    billingExtras: async () => {
      const p = subscriptionPaymentsFromEnv();
      if (p.ok) console.info(JSON.stringify({ event: "cron.billing_extras.done", ...(await billExtrasFromCron({ db: getDb() }, p.payments)) }));
    },
    expirySweep: () => expirySweepFromCron(() => ({ db: getDb() })),
    // 13/11/2026: the self-serve free trial's emails (UK days; each claimed once per clinic – src/server/trial/emails.ts).
    trialEmails: async () => console.info(JSON.stringify({ event: "cron.trial_emails.done", ...(await runTrialEmailSweep(getDb(), { budgetMs: 15_000 })) })),
    // 14/11/2026: unpaid self-serve trials – the warning 14 days before, the deletion 90 days after the end.
    trialRetention: async () => console.info(JSON.stringify({ event: "cron.trial_retention.done", ...(await runTrialRetentionSweep(getDb(), { budgetMs: 10_000, maxDeletions: 10 })) })),
  });
  return res;
}
