import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_LIVE_PASSCODE_LENGTH, getLivePasscode, hasLivePasscode } from "../config.server";
import {
  checkLivePasscode,
  clientKey,
  clientSubject,
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
    process.env.MEDREPORT_LIVE_PASSCODE = "correct horse battery";
    assert.deepEqual(checkLivePasscode(withPasscode(null)), { ok: false, reason: "missing" });
    assert.deepEqual(checkLivePasscode(withPasscode("correct horse batter")), { ok: false, reason: "invalid" });
    assert.deepEqual(checkLivePasscode(withPasscode("correct horse battery")), { ok: true });
  } finally {
    resetPasscodeFailures();
    if (saved === undefined) delete process.env.MEDREPORT_LIVE_PASSCODE;
    else process.env.MEDREPORT_LIVE_PASSCODE = saved;
  }
});

test(`a passcode shorter than ${MIN_LIVE_PASSCODE_LENGTH} characters counts as not configured (one warning, never the value)`, () => {
  const saved = process.env.MEDREPORT_LIVE_PASSCODE;
  const realWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(" "));
  resetPasscodeFailures();
  try {
    const short = "short-passcode1"; // 15 characters
    assert.equal(short.length, MIN_LIVE_PASSCODE_LENGTH - 1);
    process.env.MEDREPORT_LIVE_PASSCODE = `  ${short}  `;
    assert.equal(hasLivePasscode(), false);
    assert.equal(getLivePasscode(), null);
    assert.deepEqual(checkLivePasscode(withPasscode(short)), { ok: false, reason: "not_configured" }, "not even the right short one");
    hasLivePasscode();
    assert.equal(warnings.length, 1, "warned once");
    assert.match(warnings[0], /"event":"config.live_passcode_too_short"/);
    assert.ok(!warnings[0].includes(short), "never the value");

    const exact = "x".repeat(MIN_LIVE_PASSCODE_LENGTH);
    process.env.MEDREPORT_LIVE_PASSCODE = exact;
    assert.equal(hasLivePasscode(), true);
    assert.equal(getLivePasscode(), exact);
    assert.deepEqual(checkLivePasscode(withPasscode(exact)), { ok: true });
  } finally {
    console.warn = realWarn;
    resetPasscodeFailures();
    if (saved === undefined) delete process.env.MEDREPORT_LIVE_PASSCODE;
    else process.env.MEDREPORT_LIVE_PASSCODE = saved;
  }
});

test("client key: IPv4 as given; IPv6 by its /64 network; IPv4-mapped IPv6 as IPv4", () => {
  assert.equal(clientSubject("203.0.113.7"), "203.0.113.7");
  assert.equal(clientSubject("unknown"), "unknown");
  for (const a of ["2001:db8:aa:bb:1:2:3:4", "2001:DB8:AA:BB::99", "2001:0db8:00aa:00bb:ffff:ffff:ffff:ffff", "[2001:db8:aa:bb::1]:443", "2001:db8:aa:bb::1%eth0"]) {
    assert.equal(clientSubject(a), "2001:db8:aa:bb::/64", a);
  }
  assert.equal(clientSubject("2001:db8:aa:bc::1"), "2001:db8:aa:bc::/64", "the next /64 is another client");
  assert.equal(clientSubject("::1"), "0:0:0:0::/64");
  assert.equal(clientSubject("fe80::"), "fe80:0:0:0::/64");
  assert.equal(clientSubject("::ffff:198.51.100.9"), "198.51.100.9");
  assert.equal(clientSubject("0:0:0:0:0:ffff:c633:6409"), "198.51.100.9");
  assert.equal(clientSubject("64:ff9b::192.0.2.1"), "64:ff9b:0:0::/64");
  // Not an address: kept as given (lower case), never thrown on.
  for (const odd of ["1:2:3", "1::2::3", "2001:db8::g", "1:2:3:4:5:6:7:8:9", "::ffff:300.1.1.1"]) assert.equal(clientSubject(odd), odd, odd);
  const req = (xff: string) => new Request("https://example.test/", { headers: { "x-forwarded-for": xff } });
  assert.equal(clientKey(req("2001:db8:aa:bb:1:2:3:4, 10.0.0.1")), "2001:db8:aa:bb::/64");
  assert.equal(clientKey(new Request("https://example.test/")), "unknown");
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

    // The right passcode clears the client's wrong guesses: a presenter's typos never add up across a demo.
    resetPasscodeFailures();
    const t1 = t0 + 2 * PASSCODE_FAILURE_WINDOW_MS;
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < PASSCODE_FAILURES_PER_CLIENT - 1; i++) assert.deepEqual(checkLivePasscode(fromClient(`typo-${round}-${i}`, "203.0.113.8"), t1 + round * 10 + i), { ok: false, reason: "invalid" });
      assert.deepEqual(checkLivePasscode(fromClient("a-long-random-passcode", "203.0.113.8"), t1 + round * 10 + 9), { ok: true }, `round ${round}`);
    }

    // IPv6: every address of one /64 is one client.
    resetPasscodeFailures();
    for (let i = 0; i < PASSCODE_FAILURES_PER_CLIENT; i++) checkLivePasscode(fromClient("guess", `2001:db8:5:6::${i + 1}`), t0 + i);
    const v6 = checkLivePasscode(fromClient("a-long-random-passcode", "2001:db8:5:6:ffff::1"), t0 + 10);
    assert.equal(!v6.ok && v6.reason, "locked");

    // Forged X-Forwarded-For values cannot bypass the instance-wide cap on wrong guesses…
    resetPasscodeFailures();
    for (let i = 0; i < PASSCODE_FAILURES_PER_INSTANCE; i++) checkLivePasscode(fromClient("guess", `10.0.0.${i}`), t0 + i);
    const all = checkLivePasscode(fromClient("another-guess", "10.9.9.9"), t0 + 100);
    assert.equal(!all.ok && all.reason, "locked");
    // …but other clients' guesses never lock out a presenter holding the right passcode (fix wave 2).
    assert.deepEqual(checkLivePasscode(fromClient("a-long-random-passcode", "10.9.9.8"), t0 + 101), { ok: true });
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
