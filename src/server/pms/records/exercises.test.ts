/**
 * Home exercise programmes (ex03–ex06) on node:sqlite and PGlite: the two switches (platform + clinic), the clinic's
 * library (settings.setup), a programme from draft to shared to a new version, the portal (only the patient's own
 * shared programmes), check-ins (one per day, changed the same day), permissions (reception never; site scope),
 * tenant isolation, encryption at rest, the patient's history, subject access, anonymisation, offboarding and the
 * tenant-scope guard. Pure rules too. Fictional data only. Run by `npm run test:db` and `npm run test:pms`.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { CheckinInputSchema, LinkSchema, ProgrammeItemSchema, adherenceLine, adherenceSummary, doseLine, exerciseSwitchOn } from "../../../modules/pms/records/exercises";
import { RECORDS_AUDIT_LABELS } from "../../../modules/pms/audit/records";
import { createGuardedPgliteDb, createGuardedSqliteDb } from "../../repos/pms/testing/guarded-db";
import { defineExerciseSuite } from "./testing/exercises-suite";

describe("exercise programmes (pure)", () => {
  it("the platform switch is 'on' only", () => {
    assert.equal(exerciseSwitchOn({ CLINFORMS_EXERCISE: " ON " }), true);
    for (const v of [undefined, "", "1", "true", "yes", "off"]) assert.equal(exerciseSwitchOn({ CLINFORMS_EXERCISE: v }), false, String(v));
  });
  it("links: https only, no credentials, at most 500 characters", () => {
    assert.equal(LinkSchema.parse("https://videos.example.org/v/abc"), "https://videos.example.org/v/abc");
    assert.equal(LinkSchema.parse("  "), null);
    for (const bad of ["http://example.org/x", "javascript:alert(1)", "https://user:pw@example.org/", "data:text/html,x", "example.org", `https://example.org/${"a".repeat(600)}`]) {
      assert.equal(LinkSchema.safeParse(bad).success, false, bad);
    }
  });
  it("dose: whole numbers in range, blank = none; the dose line names only what is set", () => {
    const item = ProgrammeItemSchema.parse({ name: "Heel raises", sets: "3", reps: 10, holdSeconds: "", timesPerDay: 2, daysPerWeek: 7 });
    assert.equal(doseLine(item), "3 sets × 10 reps · 2 times a day · every day");
    assert.equal(doseLine({ sets: 1, reps: null, holdSeconds: 5, timesPerDay: 1, daysPerWeek: 3 }), "1 set · hold 5 s · once a day · 3 days a week");
    for (const bad of [{ sets: 0 }, { reps: 101 }, { holdSeconds: 1.5 }, { daysPerWeek: 8 }, { timesPerDay: "x" }]) {
      assert.equal(ProgrammeItemSchema.safeParse({ name: "x", ...bad }).success, false, JSON.stringify(bad));
    }
    assert.equal(ProgrammeItemSchema.safeParse({ name: "  " }).success, false, "a name is needed");
  });
  it("check-in input: done yes/no, pain 0–10 or none, comment ≤ 500", () => {
    assert.deepEqual(CheckinInputSchema.parse({ completed: true, painScore: "4", comment: " ok " }), { completed: true, painScore: 4, comment: "ok" });
    assert.equal(CheckinInputSchema.parse({ completed: false, painScore: "" }).painScore, null);
    assert.equal(CheckinInputSchema.safeParse({ completed: true, painScore: 11 }).success, false);
    assert.equal(CheckinInputSchema.safeParse({ completed: true, comment: "x".repeat(501) }).success, false);
    assert.equal(CheckinInputSchema.safeParse({ painScore: 2 }).success, false, "done is required");
  });
  it("adherence over the last 14 days (today included); the latest pain from any day", () => {
    const a = adherenceSummary(
      [
        { doneOn: "2026-11-12", completed: true, painScore: null },
        { doneOn: "2026-11-11", completed: false, painScore: 6 },
        { doneOn: "2026-11-10", completed: true, painScore: 3 },
        { doneOn: "2026-10-01", completed: true, painScore: 9 },
      ],
      "2026-11-12",
    );
    assert.deepEqual(a, { days: 14, checkins: 3, completed: 2, lastOn: "2026-11-12", latestPain: 6, averagePain: 4.5 });
    assert.equal(adherenceLine(a), "Did the exercises on 2 of the last 14 days (3 check-ins)");
    assert.equal(adherenceLine(adherenceSummary([], "2026-11-12")), null);
  });
  it("audit labels exist for every action the feature writes", () => {
    for (const a of ["settings.update", "create", "update", "archive", "restore"]) assert.ok(RECORDS_AUDIT_LABELS[`pms.exercise${a.startsWith("settings") ? "_settings.update" : `.${a}`}`], a);
    for (const a of ["create", "save", "share", "end", "view", "pdf", "portal_view", "portal_pdf"]) assert.ok(RECORDS_AUDIT_LABELS[`pms.exercise_programme.${a}`], a);
    assert.ok(RECORDS_AUDIT_LABELS["pms.exercise_checkin.record"]);
  });
});

defineExerciseSuite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
defineExerciseSuite("Postgres (PGlite)", () => createGuardedPgliteDb());
