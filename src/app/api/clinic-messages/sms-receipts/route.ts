/**
 * POST /api/clinic-messages/sms-receipts?token=… – delivery receipts from the live text provider (The SMS Works).
 * 404 unless CLINIC_SMS_PROVIDER=smsworks with SMSWORKS_API_KEY set; 503 without SMSWORKS_RECEIPT_SECRET (32+
 * characters); 401 for a wrong token; every receipt RE-READ from the provider before it settles a text's credits.
 * Logic and tests: src/server/pms/comms/sms-receipts.ts. Runbook: docs/clinic-system/SMS-CREDITS.md §7.
 */
import "server-only";
import { getDataCipher } from "@/server/crypto";
import { getDb } from "@/server/db";
import { providerStatus } from "@/server/pms/comms/providers";
import { createSmsWorks, smsWorksConfig } from "@/server/pms/comms/providers/smsworks";
import { handleSmsWorksReceipt } from "@/server/pms/comms/sms-receipts";
import { pmsNow } from "@/modules/pms/core/clock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return handleSmsWorksReceipt(req, {
    secret: process.env.SMSWORKS_RECEIPT_SECRET?.trim(),
    client: () => {
      if (providerStatus().sms !== "live") return null;
      const c = smsWorksConfig(process.env);
      return c ? createSmsWorks(c) : null;
    },
    ctx: () => ({ db: getDb(), cipher: getDataCipher(), now: pmsNow }),
  });
}
