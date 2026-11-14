/**
 * The self-serve free trial's pure rules (src/lib/trial.ts): settings from the environment, the abuse brake's address
 * and network forms, and the email schedule in UK calendar days (Europe/London, across the clock change). Run by
 * npm run test:site.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TRIAL_DEFAULT_DAYS,
  TRIAL_DELETION_NOTICE_DAYS,
  TRIAL_KEEP_DAYS,
  addUkDays,
  trialDeletionDay,
  trialDeletionDayIfWarnedAt,
  trialDeletionWarningDay,
  ukDayStart,
  canonicalTrialEmail,
  dueTrialEmails,
  londonDay,
  londonDaysBetween,
  ownEmailDomain,
  trialDays,
  trialReports,
  trialTexts,
  type TrialEmailFacts,
  type TrialEmailKind,
} from "./trial";

const DAY = 86_400_000;

describe("trial settings (CLINFORMS_TRIAL_DAYS / _REPORTS / _TEXTS)", () => {
  it("defaults 14 / 10 / 10; whole numbers in range only", () => {
    assert.equal(trialDays({}), TRIAL_DEFAULT_DAYS);
    assert.equal(trialDays({ CLINFORMS_TRIAL_DAYS: "30" }), 30);
    assert.equal(trialDays({ CLINFORMS_TRIAL_DAYS: "366" }), 366);
    for (const bad of ["0", "367", "-1", "7.5", "fourteen", "", " "]) assert.equal(trialDays({ CLINFORMS_TRIAL_DAYS: bad }), 14, bad);
    assert.equal(trialReports({}), 10);
    assert.equal(trialReports({ CLINFORMS_TRIAL_REPORTS: "0" }), 0);
    assert.equal(trialReports({ CLINFORMS_TRIAL_REPORTS: "101" }), 10);
    assert.equal(trialTexts({}), 10);
    assert.equal(trialTexts({ CLINFORMS_TRIAL_TEXTS: "25" }), 25);
  });
});

describe("the stop-tips page is a sign-in-type page (review 11)", () => {
  it("no cookie banner, no analytics on /trial/…; robots.txt unchanged", async () => {
    const { AUTH_PATHS, isAuthPath } = await import("./site");
    assert.equal(isAuthPath("/trial/stop-tips"), true);
    assert.equal(isAuthPath("/trialx"), false);
    assert.ok(!(AUTH_PATHS as readonly string[]).includes("/trial"), "kept out of robots.txt (byte-for-byte as before)");
  });
});

describe("trial abuse brake – address, domain and network forms", () => {
  it("addresses: case, +tags and gmail dots ignored; other domains keep their dots", () => {
    assert.equal(canonicalTrialEmail("Dana.Lark+trial2@Gmail.com"), "danalark@gmail.com");
    assert.equal(canonicalTrialEmail("d.a.n.a@googlemail.com"), "dana@gmail.com");
    assert.equal(canonicalTrialEmail("dana.lark+x@larkfield-physio.example"), "dana.lark@larkfield-physio.example");
    assert.equal(ownEmailDomain("x@larkfield-physio.example"), "larkfield-physio.example");
    assert.equal(ownEmailDomain("x@gmail.com"), null);
    assert.equal(ownEmailDomain("x@nhs.net"), null);
  });
});

describe("trial emails – the schedule (UK calendar days)", () => {
  const start = "2026-11-16T15:00:00.000Z"; // a Monday afternoon
  const end = new Date(Date.parse(start) + 14 * DAY).toISOString();
  const facts = (over: Partial<TrialEmailFacts> = {}): TrialEmailFacts => ({ startedAt: start, endsAt: end, paid: false, convertedAt: null, tipsOff: false, done: new Set(), ...over });
  const at = (day: number, hhmm = "03:17") => new Date(`${londonDay(new Date(Date.parse(start) + day * DAY))}T${hhmm}:00.000Z`);
  const sendKinds = (f: TrialEmailFacts, now: Date) => dueTrialEmails(f, now).filter((d) => d.action === "send").map((d) => d.kind);

  it("a whole trial with a nightly run: each email on its day, once", () => {
    const done = new Set<TrialEmailKind>();
    const byDay: Record<number, TrialEmailKind[]> = {};
    for (let day = 0; day <= 20; day++) {
      const now = day === 0 ? new Date(start) : at(day);
      const due = dueTrialEmails(facts({ done }), now);
      byDay[day] = due.filter((d) => d.action === "send").map((d) => d.kind);
      for (const d of due) done.add(d.kind);
    }
    assert.deepEqual(byDay[0], ["welcome"]);
    assert.deepEqual(byDay[3], ["tips"]);
    assert.deepEqual(byDay[10], ["four_days"]);
    assert.deepEqual(byDay[13], ["last_day"]);
    assert.deepEqual(byDay[15], ["ended"], "ends 15:00 on day 14: the 03:17 run of day 15 says so");
    const all = Object.values(byDay).flat();
    assert.equal(all.length, 5);
    for (const day of [1, 2, 4, 5, 6, 7, 8, 9, 11, 12, 14, 16, 17, 18, 19, 20]) assert.deepEqual(byDay[day], [], `day ${day}`);
  });

  it("not started: nothing; paid: 'paid' only (the rest skipped); tips off: welcome and tips skipped", () => {
    assert.deepEqual(dueTrialEmails(facts({ startedAt: null, endsAt: null }), at(5)), []);
    const paid = dueTrialEmails(facts({ paid: true, convertedAt: at(6).toISOString() }), at(6));
    assert.deepEqual(paid.find((d) => d.kind === "paid"), { kind: "paid", action: "send" });
    assert.ok(paid.filter((d) => d.kind !== "paid").every((d) => d.action === "skip"));
    assert.equal(dueTrialEmails(facts({ paid: true, convertedAt: at(1).toISOString() }), at(12)).find((d) => d.kind === "paid")?.action, "skip", "over a week late");
    assert.deepEqual(dueTrialEmails(facts({ tipsOff: true }), at(3)).map((d) => [d.kind, d.action]), [["welcome", "skip"], ["tips", "skip"]]);
  });

  it("late runs never send stale emails: on day 11 only '4 days left'; after the end only 'ended' (within 7 days)", () => {
    assert.deepEqual(sendKinds(facts(), at(11)), ["four_days"]);
    assert.deepEqual(dueTrialEmails(facts(), at(11)).filter((d) => d.action === "skip").map((d) => d.kind), ["welcome", "tips"]);
    assert.deepEqual(sendKinds(facts(), at(16)), ["ended"]);
    assert.deepEqual(sendKinds(facts(), at(23)), [], "more than 7 days after the end");
  });

  it("UK days across the clock change (BST ends 25 October 2026)", () => {
    assert.equal(londonDay("2026-10-24T23:30:00.000Z"), "2026-10-25", "00:30 BST is already the 25th");
    assert.equal(londonDay("2026-10-25T23:30:00.000Z"), "2026-10-25", "23:30 GMT is still the 25th");
    assert.equal(londonDaysBetween("2026-10-20T22:30:00.000Z", "2026-10-30T01:00:00.000Z"), 10);
    assert.equal(londonDaysBetween("2026-10-20T23:30:00.000Z", "2026-10-30T01:00:00.000Z"), 9, "00:30 BST on the 21st");
    const s = "2026-10-20T08:00:00.000Z";
    const e = new Date(Date.parse(s) + 14 * DAY).toISOString();
    assert.deepEqual(sendKinds(facts({ startedAt: s, endsAt: e }), new Date("2026-10-30T03:17:00.000Z")), ["four_days"], "day 10 of a trial that started in BST");
  });
});

/* ------------------------------------------------------------------ after an unpaid trial (14/11/2026) */

