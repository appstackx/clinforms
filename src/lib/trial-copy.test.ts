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

test("14/11/2026 self-serve banner: no made-up-details line while it runs; after the end: kept for 90 days with the date", async () => {
  const self = { reportsIncluded: 10, reportsUsed: 2, canChoosePlan: true };
  const running = trialBanner({ state: "trial", daysLeft: 5, endsAt: "2026-11-30T15:00:00.000Z", pending: false, selfServe: self }, "x@y.test");
  assert.equal(running?.text, "Free trial – 5 days left · 2 of 10 free reports used.");
  assert.deepEqual(running?.link, { href: "/app/settings/billing", label: "Choose a plan" });
  const ended = trialBanner({ state: "trial_ended", endedAt: "2026-11-30T15:00:00.000Z", selfServe: { ...self, keptUntil: "2027-03-01" } }, "x@y.test");
  assert.equal(
    ended?.text,
    "Your free trial has ended. Your data is safe and kept for 90 days, until Sunday 28 February 2027: you can still open and download everything, but nothing new can be added or changed until a plan is chosen.",
  );
  // A later day (a late warning): no "90 days".
  assert.match(trialBanner({ state: "trial_ended", endedAt: "2026-11-30T15:00:00.000Z", selfServe: { ...self, keptUntil: "2027-03-06", keptNinetyDays: false } }, "x@y.test")?.text ?? "", /^Your free trial has ended\. Your data is safe and kept, until Friday 5 March 2027: /);
  // Without the date (a sample of a paid clinic): the plain ended text.
  assert.match(trialBanner({ state: "trial_ended", endedAt: "2026-11-30T15:00:00.000Z", selfServe: self }, "x@y.test")?.text ?? "", /^Your free trial has ended\. Your data is safe: /);
  // A hand-set trial keeps its own words, the made-up-notes rule included.
  assert.match(trialBanner({ state: "trial", daysLeft: 3, endsAt: null, pending: false }, "x@y.test")?.text ?? "", /Use made-up notes only until your data processing agreement is signed\./);
  for (const t of [running?.text, ended?.text]) for (const re of BANNED_TERM_PATTERNS) assert.doesNotMatch(t ?? "", re);
});
