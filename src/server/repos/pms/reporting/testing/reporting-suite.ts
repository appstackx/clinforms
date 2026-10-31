/**
 * TESTS ONLY: the reporting and set-up module's repository suite – opening hours and closures (and the diary
 * following them: one opening-hours source), report targets, the audit search and the figures from the shared
 * record (the report loaders have their own service suite). Run unchanged on node:sqlite and PGlite (../reporting-repos.test.ts) and on D1 through the
 * gateway (workers/data-gateway/test/pms-reporting-stack.test.ts); with a query log it ends with the tenant-scope
 * guard (every clinic-system statement names tenant_id).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import type { Database } from "../../../../db/schema";
import { testCipher } from "../../../../db/testing/databases";
import { listAudit } from "../../../audit";
import { RepoInputError, type RepoContext } from "../../../context";
import { bulkCreateAuthorisations, createCase } from "../../cases";
import { createPractitioner, createRoom, createSite } from "../../directory";
import { createPatient } from "../../patients";
import { createReferrer } from "../../referrers";
import { unscopedStatements, type QueryLog } from "../../testing/guarded-db";
import { auditIdRange } from "../../../../../modules/pms/reporting/audit-search";
import { searchAudit } from "../audit-search";
import { addClosure, getClosure, listClosures, listOpeningHours, removeClosure, setOpeningHours } from "../opening-hours";
import {
  authorisationsForReview,
  casesClosedIn,
  casesOpenedBy,
  newPatientsByMonth,
  openCaseload,
  patientMixByCases,
  patientsRegistered,
  referralSources,
  referrerNames,
} from "../record-figures";
import { getReportingSettings, updateReportingSettings } from "../settings";
import { availabilityWindows, createAvailability } from "../../diary/availability";
import { findFreeSlots } from "../../diary/slots";

export interface ReportingSuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
  log?: QueryLog;
}

const A = "riverside-a";
const B = "harbour-b";
const ACTOR = { userId: "user_owner_a", sessionId: "sess_a" };
const ACTOR_B = { userId: "user_owner_b", sessionId: "sess_b" };

async function rejects(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(promise, (err: unknown) => err instanceof RepoInputError && pattern.test(err.message));
}

export function defineReportingRepoSuite(label: string, factory: () => Promise<ReportingSuiteDb>): void {
  describe(`clinic-system reporting and set-up on ${label}`, () => {
    let suite: ReportingSuiteDb;
    let ctx: RepoContext;
    let clock = Date.parse("2026-10-20T09:00:00.000Z");
    const tick = (ms = 1000) => {
      clock += ms;
    };
    const ids: Record<string, string> = {};

    before(async () => {
      suite = await factory();
      ctx = { db: suite.db, cipher: testCipher(), now: () => new Date(clock) };
      // Directory and record of two clinics (the foundation's repositories).
      ids.s1 = (await createSite(ctx, A, { name: "Bletchley (fictional)", code: "BLE" }, ACTOR)).id;
      ids.s2 = (await createSite(ctx, A, { name: "Wolverton (fictional)", code: "WOL" }, ACTOR)).id;
      ids.sB = (await createSite(ctx, B, { name: "Harbour (fictional)" }, ACTOR_B)).id;
      ids.r1 = (await createRoom(ctx, A, { siteId: ids.s1, name: "Room 1" }, ACTOR)).id;
      ids.r2 = (await createRoom(ctx, A, { siteId: ids.s1, name: "Room 2" }, ACTOR)).id;
      ids.r3 = (await createRoom(ctx, A, { siteId: ids.s2, name: "Room 1" }, ACTOR)).id;
      ids.p1 = (await createPractitioner(ctx, A, { displayName: "Sarah Reid", registrationNumber: "PH-DEMO-01", defaultSiteId: ids.s1 }, ACTOR)).id;
      ids.p2 = (await createPractitioner(ctx, A, { displayName: "Tom Ellis", registrationNumber: "PH-DEMO-02", defaultSiteId: ids.s2 }, ACTOR)).id;
      ids.ins = (await createReferrer(ctx, A, { kind: "insurer", name: "Northwell Health Insurance (fictional)" }, ACTOR)).id;
      ids.gp = (await createReferrer(ctx, A, { kind: "gp", name: "Dr Amara Okafor (fictional)" }, ACTOR)).id;
      ids.insB = (await createReferrer(ctx, B, { kind: "insurer", name: "Other clinic's insurer (fictional)" }, ACTOR_B)).id;
      ids.megan = (await createPatient(ctx, A, { firstName: "Megan", lastName: "Hart", importRef: "sim-pat-001" }, ACTOR)).id;
      ids.daniel = (await createPatient(ctx, A, { firstName: "Daniel", lastName: "Brooks", importRef: "sim-pat-002" }, ACTOR)).id;
      ids.cara = (await createPatient(ctx, A, { firstName: "Cara", lastName: "Nolan", preferredName: "Cee", importRef: "sim-pat-007" }, ACTOR)).id;
      ids.patB = (await createPatient(ctx, B, { firstName: "Bea", lastName: "Other" }, ACTOR_B)).id;
      // Megan: an old case (2025) and a new one in October; Daniel and Cara: first cases in October.
      await createCase(ctx, A, { patientId: ids.megan, title: "Right knee", openedOn: "2025-03-01", closedOn: "2025-05-01", status: "closed", siteId: ids.s1, practitionerId: ids.p1, referrerId: ids.gp }, ACTOR);
      ids.c1 = (await createCase(ctx, A, { patientId: ids.megan, title: "Neck", openedOn: "2026-10-02", siteId: ids.s1, practitionerId: ids.p1, payerType: "insurer", payerReferrerId: ids.ins, referrerId: ids.ins, referralReason: "Whiplash after a collision" }, ACTOR)).id;
      ids.c2 = (await createCase(ctx, A, { patientId: ids.daniel, title: "Lower back", openedOn: "2026-10-05", siteId: ids.s2, practitionerId: ids.p2, referrerId: ids.gp }, ACTOR)).id;
      ids.c3 = (await createCase(ctx, A, { patientId: ids.cara, title: "Shoulder", openedOn: "2026-09-28", closedOn: "2026-10-15", status: "discharged", siteId: ids.s2, practitionerId: ids.p2 }, ACTOR)).id;
      await createCase(ctx, B, { patientId: ids.patB, title: "Other clinic", openedOn: "2026-10-03", siteId: ids.sB }, ACTOR_B);
      await bulkCreateAuthorisations(
        ctx,
        A,
        [
          { caseId: ids.c1, patientId: ids.megan, referrerId: ids.ins, code: "NW-SOON", sessionsAuthorised: 6, sessionsUsed: 2, expiresOn: "2026-10-30", notes: "Phone authorisation from the claims team" },
          { caseId: ids.c2, patientId: ids.daniel, code: "LAST-ONE", sessionsAuthorised: 4, sessionsUsed: 3, expiresOn: "2027-02-01" },
          { caseId: ids.c2, patientId: ids.daniel, code: "FAR", sessionsAuthorised: 10, sessionsUsed: 1, expiresOn: "2027-06-01" },
        ],
        ACTOR,
      );
    });
    after(async () => {
      await suite?.close();
    });

    it("opening hours: a site's week replaced as a whole, validated, never across clinics", async () => {
      const week = await setOpeningHours(
        ctx,
        A,
        {
          siteId: ids.s1,
          sessions: [
            { weekday: 2, opensAt: "09:00", closesAt: "17:00" },
            { weekday: 1, opensAt: "13:00", closesAt: "20:00" },
            { weekday: 1, opensAt: "08:00", closesAt: "12:00" },
          ],
        },
        ACTOR,
      );
      assert.deepEqual(week.map((s) => [s.weekday, s.opensAt, s.closesAt]), [[1, "08:00", "12:00"], [1, "13:00", "20:00"], [2, "09:00", "17:00"]]);
      const again = await setOpeningHours(ctx, A, { siteId: ids.s1, sessions: [{ weekday: 1, opensAt: "08:00", closesAt: "18:00" }, { weekday: 2, opensAt: "08:00", closesAt: "18:00" }] }, ACTOR);
      assert.equal(again.length, 2, "the old week is gone");
      await setOpeningHours(ctx, A, { siteId: ids.s2, sessions: [{ weekday: 1, opensAt: "09:00", closesAt: "13:00" }] }, ACTOR);
      await rejects(setOpeningHours(ctx, A, { siteId: ids.s1, sessions: [{ weekday: 1, opensAt: "08:00", closesAt: "12:00" }, { weekday: 1, opensAt: "11:00", closesAt: "15:00" }] }, ACTOR), /overlap/);
      await rejects(setOpeningHours(ctx, B, { siteId: ids.s1, sessions: [{ weekday: 1, opensAt: "08:00", closesAt: "12:00" }] }, ACTOR_B), /site does not exist/);
      await rejects(setOpeningHours(ctx, A, { siteId: ids.sB, sessions: [{ weekday: 1, opensAt: "08:00", closesAt: "12:00" }] }, ACTOR), /site does not exist/);
      await rejects(setOpeningHours(ctx, A, { siteId: ids.s1, sessions: [] }, ACTOR), /at least one day/);
      assert.equal((await listOpeningHours(ctx, B)).length, 0, "the other clinic sees none");
      assert.equal((await listOpeningHours(ctx, A, { siteIds: [ids.s2] })).length, 1);
      assert.equal((await listOpeningHours(ctx, A, { siteIds: [] })).length, 0);
      const audit = await listAudit(ctx, A, { action: "pms.opening_hours.set" });
      assert.equal(audit.length, 3);
      assert.deepEqual(audit[0].detail, { sessions: 1, days: 1 });
      assert.equal(audit[0].targetId, ids.s2);
    });

    it("closures: one site or every site, overlap search, removal audited, never across clinics", async () => {
      tick();
      const xmas = await addClosure(ctx, A, { startsOn: "2026-12-25", endsOn: "2026-12-26", reason: "Bank holidays" }, ACTOR);
      assert.equal(xmas.siteId, null);
      const training = await addClosure(ctx, A, { siteId: ids.s1, startsOn: "2026-10-12", reason: "Staff training" }, ACTOR);
      assert.equal(training.endsOn, "2026-10-12", "one day by default");
      await addClosure(ctx, A, { siteId: ids.s2, startsOn: "2026-10-13" }, ACTOR);
      await rejects(addClosure(ctx, A, { siteId: ids.sB, startsOn: "2026-10-01" }, ACTOR), /site does not exist/);
      await rejects(addClosure(ctx, A, { startsOn: "2026-10-02", endsOn: "2026-10-01" }, ACTOR), /end before/);
      assert.deepEqual((await listClosures(ctx, A, { from: "2026-10-01", to: "2026-10-31" })).map((c) => c.reason ?? "-"), ["Staff training", "-"]);
      assert.deepEqual((await listClosures(ctx, A, { from: "2026-10-01", to: "2026-12-31", siteIds: [ids.s1] })).map((c) => c.id), [training.id, xmas.id], "a site's own and every site's");
      assert.equal((await listClosures(ctx, A, { from: "2026-12-26", to: "2026-12-26" })).length, 1, "a closure overlapping the period's edge");
      assert.equal(await removeClosure(ctx, B, training.id, ACTOR_B), false, "another clinic cannot remove it");
      assert.ok(await getClosure(ctx, A, training.id));
      const tempo = await addClosure(ctx, A, { siteId: ids.s1, startsOn: "2026-11-02" }, ACTOR);
      assert.equal(await removeClosure(ctx, A, tempo.id, ACTOR), true);
      assert.equal(await getClosure(ctx, A, tempo.id), null);
      assert.equal(await removeClosure(ctx, A, tempo.id, ACTOR), false);
      assert.equal((await listAudit(ctx, A, { action: "pms.closure.create" })).length, 4);
      assert.equal((await listAudit(ctx, A, { action: "pms.closure.remove" })).length, 1);
      assert.equal((await listClosures(ctx, B)).length, 0);
    });

    it("audit search: dates as id ranges, areas, actions, person, record – one clinic only, newest first, paged", async () => {
      clock = Date.parse("2026-10-22T10:00:00.000Z");
      await addClosure(ctx, A, { siteId: ids.s1, startsOn: "2026-11-20" }, { userId: "user_admin_2", sessionId: "sess_2" });
      tick();
      await addClosure(ctx, B, { siteId: ids.sB, startsOn: "2026-11-20" }, ACTOR_B);
      const all = await searchAudit(ctx, A, { limit: 200 });
      assert.ok(all.entries.length > 20);
      assert.ok(all.entries.every((e) => e.tenantId === A));
      assert.ok(all.entries[0].id > all.entries[all.entries.length - 1].id, "newest first");
      const day = auditIdRange("2026-10-22", "2026-10-22");
      const onDay = await searchAudit(ctx, A, { lowerId: day.lower, upperId: day.upper });
      assert.deepEqual(onDay.entries.map((e) => e.action), ["pms.closure.create"]);
      const before = auditIdRange("2026-10-01", "2026-10-21");
      assert.ok((await searchAudit(ctx, A, { lowerId: before.lower, upperId: before.upper, limit: 200 })).entries.every((e) => e.action !== "pms.closure.create" || e.userId !== "user_admin_2"));
      const closures = await searchAudit(ctx, A, { actionPrefix: "pms.closure." });
      assert.deepEqual(new Set(closures.entries.map((e) => e.action)), new Set(["pms.closure.create", "pms.closure.remove"]));
      const sites = await searchAudit(ctx, A, { actionPrefix: "pms.site." });
      assert.ok(sites.entries.every((e) => e.action.startsWith("pms.site.")), "pms.site_hours… would not match: the prefix includes the dot");
      assert.equal((await searchAudit(ctx, A, { userId: "user_admin_2" })).entries.length, 1);
      assert.equal((await searchAudit(ctx, A, { targetType: "pms_site", targetId: ids.s2 })).entries.length >= 2, true);
      assert.equal((await searchAudit(ctx, A, { actions: [] })).entries.length, 0);
      assert.equal((await searchAudit(ctx, A, { actions: ["pms.patient.create"] })).entries.length, 3);
      await rejects(searchAudit(ctx, A, { actionPrefix: "pms.%" }), /area/);
      // Paging: 5 a page, forwards then back.
      const p1 = await searchAudit(ctx, A, { limit: 5 });
      assert.deepEqual([p1.entries.length, p1.hasOlder, p1.hasNewer], [5, true, false]);
      const p2 = await searchAudit(ctx, A, { limit: 5, beforeId: p1.entries[4].id });
      assert.deepEqual([p2.entries.length, p2.hasNewer], [5, true]);
      assert.ok(p2.entries[0].id < p1.entries[4].id);
      const back = await searchAudit(ctx, A, { limit: 5, afterId: p2.entries[0].id });
      assert.deepEqual(back.entries.map((e) => e.id), p1.entries.map((e) => e.id));
      assert.equal(back.hasNewer, false);
      assert.equal(back.hasOlder, true);
      const b = await searchAudit(ctx, B, { limit: 200 });
      assert.ok(b.entries.every((e) => e.tenantId === B && e.userId === ACTOR_B.userId));
      // About a patient (the patients a name search found): the patient record itself and entries whose detail names
      // the patient's id – here Megan's record and her two cases; never another clinic's rows.
      const meg = await searchAudit(ctx, A, { relatedIds: [ids.megan], limit: 200 });
      assert.ok(meg.entries.some((e) => e.action === "pms.patient.create" && e.targetId === ids.megan));
      assert.equal(meg.entries.filter((e) => e.action === "pms.case.create").length, 2);
      assert.ok(meg.entries.every((e) => e.targetId === ids.megan || (e.detail as { patientId?: string } | null)?.patientId === ids.megan));
      const both = await searchAudit(ctx, A, { relatedIds: [ids.megan, ids.daniel], actions: ["pms.case.create"] });
      assert.equal(both.entries.length, 3);
      assert.equal((await searchAudit(ctx, A, { relatedIds: [] })).entries.length, 0, "no patient found: nothing");
      assert.equal((await searchAudit(ctx, B, { relatedIds: [ids.megan] })).entries.length, 0, "another clinic");
      // LIKE wildcards in an id are taken literally ("pat_…" with "_" swapped for another character matches nothing).
      assert.equal((await searchAudit(ctx, A, { relatedIds: [ids.megan.replace("_", "X")] })).entries.length, 0);
      await rejects(searchAudit(ctx, A, { relatedIds: ["50%"] }), /record id/);
      await rejects(searchAudit(ctx, A, { relatedIds: Array.from({ length: 21 }, (_, i) => `pat_${i}`) }), /Too many/);
    });

    it("figures from the record: cases by month and payer, caseload, referral sources, new and returning, registrations", async () => {
      const oct = { from: "2026-10-01", to: "2026-10-31", siteIds: null };
      const opened = await casesOpenedBy(ctx, A, oct);
      assert.deepEqual(
        opened.map((r) => [r.month, r.payerType, r.cases]).sort(),
        [["2026-10", "insurer", 1], ["2026-10", "self_pay", 1]].sort(),
      );
      assert.equal((await casesOpenedBy(ctx, A, { ...oct, siteIds: [ids.s2] })).length, 1);
      assert.equal((await casesOpenedBy(ctx, A, { ...oct, siteIds: [] })).length, 0);
      assert.equal(await casesClosedIn(ctx, A, oct), 1);
      const open = await openCaseload(ctx, A, null);
      assert.equal(open.reduce((s, r) => s + r.cases, 0), 2);
      assert.equal((await openCaseload(ctx, A, [ids.s1])).reduce((s, r) => s + r.cases, 0), 1);
      const refs = await referralSources(ctx, A, oct);
      assert.deepEqual(refs.map((r) => [r.name, r.kind, r.cases]).sort(), [["Dr Amara Okafor (fictional)", "gp", 1], ["Northwell Health Insurance (fictional)", "insurer", 1]].sort());
      assert.deepEqual(await patientMixByCases(ctx, A, oct), { patients: 2, newPatients: 1 }, "Megan had a case in 2025: returning; Daniel is new");
      assert.deepEqual(await patientMixByCases(ctx, A, { from: "2026-09-01", to: "2026-10-31", siteIds: null }), { patients: 3, newPatients: 2 });
      assert.deepEqual(await patientMixByCases(ctx, A, { ...oct, siteIds: [ids.s1] }), { patients: 1, newPatients: 0 });
      assert.deepEqual(Object.fromEntries(await newPatientsByMonth(ctx, A, { from: "2026-09-01", to: "2026-10-31", siteIds: null })), { "2026-09": 1, "2026-10": 1 });
      assert.deepEqual(Object.fromEntries(await newPatientsByMonth(ctx, A, { from: "2026-09-01", to: "2026-10-31", siteIds: [ids.s2] })), { "2026-09": 1, "2026-10": 1 });
      assert.deepEqual(Object.fromEntries(await newPatientsByMonth(ctx, A, { from: "2026-09-01", to: "2026-10-31", siteIds: [ids.s1] })), {});
      assert.equal(await patientsRegistered(ctx, A, "2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"), 3);
      assert.equal(await patientsRegistered(ctx, B, "2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"), 1);
      assert.deepEqual(Object.fromEntries(await referrerNames(ctx, A, [ids.ins, ids.insB])), { [ids.ins]: "Northwell Health Insurance (fictional)" }, "another clinic's account is not found");
    });

    it("authorisations to review: expiring and nearly used up, by case site, nothing decrypted", async () => {
      const rows = await authorisationsForReview(ctx, A, { today: "2026-10-24", days: 14, siteIds: null });
      assert.deepEqual(rows.map((r) => r.code).sort(), ["LAST-ONE", "NW-SOON"]);
      const soon = rows.find((r) => r.code === "NW-SOON");
      assert.equal(soon?.patientName, "Megan Hart");
      assert.equal(soon?.issuerName, "Northwell Health Insurance (fictional)");
      assert.equal(soon?.caseTitle, "Neck");
      assert.ok(!JSON.stringify(rows).includes("claims team"), "notes are never read");
      assert.deepEqual((await authorisationsForReview(ctx, A, { today: "2026-10-24", days: 14, siteIds: [ids.s2] })).map((r) => r.code), ["LAST-ONE"]);
      assert.equal((await authorisationsForReview(ctx, B, { today: "2026-10-24", days: 365, siteIds: null })).length, 0);
    });

    it("report targets: defaults until saved, revisioned, audited, one clinic only", async () => {
      assert.deepEqual(await getReportingSettings(ctx, A), { rev: 0, utilisationTargetPercent: 80, dnaTargetTenths: 40 });
      tick();
      assert.deepEqual((await updateReportingSettings(ctx, A, 0, { utilisationTargetPercent: 75, dnaTargetTenths: 35 }, ACTOR)).ok, true);
      assert.deepEqual(await getReportingSettings(ctx, A), { rev: 1, utilisationTargetPercent: 75, dnaTargetTenths: 35 });
      tick();
      const stale = await updateReportingSettings(ctx, A, 0, { utilisationTargetPercent: 90, dnaTargetTenths: 35 }, ACTOR);
      assert.equal(stale.ok, false, "a stale revision changes nothing");
      assert.equal((await getReportingSettings(ctx, A)).utilisationTargetPercent, 75);
      tick();
      assert.equal((await updateReportingSettings(ctx, A, 1, { utilisationTargetPercent: 82, dnaTargetTenths: 40 }, ACTOR)).ok, true);
      await rejects(updateReportingSettings(ctx, A, 2, { utilisationTargetPercent: 0, dnaTargetTenths: 40 }, ACTOR), /Report targets/);
      assert.deepEqual(await getReportingSettings(ctx, B), { rev: 0, utilisationTargetPercent: 80, dnaTargetTenths: 40 }, "the other clinic keeps the defaults");
      const audit = await listAudit(ctx, A, { action: "pms.report_targets.set" });
      assert.equal(audit.length, 2, "one row per change that applied (not the stale one)");
    });

    it("one opening-hours source: the diary's rota windows and free slots are clipped to the site's hours and closures", async () => {
      clock = Date.parse("2026-10-26T09:00:00.000Z");
      const s3 = (await createSite(ctx, A, { name: "Newport (fictional)" }, ACTOR)).id;
      const s4 = (await createSite(ctx, A, { name: "No hours yet (fictional)" }, ACTOR)).id;
      const p3 = (await createPractitioner(ctx, A, { displayName: "Lena Ford", defaultSiteId: s3 }, ACTOR)).id;
      const p4 = (await createPractitioner(ctx, A, { displayName: "Owen Price", defaultSiteId: s4 }, ACTOR)).id;
      for (const [practitionerId, siteId] of [[p3, s3], [p4, s4]]) {
        await createAvailability(ctx, A, { practitionerId, siteId, weekday: 1, startTime: "07:00", endTime: "21:00", validFrom: "2026-10-01" }, ACTOR);
      }
      await setOpeningHours(ctx, A, { siteId: s3, sessions: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opensAt: "08:00", closesAt: "20:00" })) }, ACTOR);
      await addClosure(ctx, A, { siteId: s3, startsOn: "2026-11-09", reason: "Staff training" }, ACTOR);
      const hours = (slots: { startMinute: number }[]) => slots.map((x) => x.startMinute / 60);
      const monday = await findFreeSlots(ctx, A, { fromDate: "2026-11-02", days: 1, practitionerIds: [p3], durationMinutes: 60, stepMinutes: 60, limit: 50 });
      assert.deepEqual(hours(monday), [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19], "a 07:00–21:00 rota at a site open 08:00–20:00");
      const windows = await availabilityWindows(ctx, A, ["2026-11-02"], { practitionerIds: [p3] });
      assert.deepEqual(windows.map((w) => [w.startMinute, w.endMinute]), [[480, 1200]]);
      assert.deepEqual(await findFreeSlots(ctx, A, { fromDate: "2026-11-09", days: 1, practitionerIds: [p3], durationMinutes: 60, stepMinutes: 60 }), [], "a closure day: no slots");
      await addClosure(ctx, A, { siteId: null, startsOn: "2026-11-16", reason: "Bank holiday" }, ACTOR);
      assert.deepEqual(await findFreeSlots(ctx, A, { fromDate: "2026-11-16", days: 1, practitionerIds: [p4], durationMinutes: 60, stepMinutes: 60 }), [], "an all-sites closure closes a site without hours too");
      const unrestricted = await findFreeSlots(ctx, A, { fromDate: "2026-11-02", days: 1, practitionerIds: [p4], durationMinutes: 60, stepMinutes: 60, limit: 50 });
      assert.deepEqual(hours(unrestricted), [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], "a site without opening hours is not limited");
      await rejects(setOpeningHours(ctx, A, { siteId: s3, sessions: [] }, ACTOR), /at least one day/);
    });

    it("tenant-scope guard: every clinic-system statement named tenant_id", () => {
      if (!suite.log) return;
      assert.ok(suite.log.statements.length > 50, `recorded ${suite.log.statements.length} statements`);
      assert.deepEqual(unscopedStatements(suite.log.statements), []);
    });
  });
}