it("deletion days: 90 full days after the end (the end's UK day + 91), the warning 14 days before, a late warning keeps 14 days' notice", () => {
  assert.equal(TRIAL_KEEP_DAYS, 90);
  assert.equal(TRIAL_DELETION_NOTICE_DAYS, 14);
  assert.equal(addUkDays("2026-11-30", 91), "2027-03-01");
  assert.equal(addUkDays("2027-03-01", -14), "2027-02-15");
  assert.equal(trialDeletionDay("2026-11-30T15:00:00.000Z"), "2027-03-01");
  assert.equal(trialDeletionWarningDay("2026-11-30T15:00:00.000Z"), "2027-02-15");
  // At least 90 × 24 hours: the earliest deletion moment (00:00 UK on the day) is after end + 90 days, never before.
  for (const end of ["2026-11-30T00:00:00.000Z", "2026-11-30T23:59:00.000Z", "2026-06-30T22:59:00.000Z", "2026-07-01T09:00:00.000Z"]) {
    const start = ukDayStart(trialDeletionDay(end)).getTime();
    assert.ok(start >= Date.parse(end) + 90 * 86_400_000, end);
    assert.ok(start <= Date.parse(end) + 92 * 86_400_000, end);
  }
  // 23:30 UTC on 30 June is 00:30 on 1 July in the UK (BST): the UK day decides.
  assert.equal(trialDeletionDay("2026-06-30T23:30:00.000Z"), addUkDays("2026-07-01", 91));
  // UK midnight: GMT in winter, BST (23:00 UTC the day before) in summer.
  assert.equal(ukDayStart("2027-03-01").toISOString(), "2027-03-01T00:00:00.000Z");
  assert.equal(ukDayStart("2027-07-01").toISOString(), "2027-06-30T23:00:00.000Z");
  // On time: the deletion day itself. Late (the warning goes on 20 Feb): 14 days from then.
  assert.equal(trialDeletionDayIfWarnedAt("2026-11-30T15:00:00.000Z", new Date("2027-02-15T03:17:00.000Z")), "2027-03-01");
  assert.equal(trialDeletionDayIfWarnedAt("2026-11-30T15:00:00.000Z", new Date("2027-02-20T03:17:00.000Z")), "2027-03-06");
  assert.throws(() => addUkDays("1 March", 1));
});
