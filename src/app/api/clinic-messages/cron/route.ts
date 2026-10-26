/**
 * GET /api/clinic-messages/cron – the clinic system's message run: sends the planned appointment messages that
 * are due (outbox by default). `Authorization: Bearer $CRON_SECRET`; refuses everything without CRON_SECRET.
 * Logic and tests: src/server/pms/comms/cron.ts. Schedule (vercel.json): not added on this branch – see
 * docs/clinic-system/comms.md.
 */
import "server-only";
import { getDataCipher } from "@/server/crypto";
import { getDb } from "@/server/db";
import { handleCommsCron } from "@/server/pms/comms/cron";
import { dispatchDepsFromEnv } from "@/server/pms/comms/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  return handleCommsCron(req, { secret: process.env.CRON_SECRET, ctx: () => ({ db: getDb(), cipher: getDataCipher() }), dispatch: () => dispatchDepsFromEnv() });
}
