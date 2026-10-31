/**
 * GET /api/clinic-messages/cron – the clinic system's message run: sends the planned appointment messages that are
 * due, for every clinic with the clinic system on (outbox by default; a test service when CLINIC_*_PROVIDER=test –
 * nothing reaches a patient in this build). `Authorization: Bearer $CRON_SECRET`; refuses everything without
 * CRON_SECRET. Logic and tests: src/server/pms/comms/cron.ts.
 *
 * Placement (M6): the comms module's sessionless endpoints live together under /api/clinic-messages/** (this run,
 * the SMS provider's webhook, the stop-emails link) – thin wrappers over src/server/pms/comms/*, owned by comms
 * (contract §3). Schedule: NOT in vercel.json yet – production is on Vercel Hobby (one run a day); see
 * docs/clinic-system/comms.md "Scheduling the message run".
 */
import "server-only";
import { getDataCipher } from "@/server/crypto";
import { getDb } from "@/server/db";
import { handleCommsCron } from "@/server/pms/comms/cron";
import { dispatchDepsFromEnv } from "@/server/pms/comms/dispatch";
import { appointmentStatuses } from "@/server/pms/diary/message-sync";
import { pmsNow } from "@/modules/pms/core/clock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  return handleCommsCron(req, {
    secret: process.env.CRON_SECRET,
    ctx: () => ({ db: getDb(), cipher: getDataCipher(), now: pmsNow }),
    dispatch: () => dispatchDepsFromEnv(process.env, appointmentStatuses),
  });
}
