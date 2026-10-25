/** admin:set-trial / admin:set-limits argument handling (10/2026). The operations are tested in src/server/admin. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { CliError, parseArgs } from "./cli";
import { limitsFromArgs } from "./set-limits";
import { describePlan, trialCommand } from "./set-trial";

const args = (line: string) => parseArgs(line.split(" ").filter(Boolean));

test("set-trial: exactly one command; --days waits for the owner by default; --start-now; day ranges", () => {
  assert.deepEqual(trialCommand(args("--slug blue-heart --days 3")), { kind: "set", days: 3, start: "first_sign_in" });
  assert.deepEqual(trialCommand(args("--slug blue-heart --days 3 --start-on-first-sign-in")), { kind: "set", days: 3, start: "first_sign_in" });
  assert.deepEqual(trialCommand(args("--slug blue-heart --days 14 --start-now")), { kind: "set", days: 14, start: "now" });
  assert.deepEqual(trialCommand(args("--slug blue-heart --extend-days 2")), { kind: "extend", days: 2 });
  assert.deepEqual(trialCommand(args("--slug blue-heart --convert-to-paid")), { kind: "paid" });
  assert.deepEqual(trialCommand(args("--slug blue-heart --end-now")), { kind: "end" });
  assert.deepEqual(trialCommand(args("--slug blue-heart --show")), { kind: "show" });
  for (const bad of ["--slug x", "--slug x --days 3 --end-now", "--slug x --days 0", "--slug x --days 367", "--slug x --days 1.5", "--slug x --days 3 --start-now --start-on-first-sign-in", "--slug x --extend-days"]) {
    assert.throws(() => trialCommand(args(bad)), CliError, bad);
  }
});

test("set-limits: per minute / per day / back to the defaults", () => {
  assert.deepEqual(limitsFromArgs(args("--slug blue-heart --per-minute 30 --per-day 1500")), { perMinute: 30, perDay: 1500 });
  assert.deepEqual(limitsFromArgs(args("--slug blue-heart --per-day 1500")), { perMinute: null, perDay: 1500 });
  assert.deepEqual(limitsFromArgs(args("--slug blue-heart --default")), { perMinute: null, perDay: null });
  for (const bad of ["--slug x", "--slug x --default --per-day 3", "--slug x --per-minute 0", "--slug x --per-minute abc"]) {
    assert.throws(() => limitsFromArgs(args(bad)), CliError, bad);
  }
});

test("describePlan prints the state in plain words", () => {
  assert.deepEqual(describePlan(null), ["  no plan: no trial, default drafting limits"]);
  const lines = describePlan(
    {
      tenantId: "blue-heart",
      status: "trial",
      trialDays: 3,
      startOnFirstSignIn: true,
      trialStartsAt: null,
      trialEndsAt: null,
      ownerFirstSignInAt: null,
      endedAt: null,
      livePerMinute: 30,
      livePerDay: 1500,
      demoClinic: false,
      createdAt: "2026-10-24T09:00:00.000Z",
      updatedAt: "2026-10-24T09:00:00.000Z",
    },
    new Date("2026-10-24T10:00:00.000Z"),
  );
  assert.match(lines[0], /trial of 3 days, starts when an owner first signs in/);
  assert.match(lines[2], /30 a minute, 1500 a day/);
});
