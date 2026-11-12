/**
 * GET /api/cron/retention – the daily retention pass (vercel.json "crons"). Authorised by
 * `Authorization: Bearer $CRON_SECRET` (Vercel sends it when CRON_SECRET is set); refuses everything when
 * CRON_SECRET is unset. Logic and tests: src/server/cron/retention.ts.
 *
 * 01/11/2026: after a successful retention pass the same daily run bills extra reports that a webhook missed and
 * invoices yearly plans' extras (src/server/billing/extras.ts billExtrasFromCron) – one cron (Vercel Hobby).
 *
 * 12/11/2026 (PK06): an authorised run (the retention pass done or failed) also expires courses and gift cards past
 * their expiry date (src/server/cron/expiry.ts) – idempotent, so a retried run changes nothing more.
 */
import "server-only";
import { getDb } from "@/server/db";
import { handleRetentionCron } from "@/server/cron/retention";
import { billExtrasFromCron } from "@/server/billing/extras";
import { subscriptionPaymentsFromEnv } from "@/server/billing/payments";
import { expirySweepFromCron } from "@/server/cron/expiry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  const res = await handleRetentionCron(req, { secret: process.env.CRON_SECRET, ctx: () => ({ db: getDb() }) });
  // 200 / 500 = the call was authorised (401 / 503 never reach the database).
  if (res.status === 200 || res.status === 500) await expirySweepFromCron({ db: getDb() });
  if (res.status === 200) {
    const p = subscriptionPaymentsFromEnv();
    if (p.ok) {
      try {
        console.info(JSON.stringify({ event: "cron.billing_extras.done", ...(await billExtrasFromCron({ db: getDb() }, p.payments)) }));
      } catch (err) {
        console.warn(JSON.stringify({ event: "cron.billing_extras.failed", error: err instanceof Error ? err.name : "error" }));
      }
    }
  }
  return res;
}
