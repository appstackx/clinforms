/** The trial banner's wording (10/2026): exact text, singular/plural, the ended state, neutral wording. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { BANNED_TERM_PATTERNS } from "../modules/medreport/core/wording";
import { TRIAL_COPY, trialBanner } from "./trial-copy";

test("trial banner: N days left, the DPA line, singular, ended with the contact address, nothing without a trial", () => {
  assert.deepEqual(trialBanner({ state: "trial", daysLeft: 3, endsAt: "2026-10-27T09:00:00.000Z", pending: false }, "help@example.test"), {
    tone: "info",
    text: "Trial – 3 days left. Use made-up notes only until your data processing agreement is signed.",
  });
  assert.equal(trialBanner({ state: "trial", daysLeft: 1, endsAt: "2026-10-27T09:00:00.000Z", pending: false }, "x@y.test")?.text.startsWith("Trial – 1 day left."), true);
  assert.equal(trialBanner({ state: "trial", daysLeft: 3, endsAt: null, pending: true }, "x@y.test")?.text.startsWith("Trial – 3 days left."), true, "waiting for the owner");
  const ended = trialBanner({ state: "trial_ended", endedAt: "2026-10-27T09:00:00.000Z" }, "help@example.test");
  assert.equal(ended?.tone, "warning");
  assert.match(ended?.text ?? "", /Your trial has ended\. You can still open and download your existing reports and forms\./);
  assert.match(ended?.text ?? "", /contact us at help@example\.test\.$/);
  assert.equal(trialBanner({ state: "full" }, "x@y.test"), null);
  assert.equal(trialBanner(null, "x@y.test"), null);
  for (const text of [TRIAL_COPY.running(3), TRIAL_COPY.ended("help@example.test")]) {
    for (const re of BANNED_TERM_PATTERNS) assert.doesNotMatch(text, re);
  }
});
