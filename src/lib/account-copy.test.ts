/**
 * Customer-facing wording added for the Blue Heart release (24/10/2026): one source (this module), neutral, and true
 * to what the code does – the trial's made-up-notes rule, the drafting switch during a trial, the retention job, the
 * invitation outcomes and the owner reset link.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { BANNED_TERM_PATTERNS } from "../modules/medreport/core/wording";
import { DRAFTING_COPY, INVITE_COPY, OWNER_RESET_COPY, RETENTION_COPY, TRIAL_COPY, TRIAL_NOTES_RULE, type InviteDelivery } from "./account-copy";
import { TRIAL_COPY as TRIAL_COPY_FROM_BANNER } from "./trial-copy";

const DELIVERIES: InviteDelivery[] = ["sent", "failed", "off", "withheld"];

function allTexts(): string[] {
  return [
    TRIAL_NOTES_RULE,
    TRIAL_COPY.running(3),
    TRIAL_COPY.running(1),
    TRIAL_COPY.ended("help@example.test"),
    TRIAL_COPY.platformDescription,
    ...Object.values(DRAFTING_COPY),
    RETENTION_COPY.hint(30, 3650),
    ...DELIVERIES.flatMap((d) => [INVITE_COPY.outcome(d, "new@clinic.example"), INVITE_COPY.linkLabel(d), INVITE_COPY.linkWarning(d, "in 7 days")]),
    OWNER_RESET_COPY.note,
    OWNER_RESET_COPY.soleOwner("help@example.test"),
    OWNER_RESET_COPY.notArrived("help@example.test"),
  ];
}

test("neutral wording: every new text passes the banned terms", () => {
  for (const text of allTexts()) for (const re of BANNED_TERM_PATTERNS) assert.doesNotMatch(text, re, text);
});

test("trial: made-up notes only, from one source (the banner re-exports it); the drafting switch agrees during a trial", () => {
  assert.equal(TRIAL_COPY_FROM_BANNER, TRIAL_COPY, "trial-copy.ts re-exports account-copy's wording");
  assert.equal(TRIAL_COPY.running(3), "Trial – 3 days left. Use made-up notes only until your data processing agreement is signed.");
  assert.equal(DRAFTING_COPY.whenToSwitchOnTrial, "During your trial, switch this on to try drafting with made-up notes only.");
  for (const text of [TRIAL_COPY.running(2), TRIAL_COPY.platformDescription, DRAFTING_COPY.whenToSwitchOnTrial, DRAFTING_COPY.checklistOffTrial]) {
    assert.match(text, /made-up notes only/);
    assert.doesNotMatch(text, /anonymised/i, "no real (even anonymised) patient notes in a trial");
  }
  // the standard wording (no trial) is unchanged
  assert.match(DRAFTING_COPY.whenToSwitchOn, /^It is off until your clinic switches it on\. Switch it on only once your clinic has signed the data processing agreement/);
  // the trial variants never tell a trial clinic to wait for the agreement before trying drafting
  assert.doesNotMatch(DRAFTING_COPY.whenToSwitchOnTrial + DRAFTING_COPY.checklistOffTrial, /once the agreement is signed|only once your clinic has signed/);
});

test("the trial wording is used where the clinic sees it (no copy of the text in the pages)", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(p), "utf8");
  const form = read("src/app/app/(clinic)/settings/clinic/form.tsx");
  assert.match(form, /trial \? DRAFTING_COPY\.whenToSwitchOnTrial : DRAFTING_COPY\.whenToSwitchOn/);
  assert.match(read("src/app/app/(clinic)/page.tsx"), /trial \? DRAFTING_COPY\.checklistOffTrial : DRAFTING_COPY\.checklistOff/);
  assert.match(read("src/app/app/platform/page.tsx"), /TRIAL_COPY\.platformDescription/);
  for (const file of ["src/app/app/(clinic)/settings/clinic/form.tsx", "src/app/app/(clinic)/page.tsx", "src/app/app/platform/page.tsx", "src/lib/trial-copy.ts"]) {
    assert.doesNotMatch(read(file), /made-up or anonymised|anonymised notes/, file);
  }
});

test("retention: the Clinic page says what the nightly job deletes, when, and what it keeps – no 'coming soon'", () => {
  const hint = RETENTION_COPY.hint(30, 3650);
  assert.match(hint, /^30–3650 days\./);
  assert.match(hint, /Every night/, "the job runs daily (vercel.json crons 17 3 * * *)");
  assert.match(hint, /not been changed for this many days/, "measured from the last change (updated_at)");
  assert.match(hint, /drafts and approved reports, with the notes they were made from/, "every report of the clinic, whatever its status");
  assert.match(hint, /A shorter period applies to existing reports from the next night/, "the period is read at run time");
  assert.match(hint, /forms library, clinic details, members and activity log are kept/);
  assert.doesNotMatch(hint, /coming soon/i);
  const form = fs.readFileSync(path.resolve("src/app/app/(clinic)/settings/clinic/form.tsx"), "utf8");
  assert.match(form, /RETENTION_COPY\.hint\(RETENTION_MIN_DAYS, RETENTION_MAX_DAYS\)/);
  assert.doesNotMatch(form, /coming soon/i);
  // the schedule the text promises
  const vercel = JSON.parse(fs.readFileSync(path.resolve("vercel.json"), "utf8")) as { crons?: { path: string; schedule: string }[] };
  assert.deepEqual(vercel.crons?.find((c) => c.path === "/api/cron/retention")?.schedule, "17 3 * * *");
});

test("invitations: what happened, and the link always with a do-not-forward warning", () => {
  assert.equal(INVITE_COPY.outcome("sent", "new@clinic.example"), "Invitation emailed to new@clinic.example.");
  assert.match(INVITE_COPY.outcome("failed", "new@clinic.example"), /could not be sent\. Pass the link below to them yourself\./);
  assert.match(INVITE_COPY.outcome("off", "new@clinic.example"), /^Email is not set up, so nothing was sent\./);
  assert.match(INVITE_COPY.outcome("withheld", "new@clinic.example"), /not emailed, as you chose/);
  for (const d of DELIVERIES) {
    const warning = INVITE_COPY.linkWarning(d, "in 7 days");
    assert.match(warning, /Do not forward it to anyone else/);
    assert.match(warning, /expires in 7 days\.$/);
  }
  assert.match(INVITE_COPY.linkWarning("sent", "in 7 days"), /^Keep this copy only in case the email does not arrive\./);
  assert.equal(INVITE_COPY.linkLabel("sent"), "A copy of the invitation link");
});

test("owner reset: shown once, expires, identity check first; a sole owner is pointed to support", () => {
  assert.match(OWNER_RESET_COPY.note, /^Shown only this once\. It works once and expires in 2 hours\./);
  assert.match(OWNER_RESET_COPY.note, /Confirm who you are speaking to/);
  assert.equal(OWNER_RESET_COPY.soleOwner("help@example.test"), "If you are your clinic's only owner, contact us at help@example.test.");
  assert.match(OWNER_RESET_COPY.notArrived("help@example.test"), /only owner, contact us at help@example\.test\.$/);
});
