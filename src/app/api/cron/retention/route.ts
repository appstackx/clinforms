/**
 * GET /api/cron/retention – the daily retention pass (vercel.json "crons"). Authorised by
 * `Authorization: Bearer $CRON_SECRET` (Vercel sends it when CRON_SECRET is set); refuses everything when
 * CRON_SECRET is unset. Logic and tests: src/server/cron/retention.ts.
 */
import "server-only";
import { getDb } from "@/server/db";
import { handleRetentionCron } from "@/server/cron/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  return handleRetentionCron(req, { secret: process.env.CRON_SECRET, ctx: () => ({ db: getDb() }) });
}
