/**
 * Invitations expire at the same UK clock time a week later (test run 24/10/2026: sent 19:10 BST, the screens said
 * "expires 31 October 2026 at 18:10 (UK time)" – right, since the clocks went back, but it looked like a mistake).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ukDateTime } from "../email/templates";
import { INVITATION_DAYS, invitationExpiry, ukOffsetMs } from "./invitation-expiry";

const HOUR = 3600_000;
const WEEK = INVITATION_DAYS * 24 * HOUR;

/** "19:10" – the UK clock time of an instant. */
function ukClock(at: Date): string {
  return ukDateTime(at).replace(/^.* at (\d\d:\d\d) \(UK time\)$/, "$1");
}

test("the UK offset: GMT in winter, BST in summer", () => {
  assert.equal(ukOffsetMs(new Date("2026-01-15T12:00:00.000Z")), 0);
  assert.equal(ukOffsetMs(new Date("2026-07-15T12:00:00.000Z")), HOUR);
  // The clocks go back at 01:00 UTC on 25 October 2026, forward at 01:00 UTC on 29 March 2026.
  assert.equal(ukOffsetMs(new Date("2026-10-25T00:59:59.999Z")), HOUR);
  assert.equal(ukOffsetMs(new Date("2026-10-25T01:00:00.000Z")), 0);
  assert.equal(ukOffsetMs(new Date("2026-03-29T00:59:59.000Z")), 0);
  assert.equal(ukOffsetMs(new Date("2026-03-29T01:00:00.000Z")), HOUR);
});

test("sent 19:10 BST the day before the clocks go back: expires 19:10 GMT a week later, not 18:10", () => {
  const sent = new Date("2026-10-24T18:10:00.000Z");
  const expires = invitationExpiry(sent);
  assert.equal(expires.toISOString(), "2026-10-31T19:10:00.000Z");
  assert.equal(ukDateTime(expires), "31 October 2026 at 19:10 (UK time)");
  assert.equal(expires.getTime() - sent.getTime(), WEEK + HOUR);
});

test("sent 12:00 GMT the week before the clocks go forward: expires 12:00 BST", () => {
  const sent = new Date("2026-03-22T12:00:00.000Z");
  const expires = invitationExpiry(sent);
  assert.equal(expires.toISOString(), "2026-03-29T11:00:00.000Z");
  assert.equal(ukDateTime(expires), "29 March 2026 at 12:00 (UK time)");
  assert.equal(expires.getTime() - sent.getTime(), WEEK - HOUR);
});

test("no clock change in the week: exactly 7 × 24 hours", () => {
  for (const iso of ["2026-10-10T09:30:00.000Z", "2026-12-01T23:45:12.345Z", "2026-06-30T00:00:00.000Z"]) {
    const sent = new Date(iso);
    assert.equal(invitationExpiry(sent).getTime() - sent.getTime(), WEEK, iso);
  }
});

test("sent at 01:17 a week before the clocks go forward (no 01:17 that day): exactly a week, 02:17 BST", () => {
  const sent = new Date("2026-03-22T01:17:00.000Z");
  const expires = invitationExpiry(sent);
  assert.equal(expires.getTime() - sent.getTime(), WEEK);
  assert.equal(ukDateTime(expires), "29 March 2026 at 02:17 (UK time)");
});

test("every hour of a year: within an hour of 7 days, and at the sending time on the UK clock", () => {
  const start = Date.parse("2026-01-01T00:17:00.000Z");
  let checked = 0;
  for (let t = start; t < start + 366 * 24 * HOUR; t += HOUR) {
    const sent = new Date(t);
    const expires = invitationExpiry(sent);
    const drift = expires.getTime() - sent.getTime() - WEEK;
    assert.ok(Math.abs(drift) <= HOUR, `${sent.toISOString()}: ${drift} ms off a week`);
    if (sent.toISOString() === "2026-03-22T01:17:00.000Z") continue; // the missing clock hour (test above)
    assert.equal(ukClock(expires), ukClock(sent), sent.toISOString());
    checked++;
  }
  assert.equal(checked, 366 * 24 - 1);
});
