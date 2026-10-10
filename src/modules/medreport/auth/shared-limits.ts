import "server-only";

/**
 * Counters and single-use ids shared by every server instance (wave 2): MedreportDeps.sharedState –
 * the database tables `rate_limits` (fixed windows, one atomic upsert per hit) and `launch_token_uses`.
 *
 * Without a shared store (the host provides none on a single local process – `next dev`, tests – where
 * this process's memory IS the shared state) the counters are kept in memory, as before wave 2. When the
 * shared store FAILS, the counters fall back to memory too (logged, never fatal) – except single-use
 * claims that guard a clinic (claimOnce with requireShared), which refuse with 503 rather than fall back,
 * so a clinic's launch link can never be replayed on another instance.
 *
 * Keys never hold a raw IP address or e-mail: subjects are keyed hashes (subjectKey()).
 *
 * Owner: API slice (wave 2).
 */
import { createHmac } from "node:crypto";
import type { MedreportDeps } from "../api/deps";
import { HttpError, logEvent } from "../api/http";
import { signingKey } from "../config.server";
import { WORDING } from "../core/wording";

export type SlotResult = { ok: true; count: number; remaining: number } | { ok: false; retryAfterSeconds: number };

interface WindowState {
  count: number;
  resetAtMs: number;
}

/* In-memory fallback (per instance): fixed windows, like the shared table. */
const memoryWindows = new Map<string, { start: number; count: number }>();
const memoryClaims = new Map<string, number>();

function windowStart(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs) * windowMs;
}

function memoryCounter(op: "hit" | "peek", key: string, windowMs: number, nowMs: number, amount = 1): WindowState {
  const start = windowStart(nowMs, windowMs);
  const id = `${key}|${windowMs}`;
  const current = memoryWindows.get(id);
  const count = current && current.start === start ? current.count : 0;
  if (op === "hit") {
    memoryWindows.set(id, { start, count: count + amount });
    if (memoryWindows.size > 10_000) {
      for (const [k, v] of Array.from(memoryWindows.entries())) if (v.start + 7 * 86_400_000 < nowMs) memoryWindows.delete(k);
    }
    return { count: count + amount, resetAtMs: start + windowMs };
  }
  return { count, resetAtMs: start + windowMs };
}

async function counter(deps: MedreportDeps, op: "hit" | "peek", key: string, windowMs: number, nowMs: number, amount = 1): Promise<WindowState> {
  const store = deps.sharedState;
  if (store) {
    try {
      const w = op === "hit" ? await (amount === 1 ? store.hit(key, windowMs) : store.hit(key, windowMs, amount)) : await store.peek(key, windowMs);
      const resetAtMs = Date.parse(w.resetAt);
      return { count: w.count, resetAtMs: Number.isFinite(resetAtMs) ? resetAtMs : windowStart(nowMs, windowMs) + windowMs };
    } catch (err) {
      logEvent("shared_state_unavailable", { op, error: err instanceof Error ? err.name : "error" });
    }
  }
  return memoryCounter(op, key, windowMs, nowMs, amount);
}

function retryAfter(resetAtMs: number, nowMs: number): number {
  return Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000));
}

/** The current count of a key's window (no hit). */
export async function peekCount(deps: MedreportDeps, key: string, windowMs: number, nowMs: number = Date.now()): Promise<WindowState> {
  return counter(deps, "peek", key, windowMs, nowMs);
}

/** Count one hit (e.g. a wrong passcode), or `amount` (fix wave 2: kilobytes stored). */
export async function countHit(deps: MedreportDeps, key: string, windowMs: number, nowMs: number = Date.now(), amount = 1): Promise<WindowState> {
  return counter(deps, "hit", key, windowMs, nowMs, Math.max(1, Math.floor(amount)));
}

/**
 * Take `n` slots of `limit` per window, all or nothing as far as a check can tell: refused (nothing
 * counted) when fewer than `n` are free; when concurrent requests took the last slots between the check
 * and the hits, refused too (those hits stay counted – the cap is never exceeded).
 */
