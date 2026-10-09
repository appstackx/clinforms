import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkLivePasscode,
  createRateLimiter,
  LIVE_CALLS_PER_MINUTE,
  liveCallRetryAfterSeconds,
  PASSCODE_FAILURE_WINDOW_MS,
  PASSCODE_FAILURES_PER_CLIENT,
  PASSCODE_FAILURES_PER_INSTANCE,
  resetLiveCallLimiter,
  resetPasscodeFailures,
  takeLiveCall,
  takeLiveCallSlot,
  takeLiveCalls,
} from "./passcode";

function withPasscode(value: string | null): Request {
  return new Request("https://example.test/api/reports/v1/drafts", {
    method: "POST",
    headers: value === null ? {} : { "x-medreport-passcode": value },
  });
}

test("live passcode: not configured, missing, wrong, right (constant-time compare)", () => {
  const saved = process.env.MEDREPORT_LIVE_PASSCODE;
  resetPasscodeFailures();
  try {
    delete process.env.MEDREPORT_LIVE_PASSCODE;
    assert.deepEqual(checkLivePasscode(withPasscode("anything")), { ok: false, reason: "not_configured" });
    process.env.MEDREPORT_LIVE_PASSCODE = "correct horse";
    assert.deepEqual(checkLivePasscode(withPasscode(null)), { ok: false, reason: "missing" });
    assert.deepEqual(checkLivePasscode(withPasscode("correct hors")), { ok: false, reason: "invalid" });
    assert.deepEqual(checkLivePasscode(withPasscode("correct horse")), { ok: true });
  } finally {
    if (saved === undefined) delete process.env.MEDREPORT_LIVE_PASSCODE;
    else process.env.MEDREPORT_LIVE_PASSCODE = saved;
  }
});

test("sliding-window rate limiter", () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
  assert.deepEqual(limiter.take(0), { ok: true, remaining: 1 });
  assert.deepEqual(limiter.take(10_000), { ok: true, remaining: 0 });
  assert.deepEqual(limiter.take(20_000), { ok: false, retryAfterSeconds: 40 });
  assert.deepEqual(limiter.peek(59_999), { ok: false, retryAfterSeconds: 1 });
  assert.deepEqual(limiter.take(60_000), { ok: true, remaining: 0 });
});

test("live-AI cap: about 6 calls per minute per instance", () => {
  resetLiveCallLimiter();
  const t0 = 1_000_000;
  for (let i = 0; i < LIVE_CALLS_PER_MINUTE; i++) assert.equal(takeLiveCallSlot(t0 + i), true);
  assert.equal(takeLiveCallSlot(t0 + 100), false);
  assert.equal(takeLiveCall(t0 + 100).ok, false);
  assert.equal(liveCallRetryAfterSeconds(t0 + 30_000), 30);
  assert.equal(takeLiveCall(t0 + 60_000).ok, true);
  resetLiveCallLimiter();
});

function fromClient(value: string, ip: string): Request {
  return new Request("https://example.test/api/reports/v1/drafts", { method: "POST", headers: { "x-medreport-passcode": value, "x-forwarded-for": ip } });
}

test("wrong passcodes are counted: a client is locked out after 5, the instance after 30", () => {
  const saved = process.env.MEDREPORT_LIVE_PASSCODE;
  process.env.MEDREPORT_LIVE_PASSCODE = "a-long-random-passcode";
  resetPasscodeFailures();
  try {
    const t0 = 5_000_000;
    for (let i = 0; i < PASSCODE_FAILURES_PER_CLIENT; i++) assert.deepEqual(checkLivePasscode(fromClient("guess" + i, "203.0.113.7"), t0 + i), { ok: false, reason: "invalid" });
    // Locked even for the right passcode until the window passes – guessing gains nothing.
    const locked = checkLivePasscode(fromClient("a-long-random-passcode", "203.0.113.7"), t0 + 10);
    assert.equal(locked.ok, false);
    assert.equal(!locked.ok && locked.reason, "locked");
    // Another client is unaffected…
    assert.deepEqual(checkLivePasscode(fromClient("a-long-random-passcode", "198.51.100.2"), t0 + 11), { ok: true });
    // …and the first client is let back in after the window.
    assert.deepEqual(checkLivePasscode(fromClient("a-long-random-passcode", "203.0.113.7"), t0 + PASSCODE_FAILURE_WINDOW_MS + 10), { ok: true });

    // Forged X-Forwarded-For values cannot bypass the instance-wide cap.
    resetPasscodeFailures();
    for (let i = 0; i < PASSCODE_FAILURES_PER_INSTANCE; i++) checkLivePasscode(fromClient("guess", `10.0.0.${i}`), t0 + i);
    const all = checkLivePasscode(fromClient("a-long-random-passcode", "10.9.9.9"), t0 + 100);
    assert.equal(!all.ok && all.reason, "locked");
  } finally {
    resetPasscodeFailures();
    if (saved === undefined) delete process.env.MEDREPORT_LIVE_PASSCODE;
    else process.env.MEDREPORT_LIVE_PASSCODE = saved;
  }
});

test("a fan-out of n live calls takes n slots, all or nothing", () => {
  resetLiveCallLimiter();
  const t0 = 9_000_000;
  assert.equal(takeLiveCalls(4, t0).ok, true);
  assert.equal(takeLiveCalls(3, t0 + 1).ok, false, "only 2 of 6 left");
  assert.equal(takeLiveCalls(2, t0 + 2).ok, true);
  assert.equal(takeLiveCall(t0 + 3).ok, false);
  resetLiveCallLimiter();
});
