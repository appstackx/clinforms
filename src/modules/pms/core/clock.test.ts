import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { pmsNowMs, testClockOffsetMs } from "./clock";

const KEYS = ["NODE_ENV", "PMS_TEST_CLOCK", "PMS_TEST_NOW", "PMS_TEST_NOW_SET_AT"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const env = process.env as Record<string, string | undefined>;

function set(values: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) delete env[k];
  for (const [k, v] of Object.entries(values)) env[k] = v;
}

describe("the clinic system's clock (test-only override)", () => {
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete env[k];
      else env[k] = saved[k];
    }
  });

  it("real time without the override", () => {
    set({ NODE_ENV: "test" });
    assert.equal(testClockOffsetMs(), 0);
    assert.ok(Math.abs(pmsNowMs() - Date.now()) < 50);
  });

  it("runs from PMS_TEST_NOW at real speed when the flag is set outside production", () => {
    const setAt = Date.now() - 60_000;
    set({ NODE_ENV: "test", PMS_TEST_CLOCK: "1", PMS_TEST_NOW: "2026-10-28T10:30:00.000Z", PMS_TEST_NOW_SET_AT: String(setAt) });
    const now = pmsNowMs();
    assert.ok(Math.abs(now - Date.parse("2026-10-28T10:31:00.000Z")) < 1000, "one real minute after it was set");
  });

  it("needs the flag as well as the time", () => {
    set({ NODE_ENV: "development", PMS_TEST_NOW: "2026-10-28T10:30:00.000Z", PMS_TEST_NOW_SET_AT: String(Date.now()) });
    assert.equal(testClockOffsetMs(), 0);
  });

  it("a production build ignores it, whatever is set", () => {
    set({ NODE_ENV: "production", PMS_TEST_CLOCK: "1", PMS_TEST_NOW: "2001-01-01T00:00:00.000Z", PMS_TEST_NOW_SET_AT: String(Date.now()) });
    assert.equal(testClockOffsetMs(), 0);
    assert.ok(Math.abs(pmsNowMs() - Date.now()) < 50);
  });

  it("a bad time is ignored", () => {
    set({ NODE_ENV: "test", PMS_TEST_CLOCK: "1", PMS_TEST_NOW: "half past ten" });
    assert.equal(testClockOffsetMs(), 0);
  });
});
