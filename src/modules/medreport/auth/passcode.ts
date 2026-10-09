import "server-only";

/**
 * Live-AI gate: x-medreport-passcode compared in constant time with MEDREPORT_LIVE_PASSCODE, plus a
 * per-instance cap of about 6 live calls per minute (the Anthropic workspace also has a spend limit).
 *
 * For the AI agent (POST /drafts, live path):
 *
 *   const pass = checkLivePasscode(req);                 // { ok } | { ok: false, reason }
 *   if (!pass.ok) …401 PASSCODE_REQUIRED / PASSCODE_INVALID, or demo when "not_configured"
 *   const slot = takeLiveCall();                         // { ok: true } | { ok: false, retryAfterSeconds }
 *   if (!slot.ok) …429 RATE_LIMITED, retryable, header retry-after: slot.retryAfterSeconds
 *
 * The limiter is in memory, per serverless instance: a soft cap for a demo, not a security boundary.
 * Wrong passcodes are counted too: 5 per client and 30 per instance in 10 minutes, then 429 – so the
 * passcode cannot be guessed at request speed. Use a long random passcode (16+ characters).
 *
 * Owner: integration agent.
 */
import { getLivePasscode } from "../config.server";
import { HEADERS } from "../api/contract";
import { timingSafeEqualString } from "../api/http";

export type PasscodeCheck =
  | { ok: true }
  | { ok: false; reason: "missing" | "invalid" | "not_configured" }
  | { ok: false; reason: "locked"; retryAfterSeconds: number };

/* Wrong passcodes are counted (brute-force guard): per client and for the whole instance. */
export const PASSCODE_FAILURES_PER_CLIENT = 5;
export const PASSCODE_FAILURES_PER_INSTANCE = 30;
export const PASSCODE_FAILURE_WINDOW_MS = 10 * 60_000;

const failuresByClient = new Map<string, number[]>();
const instanceFailures: number[] = [];

/**
 * The client a request comes from, for counting failures: the first X-Forwarded-For hop (set by the
 * platform on Vercel), else "unknown". On a self-hosted server that header can be forged, which is why
 * failures are also capped for the whole instance.
 */
export function clientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = req.headers.get("x-real-ip")?.trim();
  return (xff || real || "unknown").slice(0, 64);
}

function recent(list: number[], now: number): number[] {
  while (list.length > 0 && now - list[0] >= PASSCODE_FAILURE_WINDOW_MS) list.shift();
  return list;
}

function lockedFor(key: string, now: number): number {
  const mine = recent(failuresByClient.get(key) ?? [], now);
  const all = recent(instanceFailures, now);
  const blockers: number[] = [];
  if (mine.length >= PASSCODE_FAILURES_PER_CLIENT) blockers.push(mine[mine.length - PASSCODE_FAILURES_PER_CLIENT]);
  if (all.length >= PASSCODE_FAILURES_PER_INSTANCE) blockers.push(all[all.length - PASSCODE_FAILURES_PER_INSTANCE]);
  if (blockers.length === 0) return 0;
  return Math.max(1, Math.ceil((Math.max(...blockers) + PASSCODE_FAILURE_WINDOW_MS - now) / 1000));
}

function recordFailure(key: string, now: number): void {
  const mine = recent(failuresByClient.get(key) ?? [], now);
  mine.push(now);
  failuresByClient.set(key, mine);
  instanceFailures.push(now);
  if (failuresByClient.size > 5000) {
    for (const [k, v] of Array.from(failuresByClient.entries())) if (recent(v, now).length === 0) failuresByClient.delete(k);
  }
}

export function checkLivePasscode(req: Request, nowMs: number = Date.now()): PasscodeCheck {
  const configured = getLivePasscode();
  if (!configured) return { ok: false, reason: "not_configured" };
  const given = req.headers.get(HEADERS.passcode);
  if (!given || !given.trim()) return { ok: false, reason: "missing" };
  const key = clientKey(req);
  const wait = lockedFor(key, nowMs);
  if (wait > 0) return { ok: false, reason: "locked", retryAfterSeconds: wait };
  if (timingSafeEqualString(given.trim(), configured)) return { ok: true };
  recordFailure(key, nowMs);
  return { ok: false, reason: "invalid" };
}

/** Tests only. */
export function resetPasscodeFailures(): void {
  failuresByClient.clear();
  instanceFailures.length = 0;
}

/* ------------------------------------------------------------------------------------------------
 * Sliding-window rate limiter (in memory, per instance)
 * ----------------------------------------------------------------------------------------------*/

export type RateLimitResult = { ok: true; remaining: number } | { ok: false; retryAfterSeconds: number };

export interface RateLimiter {
  /** Take one slot now; refused when `limit` slots were taken in the last `windowMs`. */
  take(nowMs?: number): RateLimitResult;
  /** Check without taking a slot. */
  peek(nowMs?: number): RateLimitResult;
  /** Forget every recorded call (tests). */
  reset(): void;
}

export function createRateLimiter(opts: { limit: number; windowMs: number }): RateLimiter {
  const calls: number[] = [];
  const prune = (now: number) => {
    while (calls.length > 0 && now - calls[0] >= opts.windowMs) calls.shift();
  };
  const status = (now: number): RateLimitResult => {
    prune(now);
    if (calls.length < opts.limit) return { ok: true, remaining: opts.limit - calls.length };
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((calls[0] + opts.windowMs - now) / 1000)) };
  };
  return {
    take(nowMs = Date.now()) {
      const s = status(nowMs);
      if (!s.ok) return s;
      calls.push(nowMs);
      return { ok: true, remaining: s.remaining - 1 };
    },
    peek(nowMs = Date.now()) {
      return status(nowMs);
    },
    reset() {
      calls.length = 0;
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * The live-AI cap
 * ----------------------------------------------------------------------------------------------*/

export const LIVE_CALLS_PER_MINUTE = 6;

const liveLimiter = createRateLimiter({ limit: LIVE_CALLS_PER_MINUTE, windowMs: 60_000 });

/** Take a live-AI slot: `{ok: true, remaining}` or `{ok: false, retryAfterSeconds}`. */
export function takeLiveCall(nowMs: number = Date.now()): RateLimitResult {
  return liveLimiter.take(nowMs);
}

/**
 * Take `n` slots at once (a form analysis fans out into several parallel Claude calls, and each one
 * counts). All or nothing: refused when fewer than `n` are free.
 */
export function takeLiveCalls(n: number, nowMs: number = Date.now()): RateLimitResult {
  const count = Math.max(1, Math.floor(n));
  const free = liveLimiter.peek(nowMs);
  if (!free.ok) return free;
  if (free.remaining < count) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(60_000 / 1000 / LIVE_CALLS_PER_MINUTE)) };
  let last: RateLimitResult = free;
  for (let i = 0; i < count; i++) last = liveLimiter.take(nowMs);
  return last;
}

/** Take a slot in the per-instance sliding one-minute window. Returns false when the cap is reached. */
export function takeLiveCallSlot(nowMs: number = Date.now()): boolean {
  return liveLimiter.take(nowMs).ok;
}

/** Seconds until a live slot frees up (0 when one is free now). */
export function liveCallRetryAfterSeconds(nowMs: number = Date.now()): number {
  const s = liveLimiter.peek(nowMs);
  return s.ok ? 0 : s.retryAfterSeconds;
}

/** Tests only. */
export function resetLiveCallLimiter(): void {
  liveLimiter.reset();
}
