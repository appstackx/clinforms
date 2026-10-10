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
 * passcode cannot be guessed at request speed. The passcode must be 16+ characters (config.server.ts
 * MIN_LIVE_PASSCODE_LENGTH – a shorter one counts as not configured); use a long random one.
 *
 * Wave 2: the handlers use the SHARED variants at the end of this file (checkLivePasscodeShared,
 * takeDemoLiveCalls): the same limits counted in MedreportDeps.sharedState (database `rate_limits`), so
 * they hold across every server instance – "per instance" becomes "per deployment". Without a shared
 * store they are exactly the in-memory functions above.
 *
 * Owner: integration agent.
 */
import { getLivePasscode } from "../config.server";
import { HEADERS } from "../api/contract";
import type { MedreportDeps } from "../api/deps";
import { timingSafeEqualString } from "../api/http";
import { countHit, resetKey, subjectKey, takeSlots } from "./shared-limits";

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
 * failures are also capped for the whole instance. An IPv6 address counts as its /64 network (one
 * subscriber's or one LAN's addresses: rotating within it gains no extra guesses); an IPv4-mapped IPv6
 * address counts as its IPv4 address.
 */
export function clientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = req.headers.get("x-real-ip")?.trim();
  return clientSubject(xff || real || "unknown").slice(0, 64);
}

/** An address as a counter subject: IPv6 → its /64 prefix ("2001:db8:1:2::/64"); anything else as given. */
export function clientSubject(raw: string): string {
  let a = raw.trim().toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(a);
  if (bracketed) a = bracketed[1];
  if (!a.includes(":")) return a;
  a = a.replace(/%.*$/, ""); // zone id
  const groups = ipv6Groups(a);
  if (!groups) return a;
  // IPv4-mapped (::ffff:192.0.2.1): the IPv4 client.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}

/** The eight 16-bit groups of an IPv6 address (with "::" and an embedded IPv4 tail), or null when it is not one. */
function ipv6Groups(address: string): number[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    const list = part.split(":");
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      const v4 = i === list.length - 1 ? /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(g) : null;
      if (v4) {
        const b = v4.slice(1).map(Number);
        if (b.some((n) => n > 255)) return null;
        out.push((b[0] << 8) | b[1], (b[2] << 8) | b[3]);
      } else if (/^[0-9a-f]{1,4}$/.test(g)) out.push(parseInt(g, 16));
      else return null;
    }
    return out;
  };
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if (!head || !tail) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  return [...head, ...Array.from({ length: missing }, () => 0), ...tail];
}

function recent(list: number[], now: number): number[] {
  while (list.length > 0 && now - list[0] >= PASSCODE_FAILURE_WINDOW_MS) list.shift();
  return list;
}

