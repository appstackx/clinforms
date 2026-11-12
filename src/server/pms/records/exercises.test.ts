/**
 * Home exercise programmes (ex03–ex06) on node:sqlite and PGlite: the two switches (platform + clinic), the clinic's
 * library (settings.setup), a programme from draft to shared to a new version, the portal (only the patient's own
 * shared programmes), check-ins (one per day, changed the same day), permissions (reception never; site scope),
 * tenant isolation, encryption at rest, the patient's history, subject access, anonymisation, offboarding and the
 * tenant-scope guard. Pure rules too. Fictional data only. Run by `npm run test:db` and `npm run test:pms`.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { CheckinInputSchema, LinkSchema, ProgrammeItemSchema, adherenceLine, adherenceSummary, doseLine, exerciseSwitchOn, itemFromLibrary } from "../../../modules/pms/records/exercises";
import { RECORDS_AUDIT_LABELS } from "../../../modules/pms/audit/records";
import { runBatch } from "../../db/batch";
import { RECORDS_CASCADE_DELETED_TABLES } from "../../db/pms-schema/records";
import { testCipher } from "../../db/testing/databases";
import { listAudit } from "../../repos/audit";
import type { RepoContext } from "../../repos/context";
import { createCase } from "../../repos/pms/cases";
import { createSite } from "../../repos/pms/directory";
import { createPatient } from "../../repos/pms/patients";
import { setPmsDemoFlag } from "../../repos/pms/settings";
import { updateBookingSettings, getBookingSettings } from "../../repos/pms/portal/settings";
import { listPatientHistory } from "../../repos/pms/records/history";
import { collectSubjectAccess } from "../../repos/pms/records/subject-access";
import { anonymiseExerciseQueries, exerciseTablesInstalled, getProgramme } from "../../repos/pms/records/exercises";
import { createGuardedPgliteDb, createGuardedSqliteDb, unscopedStatements, type GuardedDb } from "../../repos/pms/testing/guarded-db";
import { countPmsRows, deletePmsQueries } from "../offboard";
import { testActor } from "./access";
import {
  addDemoExercisesFor,
  createProgrammeFor,
  endProgrammeFor,
  exerciseSetupFor,
  newVersionFor,
  portalCheckinFor,
  portalProgrammeFor,
  portalProgrammePdfFor,
  portalProgrammesFor,
  programmeFor,
  programmePdfFor,
  programmesFor,
  saveLibraryExerciseFor,
  saveProgrammeFor,
  setExercisesEnabledFor,
  setLibraryExerciseActiveFor,
  shareProgrammeFor,
} from "./exercises-service";
import { subjectAccessSections } from "./subject-access-export";

const ON = { CLINFORMS_EXERCISE: "on" };
const OFF = {};

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

const A = "riverside-hep";
const B = "harbour-hep";
const SEED = { userId: "user_owner_01", sessionId: "sess_owner" };

function suite(label: string, factory: () => Promise<GuardedDb>) {
  describe(`exercise programmes on ${label}`, () => {
    let db: GuardedDb;
    let ctx: RepoContext;
    const id: Record<string, string> = {};
    const owner = (t = A) => ({ ...testActor(ctx, t, "owner", { userId: "user_owner_01", name: "Helen Ward (fictional)" }), clinicName: "Riverside Physio (fictional)" });
    const admin = () => testActor(ctx, A, "admin", { userId: "user_admin_01", name: "Ade Admin (fictional)" });
    const clinician = () => ({ ...testActor(ctx, A, "clinician", { userId: "user_clin_01", name: "Sarah Reid (fictional)" }), clinicName: "Riverside Physio (fictional)" });
    const reception = () => testActor(ctx, A, "staff", { userId: "user_reception_01", name: "Jess Taylor (fictional)" });
    const otherSite = () => testActor(ctx, A, "clinician", { userId: "user_clin_02", name: "Tom Ellis (fictional)" }, { siteIds: [id.site2] });
    const clinic = (t = A) => ({ tenantId: t, name: "Riverside Physio (fictional)", settings: { portal: true } });
    const viewer = (patientId: string) => ({ patientId, actor: { userId: null, sessionId: "psn_test_session" } });
    const ok = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
      if (!r.ok) assert.fail(`expected ok, got: ${r.error}`);
      return r.value;
    };
    const items = [
      { name: "Heel raises (fictional)", sets: 3, reps: 10, timesPerDay: 2, daysPerWeek: 7, instructions: "Rise slowly.", videoUrl: "https://videos.example.org/v/heel" },
      { name: "Seated knee straightening (fictional)", sets: 2, reps: 8, holdSeconds: 5, notes: "Left leg only." },
    ];

    before(async () => {
      db = await factory();
      ctx = { db: db.db, cipher: testCipher(), now: () => new Date("2026-11-12T10:00:00.000Z") };
      id.site = (await createSite(ctx, A, { name: "Harbour Road (fictional)" }, SEED)).id;
      id.site2 = (await createSite(ctx, A, { name: "Mill Lane (fictional)" }, SEED)).id;
      id.patient = (await createPatient(ctx, A, { firstName: "Owen", lastName: "Price", dateOfBirth: "1990-12-02" }, SEED)).id;
      id.patient2 = (await createPatient(ctx, A, { firstName: "Lily", lastName: "Shaw", dateOfBirth: "1985-03-04" }, SEED)).id;
      id.case = (await createCase(ctx, A, { patientId: id.patient, title: "Right knee", openedOn: "2026-11-01", siteId: id.site }, SEED)).id;
      id.otherCase = (await createCase(ctx, A, { patientId: id.patient2, title: "Neck", openedOn: "2026-11-01" }, SEED)).id;
      id.patientB = (await createPatient(ctx, B, { firstName: "Ruth", lastName: "Hale", dateOfBirth: "1970-01-01" }, { userId: "user_b", sessionId: "sess_b" })).id;
      const s = await getBookingSettings(ctx, A);
      assert.ok((await updateBookingSettings(ctx, A, s.rev, { portal: true }, SEED)).ok);
    });
    after(async () => {
      await db?.close();
    });

    it("platform switch off: nothing exists – set-up, record and portal all answer not found / empty", async () => {
      assert.equal((await exerciseSetupFor(owner(), OFF)).ok, false);
      const r = await setExercisesEnabledFor(owner(), true, OFF);
      assert.ok(!r.ok && r.code === "not_found");
      assert.ok(!(await programmesFor(owner(), id.patient, ON)).ok, "the clinic's own setting is still off");
      assert.deepEqual(await portalProgrammesFor(ctx, clinic(), id.patient, ON), []);
      assert.ok(await exerciseTablesInstalled(ctx, A));
    });

    it("Set-up → Exercises: settings.setup only; the clinic switch; the library (https links; archive, restore)", async () => {
      assert.equal((await exerciseSetupFor(clinician(), ON)).ok, false, "a clinician has no settings.setup");
      assert.equal((await exerciseSetupFor(reception(), ON)).ok, false);
      assert.equal(ok(await exerciseSetupFor(admin(), ON)).enabled, false, "off by default");
      assert.equal(ok(await setExercisesEnabledFor(admin(), true, ON)).changed, true);
      assert.equal(ok(await setExercisesEnabledFor(admin(), true, ON)).changed, false, "no change, no audit row");
      const bad = await saveLibraryExerciseFor(owner(), { name: "", videoUrl: "http://insecure.example.org" }, ON);
      assert.ok(!bad.ok && bad.fieldErrors?.name && /https/.test(bad.fieldErrors.videoUrl ?? ""), JSON.stringify(bad));
      const ex = ok(await saveLibraryExerciseFor(owner(), { name: "Heel raises (fictional)", bodyArea: "Ankle and foot", instructions: "Rise slowly.", videoUrl: "https://videos.example.org/v/heel" }, ON));
      id.libEx = ex.id;
      const changed = ok(await saveLibraryExerciseFor(owner(), { id: ex.id, rev: ex.rev, name: "Heel raises at a counter (fictional)", bodyArea: "Ankle and foot" }, ON));
      const stale = await saveLibraryExerciseFor(owner(), { id: ex.id, rev: ex.rev, name: "Lost update" }, ON);
      assert.ok(!stale.ok && stale.code === "conflict");
      const archived = ok(await setLibraryExerciseActiveFor(owner(), ex.id, changed.rev, false, ON));
      ok(await setLibraryExerciseActiveFor(owner(), ex.id, archived.rev, true, ON));
      assert.equal((await saveLibraryExerciseFor(clinician(), { name: "x" }, ON)).ok, false);
      // Demo exercises: only for a demonstration clinic.
      assert.equal((await addDemoExercisesFor(owner(), ON)).ok, false);
      await setPmsDemoFlag(ctx, A, true, SEED);
      assert.equal(ok(await addDemoExercisesFor(owner(), ON)).added, 6);
      assert.equal(ok(await addDemoExercisesFor(owner(), ON)).added, 0, "never twice");
      const lib = ok(await exerciseSetupFor(owner(), ON)).library;
      assert.equal(lib.length, 7);
      assert.ok(lib.filter((e) => e.id !== id.libEx).every((e) => / \(demo\)$/.test(e.name)));
      // Another clinic sees none of it, and its switch is still off.
      assert.equal(ok(await exerciseSetupFor(owner(B), ON)).library.length, 0);
      assert.equal(ok(await exerciseSetupFor(owner(B), ON)).enabled, false);
    });

    it("builder: a clinician starts and edits a draft (library copy + own exercise); reception never; site scope; the case must be the patient's", async () => {
      assert.equal((await createProgrammeFor(reception(), id.patient, { title: "x", items: [] }, ON)).ok, false);
      assert.equal((await programmesFor(reception(), id.patient, ON)).ok, false, "reception cannot even list them");
      const wrongCase = await createProgrammeFor(clinician(), id.patient, { title: "Knee", caseId: id.otherCase, items: [] }, ON);
      assert.ok(!wrongCase.ok && /case/.test(wrongCase.error));
      id.prog = ok(await createProgrammeFor(clinician(), id.patient, { title: "Knee – weeks 1 to 2", caseId: id.case, items: [] }, ON)).id;
      const p = ok(await programmeFor(clinician(), id.patient, id.prog, {}, ON));
      assert.equal(p.programme.status, "draft");
      assert.ok(p.library.length >= 1, "the builder gets the active library");
      const fromLib = itemFromLibrary(p.library.find((e) => e.id === id.libEx)!);
      const saved = ok(await saveProgrammeFor(clinician(), id.patient, id.prog, p.programme.rev, { title: "Knee – weeks 1 to 2", notes: "Little and often.", caseId: id.case, items: [{ ...fromLib, sets: 3, reps: 10 }, items[1]] }, ON));
      const stale = await saveProgrammeFor(clinician(), id.patient, id.prog, p.programme.rev, { title: "x", items: [] }, ON);
      assert.ok(!stale.ok && stale.code === "conflict");
      const full = (await getProgramme(ctx, A, id.prog))!;
      assert.equal(full.items.length, 2);
      assert.equal(full.items[0].exerciseId, id.libEx);
      assert.equal(saved.rev, full.rev);
      // Wrong patient in the URL, another clinic, another site: not found.
      assert.equal((await programmeFor(clinician(), id.patient2, id.prog, {}, ON)).ok, false);
      assert.equal((await programmeFor(owner(B), id.patient, id.prog, {}, ON)).ok, false);
      assert.equal((await programmeFor(otherSite(), id.patient, id.prog, {}, ON)).ok, false, "the patient is not seen at the member's site");
      // Encrypted at rest: no title, note or exercise in the row.
      const raw = await ctx.db.selectFrom("pms_exercise_programmes").selectAll().where("tenant_id", "=", A).where("id", "=", id.prog).executeTakeFirstOrThrow();
      for (const text of ["Knee", "Little and often", "Heel raises", "Left leg"]) assert.ok(!JSON.stringify(raw).includes(text), text);
    });

    it("draft is invisible to the patient; sharing locks it and puts it in the portal; the first open is recorded", async () => {
      assert.deepEqual(await portalProgrammesFor(ctx, clinic(), id.patient, ON), []);
      assert.equal(await portalProgrammeFor(ctx, clinic(), viewer(id.patient), id.prog, ON), null);
      const empty = ok(await createProgrammeFor(clinician(), id.patient, { title: "Empty", items: [] }, ON));
      const er = await shareProgrammeFor(clinician(), id.patient, empty.id, 1, ON);
      assert.ok(!er.ok && /at least one/.test(er.error));
      ok(await endProgrammeFor(clinician(), id.patient, empty.id, 1, ON));
      const rev = (await getProgramme(ctx, A, id.prog))!.rev;
      assert.equal((await shareProgrammeFor(admin(), id.patient, id.prog, rev, ON)).ok, false, "an admin has no clinical.write by default");
      const shared = ok(await shareProgrammeFor(clinician(), id.patient, id.prog, rev, ON));
      assert.equal(shared.portal, true);
      const locked = await saveProgrammeFor(clinician(), id.patient, id.prog, shared.rev, { title: "x", items: [] }, ON);
      assert.ok(!locked.ok && /locked/.test(locked.error));
      const rows = await portalProgrammesFor(ctx, clinic(), id.patient, ON);
      assert.deepEqual(rows.map((r) => [r.title, r.itemCount, r.checkedInToday]), [["Knee – weeks 1 to 2", 2, false]]);
      assert.deepEqual(await portalProgrammesFor(ctx, clinic(), id.patient2, ON), [], "another patient sees nothing");
      assert.equal(await portalProgrammeFor(ctx, clinic(), viewer(id.patient2), id.prog, ON), null, "not theirs");
      assert.equal(await portalProgrammeFor(ctx, clinic(B), viewer(id.patient), id.prog, ON), null, "another clinic's address");
      assert.equal(await portalProgrammeFor(ctx, { ...clinic(), settings: { portal: false } }, viewer(id.patient), id.prog, ON), null, "portal off");
      assert.equal(await portalProgrammeFor(ctx, clinic(), viewer(id.patient), id.prog, OFF), null, "platform off");
      const view = (await portalProgrammeFor(ctx, clinic(), viewer(id.patient), id.prog, ON))!;
      assert.equal(view.programme.items[1].notes, "Left leg only.");
      assert.equal(view.programme.sharedByName, "Sarah Reid (fictional)");
      await portalProgrammeFor(ctx, clinic(), viewer(id.patient), id.prog, ON);
      const opened = (await listAudit(ctx, A, { limit: 500 })).filter((e) => e.action === "pms.exercise_programme.portal_view" && e.targetId === id.prog);
      assert.equal(opened.length, 1, "the first open only");
    });

    it("check-ins: the patient's own, one per day (a second the same day changes it); visible to the clinician with adherence", async () => {
      const bad = await portalCheckinFor(ctx, clinic(), viewer(id.patient), id.prog, { completed: true, painScore: 12 }, ON);
      assert.ok(!bad.ok && bad.fieldErrors?.painScore);
      assert.equal((await portalCheckinFor(ctx, clinic(), viewer(id.patient2), id.prog, { completed: true }, ON)).ok, false, "not theirs");
      assert.ok((await portalCheckinFor(ctx, clinic(), viewer(id.patient), id.prog, { completed: false, painScore: 6, comment: "Knee sore after work (fictional)" }, ON)).ok);
      assert.ok((await portalCheckinFor(ctx, clinic(), viewer(id.patient), id.prog, { completed: true, painScore: 4, comment: "Did them in the evening (fictional)" }, ON)).ok);
      const v = ok(await programmeFor(clinician(), id.patient, id.prog, { recordView: true }, ON));
      assert.equal(v.checkins.length, 1, "one row for today");
      assert.deepEqual([v.checkins[0].completed, v.checkins[0].painScore, v.checkins[0].comment], [true, 4, "Did them in the evening (fictional)"]);
      assert.deepEqual([v.adherence.checkins, v.adherence.completed, v.adherence.latestPain], [1, 1, 4]);
      assert.equal((await portalProgrammesFor(ctx, clinic(), id.patient, ON))[0].checkedInToday, true);
      const list = ok(await programmesFor(clinician(), id.patient, ON));
      assert.equal(list.programmes.find((p) => p.id === id.prog)?.adherence.completed, 1);
      const raw = await ctx.db.selectFrom("pms_exercise_checkins").select("comment_enc").where("tenant_id", "=", A).executeTakeFirstOrThrow();
      assert.ok(raw.comment_enc && !raw.comment_enc.includes("evening"), "the comment is encrypted");
      // No pain score or comment in any audit row.
      const audits = await listAudit(ctx, A, { limit: 500 });
      assert.ok(!JSON.stringify(audits).match(/evening|sore|painScore|Knee –|Heel raises/), "audit rows hold ids only");
    });

    it("PDF for the clinician and for the patient (their own, shared only); both recorded in the history", async () => {
      const staff = ok(await programmePdfFor(clinician(), id.patient, id.prog, ON));
      assert.equal(Buffer.from(staff.bytes.slice(0, 5)).toString(), "%PDF-");
      assert.equal(staff.fileName, "home-exercises-2026-11-12.pdf");
      assert.equal((await programmePdfFor({ ...reception(), clinicName: "x" }, id.patient, id.prog, ON)).ok, false);
      const mine = await portalProgrammePdfFor(ctx, clinic(), viewer(id.patient), id.prog, ON);
      assert.ok(mine && mine.bytes.byteLength > 1000);
      assert.equal(await portalProgrammePdfFor(ctx, clinic(), viewer(id.patient2), id.prog, ON), null);
      const history = (await listPatientHistory(ctx, A, id.patient)).map((e) => e.action);
      for (const a of ["pms.exercise_programme.create", "pms.exercise_programme.share", "pms.exercise_programme.view", "pms.exercise_programme.pdf", "pms.exercise_programme.portal_pdf", "pms.exercise_checkin.record"]) assert.ok(history.includes(a), a);
    });

    it("a new version: a copy as a draft; sharing it ends the old one in the same batch (the patient never sees both)", async () => {
      const v2 = ok(await newVersionFor(clinician(), id.patient, id.prog, ON)).id;
      const draft = (await getProgramme(ctx, A, v2))!;
      assert.deepEqual([draft.status, draft.replacesId, draft.items.length, draft.caseId], ["draft", id.prog, 2, id.case]);
      assert.equal((await portalProgrammesFor(ctx, clinic(), id.patient, ON)).length, 1, "still the old one only");
      ok(await shareProgrammeFor(clinician(), id.patient, v2, draft.rev, ON));
      assert.equal((await getProgramme(ctx, A, id.prog))!.status, "ended");
      assert.deepEqual((await portalProgrammesFor(ctx, clinic(), id.patient, ON)).map((r) => r.id), [v2]);
      const late = await portalCheckinFor(ctx, clinic(), viewer(id.patient), id.prog, { completed: true }, ON);
      assert.equal(late.ok, false, "an ended programme takes no check-ins");
      id.prog2 = v2;
    });

    it("the clinic switch off hides everything again (data kept); subject access includes it either way", async () => {
      ok(await setExercisesEnabledFor(owner(), false, ON));
      assert.equal((await programmesFor(clinician(), id.patient, ON)).ok, false);
      assert.deepEqual(await portalProgrammesFor(ctx, clinic(), id.patient, ON), []);
      const data = (await collectSubjectAccess(ctx, A, id.patient))!;
      assert.equal(data.exercises.length, 3);
      const section = subjectAccessSections(data, []).find((s) => s.id === "exercises")!;
      assert.ok(JSON.stringify(section).includes("Did them in the evening (fictional)"));
      ok(await setExercisesEnabledFor(owner(), true, ON));
    });

    it("anonymisation clears the text (kept: dates and statuses)", async () => {
      await runBatch(ctx.db, anonymiseExerciseQueries(ctx, A, id.patient, "2026-11-12T11:00:00.000Z"));
      const p = (await getProgramme(ctx, A, id.prog2))!;
      assert.deepEqual([p.title, p.notes, p.items.length, p.status], [null, null, 0, "ended"]);
      const ck = await ctx.db.selectFrom("pms_exercise_checkins").select(["comment_enc", "anonymised_at"]).where("tenant_id", "=", A).execute();
      assert.ok(ck.every((c) => c.comment_enc === null && c.anonymised_at));
    });

    it("offboarding: the four tables go by cascade – none is named, none is left", async () => {
      const before = await countPmsRows(db.db, A);
      for (const t of RECORDS_CASCADE_DELETED_TABLES) assert.ok((before[t] ?? 0) > 0, `${t} has rows`);
      const queries = deletePmsQueries(db.db, A, { only: Object.keys(before) });
      const named = queries.map((q) => ("compile" in q && typeof q.compile === "function" ? q.compile().sql : ""));
      for (const t of RECORDS_CASCADE_DELETED_TABLES) assert.ok(!named.some((s) => s.includes(`"${t}"`)), `${t} is not named`);
      await runBatch(db.db, queries);
      assert.deepEqual(await countPmsRows(db.db, A), {});
      assert.ok((await countPmsRows(db.db, B)).pms_patients, "the other clinic untouched");
    });

    it("every statement names the clinic (tenant-scope guard)", () => {
      assert.deepEqual(unscopedStatements(db.log.statements), []);
    });
  });
}

suite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
suite("Postgres (PGlite)", () => createGuardedPgliteDb());
