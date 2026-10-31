/**
 * /api/clinic-messages/unsubscribe?t=<signed token> – the stop-emails link in patients' emails: GET shows one
 * button, POST (the button, or a mail app's one-click unsubscribe) switches that kind of email off.
 * Logic and tests: src/server/pms/comms/unsubscribe.ts. Placement: see ../cron/route.ts.
 */
import "server-only";
import { getDataCipher } from "@/server/crypto";
import { getDb } from "@/server/db";
import { commsLinkSecret } from "@/server/pms/comms/links";
import { handleUnsubscribe } from "@/server/pms/comms/unsubscribe";
import { pmsNow } from "@/modules/pms/core/clock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const deps = () => ({ secret: commsLinkSecret(), ctx: () => ({ db: getDb(), cipher: getDataCipher(), now: pmsNow }) });

export async function GET(req: Request): Promise<Response> {
  return handleUnsubscribe(req, deps());
}

export async function POST(req: Request): Promise<Response> {
  return handleUnsubscribe(req, deps());
}