export async function takeSlots(
  deps: MedreportDeps,
  key: string,
  limit: number,
  windowMs: number,
  n = 1,
  nowMs: number = Date.now(),
): Promise<SlotResult> {
  const count = Math.max(1, Math.floor(n));
  const before = await counter(deps, "peek", key, windowMs, nowMs);
  if (before.count + count > limit) return { ok: false, retryAfterSeconds: retryAfter(before.resetAtMs, nowMs) };
  let last = before;
  for (let i = 0; i < count; i++) last = await counter(deps, "hit", key, windowMs, nowMs);
  if (last.count > limit) return { ok: false, retryAfterSeconds: retryAfter(last.resetAtMs, nowMs) };
  return { ok: true, count: last.count, remaining: limit - last.count };
}

/** Take `n` slots from several limits at once (e.g. per minute AND per day): refused if any is full. */
export async function takeSlotsFromAll(
  deps: MedreportDeps,
  limits: { key: string; limit: number; windowMs: number }[],
  n = 1,
  nowMs: number = Date.now(),
): Promise<SlotResult & { blockedBy?: string }> {
  const count = Math.max(1, Math.floor(n));
  const states = await Promise.all(limits.map((l) => counter(deps, "peek", l.key, l.windowMs, nowMs)));
  for (let i = 0; i < limits.length; i++) {
    if (states[i].count + count > limits[i].limit) return { ok: false, retryAfterSeconds: retryAfter(states[i].resetAtMs, nowMs), blockedBy: limits[i].key };
  }
  let remaining = Number.POSITIVE_INFINITY;
  let total = 0;
  for (let i = 0; i < limits.length; i++) {
    let last = states[i];
    for (let k = 0; k < count; k++) last = await counter(deps, "hit", limits[i].key, limits[i].windowMs, nowMs);
    if (last.count > limits[i].limit) return { ok: false, retryAfterSeconds: retryAfter(last.resetAtMs, nowMs), blockedBy: limits[i].key };
    remaining = Math.min(remaining, limits[i].limit - last.count);
    total = last.count;
  }
  return { ok: true, count: total, remaining: Number.isFinite(remaining) ? remaining : 0 };
}

/** Forget a key (shared and in memory). */
export async function resetKey(deps: MedreportDeps, key: string): Promise<void> {
  for (const id of Array.from(memoryWindows.keys())) if (id.startsWith(`${key}|`)) memoryWindows.delete(id);
  if (deps.sharedState) {
    try {
      await deps.sharedState.reset(key);
    } catch (err) {
      logEvent("shared_state_unavailable", { op: "reset", error: err instanceof Error ? err.name : "error" });
    }
  }
}

/**
 * A short keyed hash of a subject (client IP, tenant id…) for counter keys: stable across instances,
 * never reversible to an IP address by trying them all (the key is server-only).
 */
export function subjectKey(subject: string): string {
  return createHmac("sha256", signingKey("rate-limit-key")).update(subject, "utf8").digest("base64url").slice(0, 22);
}

/**
 * Single use: true the first time `id` is claimed. Shared across instances when deps.sharedState exists.
 * With `requireShared`, a FAILING shared store is a 503 (no in-memory fallback): used for a clinic's launch
 * links, where a replay on another instance must be impossible. (No store at all = a single process.)
 */
export async function claimOnce(
  deps: MedreportDeps,
  id: string,
  expiresAtMs: number,
  opts: { requireShared?: boolean; nowMs?: number } = {},
): Promise<boolean> {
  const nowMs = opts.nowMs ?? Date.now();
  const store = deps.sharedState;
  if (store) {
    try {
      return await store.claimOnce(id, new Date(expiresAtMs).toISOString());
    } catch (err) {
      logEvent("shared_state_unavailable", { op: "claim", error: err instanceof Error ? err.name : "error" });
      if (opts.requireShared) throw launchStateUnavailable();
    }
  }
  if (memoryClaims.size > 1000) {
    for (const [k, until] of Array.from(memoryClaims.entries())) if (until <= nowMs) memoryClaims.delete(k);
  }
  const until = memoryClaims.get(id);
  if (until !== undefined && until > nowMs) return false;
  memoryClaims.set(id, expiresAtMs);
  return true;
}

function launchStateUnavailable(): HttpError {
  return new HttpError(503, "Please try again shortly", { code: "SERVICE_UNAVAILABLE", detail: WORDING.server.access.launchStateUnavailable, retryable: true });
}

/** Tests only: forget every in-memory window and claim. */
export function resetMemoryLimits(): void {
  memoryWindows.clear();
  memoryClaims.clear();
}
