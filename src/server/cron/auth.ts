/**
 * The shared secret for the operator endpoints: the retention cron (GET /api/cron/retention, called by Vercel)
 * and the key fingerprint check (GET /api/ops/key-fingerprint, called by `npm run ops:key-fingerprint`).
 * Both take `Authorization: Bearer $CRON_SECRET`; without CRON_SECRET (16+ characters) both refuse every call.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export const CRON_SECRET_MIN_LENGTH = 16;

/** True when CRON_SECRET is set and long enough for the endpoints to accept calls at all. */
export function cronSecretConfigured(secret: string | undefined): secret is string {
  return !!secret && secret.length >= CRON_SECRET_MIN_LENGTH;
}

/** Constant-time comparison of the Authorization header with `Bearer <secret>` (hashes first: equal lengths). */
export function cronAuthorized(authorization: string | null, secret: string | undefined): boolean {
  if (!cronSecretConfigured(secret) || !authorization) return false;
  const a = createHash("sha256").update(authorization, "utf8").digest();
  const b = createHash("sha256").update(`Bearer ${secret}`, "utf8").digest();
  return timingSafeEqual(a, b);
}
