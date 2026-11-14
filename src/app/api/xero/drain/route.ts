/**
 * POST /api/xero/drain – the scheduled Xero send run (docs/clinic-system/xero.md "Scheduling"). Logic and tests:
 * src/server/pms/integration/xero/drain.ts. 404 while CLINFORMS_XERO is off.
 */
import "server-only";
import { pmsNow } from "@/modules/pms/core/clock";
import { getDataCipher } from "@/server/crypto";
import { getDb } from "@/server/db";
import { xeroClientFromEnv } from "@/server/pms/integration/xero/config";
import { handleXeroDrain } from "@/server/pms/integration/xero/drain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function deps() {
  return { env: process.env, ctx: () => ({ db: getDb(), cipher: getDataCipher(), now: pmsNow }), client: () => xeroClientFromEnv() };
}

export async function POST(req: Request): Promise<Response> {
  return handleXeroDrain(req, deps());
}

export async function GET(req: Request): Promise<Response> {
  return handleXeroDrain(req, deps());
}