function lockedFor(key: string, now: number, which: "client" | "all" | "both" = "both"): number {
  const mine = recent(failuresByClient.get(key) ?? [], now);
  const all = recent(instanceFailures, now);
  const blockers: number[] = [];
  if (which !== "all" && mine.length >= PASSCODE_FAILURES_PER_CLIENT) blockers.push(mine[mine.length - PASSCODE_FAILURES_PER_CLIENT]);
  if (which !== "client" && all.length >= PASSCODE_FAILURES_PER_INSTANCE) blockers.push(all[all.length - PASSCODE_FAILURES_PER_INSTANCE]);
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
  // This client's own wrong guesses lock it out, even for the right passcode (guessing gains nothing).
  const mine = lockedFor(key, nowMs, "client");
  if (mine > 0) return { ok: false, reason: "locked", retryAfterSeconds: mine };
  // Fix wave 2: the instance-wide cap throttles wrong guesses only – other clients' guesses never lock out a
  // presenter holding the right passcode. The right passcode clears this client's wrong guesses (only its
  // holder can), as on the shared path below.
  if (timingSafeEqualString(given.trim(), configured)) {
    failuresByClient.delete(key);
    return { ok: true };
  }
  const all = lockedFor(key, nowMs, "all");
  if (all > 0) return { ok: false, reason: "locked", retryAfterSeconds: all };
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

/* ------------------------------------------------------------------------------------------------
 * Wave 2: shared across instances (MedreportDeps.sharedState → rate_limits)
 * ----------------------------------------------------------------------------------------------*/

const PASSCODE_FAIL_ALL_KEY = "demo:passcode-fail:all";
const passcodeFailClientKey = (req: Request) => `demo:passcode-fail:client:${subjectKey(clientKey(req))}`;
const DEMO_LIVE_KEY = "demo:live-calls";

/**
 * checkLivePasscode() with its wrong-guess counters shared by every instance (5 per client, 30 in all,
 * per 10-minute window). In-memory (checkLivePasscode) when there is no shared store.
 *
 * Every attempt is counted BEFORE the compare, with one atomic upsert (countHit) that returns this attempt's
 * own count: guesses sent at the same time each get a different count, so at most PASSCODE_FAILURES_PER_CLIENT
 * of them per window are ever compared – a burst cannot slip past the limit by reading the counter before
 * any of them added to it. The right passcode then clears the client's counter (only the passcode's holder can,
 * so a presenter's own live calls never add up to a lock-out); a wrong one is also counted for the deployment.
 */
export async function checkLivePasscodeShared(req: Request, deps: MedreportDeps, nowMs: number = Date.now()): Promise<PasscodeCheck> {
  if (!deps.sharedState) return checkLivePasscode(req, nowMs);
  const configured = getLivePasscode();
  if (!configured) return { ok: false, reason: "not_configured" };
  const given = req.headers.get(HEADERS.passcode);
  if (!given || !given.trim()) return { ok: false, reason: "missing" };
  const clientCounter = passcodeFailClientKey(req);
  const lockedUntil = (w: { resetAtMs: number }): PasscodeCheck => ({ ok: false, reason: "locked", retryAfterSeconds: Math.max(1, Math.ceil((w.resetAtMs - nowMs) / 1000)) });
  const mine = await countHit(deps, clientCounter, PASSCODE_FAILURE_WINDOW_MS, nowMs);
  // This client's own wrong guesses lock it out, even for the right passcode (guessing gains nothing).
  if (mine.count > PASSCODE_FAILURES_PER_CLIENT) return lockedUntil(mine);
  // Fix wave 2: the deployment-wide cap throttles wrong guesses only – other clients' guesses never lock out a
  // presenter holding the right passcode (the passcode is 16+ characters: config.server.ts MIN_LIVE_PASSCODE_LENGTH).
  if (timingSafeEqualString(given.trim(), configured)) {
    await resetKey(deps, clientCounter);
    return { ok: true };
  }
  const all = await countHit(deps, PASSCODE_FAIL_ALL_KEY, PASSCODE_FAILURE_WINDOW_MS, nowMs);
  if (all.count > PASSCODE_FAILURES_PER_INSTANCE) return lockedUntil(all);
  return { ok: false, reason: "invalid" };
}

/**
 * The public demo's live cap (LIVE_CALLS_PER_MINUTE), shared by every instance: take `n` slots at once
 * (a form analysis fans out into several calls). In-memory (takeLiveCalls) when there is no shared store.
 */
export async function takeDemoLiveCalls(deps: MedreportDeps, n = 1, nowMs: number = Date.now()): Promise<RateLimitResult> {
  if (!deps.sharedState) return takeLiveCalls(n, nowMs);
  const slot = await takeSlots(deps, DEMO_LIVE_KEY, LIVE_CALLS_PER_MINUTE, 60_000, n, nowMs);
  return slot.ok ? { ok: true, remaining: slot.remaining } : { ok: false, retryAfterSeconds: slot.retryAfterSeconds };
}

/** Tests only: forget the shared demo counters of this deployment. */
export async function resetSharedDemoCounters(deps: MedreportDeps, req?: Request): Promise<void> {
  await resetKey(deps, DEMO_LIVE_KEY);
  await resetKey(deps, PASSCODE_FAIL_ALL_KEY);
  if (req) await resetKey(deps, passcodeFailClientKey(req));
}
