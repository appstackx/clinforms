/**
 * The clinic system's clock. Everything time-dependent in the clinic system (the diary's "seen" window, free slots,
 * reminders, aged debt, today's dashboard) asks here instead of `new Date()` / `Date.now()`.
 *
 * TEST-ONLY override, so the browser checks (scripts/e2e) do not depend on the hour they run at: with
 *
 *   PMS_TEST_CLOCK=1  PMS_TEST_NOW=<ISO instant>  [PMS_TEST_NOW_SET_AT=<epoch ms when that instant was "now">]
 *
 * the clock reads PMS_TEST_NOW + (real time since PMS_TEST_NOW_SET_AT) – it still runs at real speed, so every
 * process given the same three values (seed, server, e2e script) agrees on "now". Without SET_AT the clock starts at
 * PMS_TEST_NOW when this module first asks.
 *
 * It is NEVER honoured in a production build: the first line below compares `process.env.NODE_ENV`, which Next.js
 * replaces with the literal "production" at build time, so the rest of the function is dead code there and is
 * removed (clock.test.ts checks the rule; the M8 run also checked the built server has no "PMS_TEST_NOW").
 * Real sign-in, two-step codes and sessions never use this clock (it is not a global patch).
 * Browser-safe (in a browser bundle the variables are undefined: the real clock).
 */

let startedAt: number | null = null;

/** Milliseconds to add to the real clock (0 unless the test override is on – never in production). */
export function testClockOffsetMs(): number {
  if (process.env.NODE_ENV === "production") return 0;
  if (typeof process === "undefined" || !process.env || process.env.PMS_TEST_CLOCK !== "1") return 0;
  const target = Date.parse(process.env.PMS_TEST_NOW ?? "");
  if (!Number.isFinite(target)) return 0;
  const setAtRaw = Number(process.env.PMS_TEST_NOW_SET_AT);
  if (Number.isFinite(setAtRaw) && setAtRaw > 0) return target - setAtRaw;
  if (startedAt === null) startedAt = Date.now();
  return target - startedAt;
}

/** Now, in epoch milliseconds. */
export function pmsNowMs(): number {
  return Date.now() + testClockOffsetMs();
}

/** Now, as a Date. */
export function pmsNow(): Date {
  return new Date(pmsNowMs());
}

/** Now, ISO-8601 UTC. */
export function pmsNowIso(): string {
  return pmsNow().toISOString();
}
