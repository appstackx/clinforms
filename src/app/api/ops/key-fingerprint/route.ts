/**
 * GET /api/ops/key-fingerprint – fingerprints of the data keys this deployment holds (never the keys), for
 * `npm run ops:key-fingerprint -- --env production --compare https://clinforms.co.uk`. Authorised by
 * `Authorization: Bearer $CRON_SECRET`; refuses everything while CRON_SECRET is unset. Logic and tests:
 * src/server/ops/key-fingerprint.ts; runbook: docs/go-live.md §7.6, docs/database.md §5.
 */
import "server-only";
import { keyringFromEnv } from "@/server/crypto";
import { handleKeyFingerprint } from "@/server/ops/key-fingerprint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET(req: Request): Promise<Response> {
  return handleKeyFingerprint(req, { secret: process.env.CRON_SECRET, keyring: () => keyringFromEnv(process.env) });
}
