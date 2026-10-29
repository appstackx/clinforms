/**
 * Limits on the clinic's public pages (shared `rate_limits` table, every server instance). Subjects – the
 * client's address, an email address – are stored only as a keyed hash, per clinic. Limits are per client, per
 * email and per clinic, so one sender cannot use up a clinic's allowance.
 */
import "server-only";
import { createHmac } from "node:crypto";
import { hitRateLimit } from "../../repos/rate-limits";
import { nowIso, type DbContext } from "../../repos/context";

export const PUBLIC_LIMITS = {
  /** Slot searches (page views of the booking page with a choice made). */
  slotsPerClient: { max: 300, windowMs: 10 * 60_000 },
  bookingPerClient: { max: 10, windowMs: 60 * 60_000 },
  bookingPerEmail: { max: 3, windowMs: 24 * 60 * 60_000 },
  bookingPerClinic: { max: 300, windowMs: 60 * 60_000 },
  signInPerClient: { max: 10, windowMs: 60 * 60_000 },
  signInPerEmail: { max: 5, windowMs: 60 * 60_000 },
  linkPerClient: { max: 30, windowMs: 60 * 60_000 },
  patientWritesPerClient: { max: 60, windowMs: 60 * 60_000 },
  /** Pairing a clinic device with a code (M10 H3): ~10^11 codes, each valid 10 minutes. */
  devicePairPerClient: { max: 10, windowMs: 10 * 60_000 },
  devicePairPerClinic: { max: 60, windowMs: 10 * 60_000 },
} as const;

export type PublicLimit = keyof typeof PUBLIC_LIMITS;

export type LimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

function digest(secret: string | undefined, subject: string): string {
  return createHmac("sha256", secret && secret.length >= 16 ? secret : "clinforms:clinic-public:v1")
    .update(subject.toLowerCase())
    .digest("hex")
    .slice(0, 32);
}

/** Counts one hit for (clinic, limit, subject); refuses when over the limit. */
export async function publicLimit(ctx: DbContext, tenantId: string, limit: PublicLimit, subject: string | null, secret: string | undefined = process.env.BETTER_AUTH_SECRET): Promise<LimitResult> {
  const { max, windowMs } = PUBLIC_LIMITS[limit];
  const key = `clinic-public:${tenantId}:${limit}:${subject === null ? "all" : digest(secret, subject)}`;
  const hit = await hitRateLimit(ctx, key, windowMs);
  if (hit.count <= max) return { ok: true };
  return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(hit.resetAt) - Date.parse(nowIso(ctx))) / 1000)) };
}

/** Several limits in order; the first refusal wins (later ones are not counted). */
export async function publicLimits(ctx: DbContext, tenantId: string, checks: [PublicLimit, string | null][], secret?: string): Promise<LimitResult> {
  for (const [limit, subject] of checks) {
    if (subject === undefined) continue;
    const r = await publicLimit(ctx, tenantId, limit, subject, secret);
    if (!r.ok) return r;
  }
  return { ok: true };
}

export function tooManyMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many attempts. Please try again in ${minutes === 1 ? "a minute" : `${minutes} minutes`}, or contact the clinic.`;
}
