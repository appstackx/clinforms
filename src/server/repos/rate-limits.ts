/**
 * `rate_limits` – fixed-window counters shared by every server instance (live-call caps, passcode
 * guesses…). One atomic statement per hit:
 *   INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
 *   ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1 RETURNING count
 */
import { RepoInputError, assertIso, nowIso, toInt, type RepoContext } from "./context";

export interface RateLimitHit {
  /** Hits in this window including this one. */
  count: number;
  windowStart: string;
  /** When the window ends (ISO). */
  resetAt: string;
}

function checkKey(key: string): string {
  if (typeof key !== "string" || key.length === 0 || key.length > 200) throw new RepoInputError("Rate-limit key must be 1–200 characters.");
  return key;
}

function windowOf(nowMs: number, windowMs: number): { start: string; reset: string } {
  if (!Number.isInteger(windowMs) || windowMs < 1000 || windowMs > 7 * 86_400_000) {
    throw new RepoInputError("windowMs must be between 1 s and 7 days.");
  }
  const startMs = Math.floor(nowMs / windowMs) * windowMs;
  return { start: new Date(startMs).toISOString(), reset: new Date(startMs + windowMs).toISOString() };
}

/** Counts one hit for `key` in the current window and returns the window's total. */
export async function hitRateLimit(ctx: RepoContext, key: string, windowMs: number): Promise<RateLimitHit> {
  checkKey(key);
  const { start, reset } = windowOf(Date.parse(nowIso(ctx)), windowMs);
  const row = await ctx.db
    .insertInto("rate_limits")
    .values({ key, window_start: start, count: 1 })
    .onConflict((oc) => oc.columns(["key", "window_start"]).doUpdateSet((eb) => ({ count: eb("rate_limits.count", "+", 1) })))
    .returning("count")
    .executeTakeFirstOrThrow();
  return { count: toInt(row.count), windowStart: start, resetAt: reset };
}

/** The current window's count without counting a hit. */
export async function peekRateLimit(ctx: RepoContext, key: string, windowMs: number): Promise<RateLimitHit> {
  checkKey(key);
  const { start, reset } = windowOf(Date.parse(nowIso(ctx)), windowMs);
  const row = await ctx.db
    .selectFrom("rate_limits")
    .select("count")
    .where("key", "=", key)
    .where("window_start", "=", start)
    .executeTakeFirst();
  return { count: row ? toInt(row.count) : 0, windowStart: start, resetAt: reset };
}

/** Deletes windows that started before `before` (the retention cron). Returns the number removed. */
export async function purgeRateLimits(ctx: RepoContext, before: string): Promise<number> {
  const result = await ctx.db.deleteFrom("rate_limits").where("window_start", "<", assertIso(before, "before")).executeTakeFirst();
  return Number(result.numDeletedRows);
}

/** Deletes every window of one key (e.g. after a successful passcode). */
export async function resetRateLimit(ctx: RepoContext, key: string): Promise<number> {
  checkKey(key);
  const result = await ctx.db.deleteFrom("rate_limits").where("key", "=", key).executeTakeFirst();
  return Number(result.numDeletedRows);
}
