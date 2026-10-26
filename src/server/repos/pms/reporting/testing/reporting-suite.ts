/**
 * TESTS ONLY: the reporting and set-up module's repository suite – opening hours, closures, staff site access,
 * the audit search, the figures from the shared record and the report loaders (with in-memory diary and
 * invoicing sources). Run unchanged on node:sqlite and PGlite (../reporting-repos.test.ts) and on D1 through the
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
import type { AppointmentFact, DebtFact, RevenueFact } from "../../../../../modules/pms/reporting/facts";
import { parseReportFilter } from "../../../../../modules/pms/reporting/schemas";
import { buildReportRequest, loadAttendance, loadAuthorisations, loadCaseload, loadDashboard, loadDebtors, loadDirectory, loadPatients, loadRevenue, loadUtilisation } from "../../../../pms/reporting/reports";
import type { ReportingSources } from "../../../../pms/reporting/sources";
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
import { getSiteScope, getStaffAccess, listStaffAccess, setStaffAccess } from "../staff-access";

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
      await rejects(setOpeningHours(ctx, A, { siteId: ids.sB, sessions: [] }, ACTOR), /site does not exist/);
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

    it("staff access: every site by default; limited, revisioned, refused across clinics; owners never limited", async () => {
      const u = "user_reception_1";
      const none = await getStaffAccess(ctx, A, u);
      assert.deepEqual([none.allSites, none.siteIds, none.rev], [true, [], 0]);
      const first = await setStaffAccess(ctx, A, u, 0, { allSites: false, siteIds: [ids.s2, ids.s1, ids.s2] }, ACTOR);
      assert.ok(first.ok && first.rev === 1);
      const got = await getStaffAccess(ctx, A, u);
      assert.deepEqual([got.allSites, got.siteIds.slice().sort(), got.rev, got.updatedBy], [false, [ids.s1, ids.s2].sort(), 1, ACTOR.userId]);
      assert.deepEqual(await setStaffAccess(ctx, A, u, 0, { allSites: true, siteIds: [] }, ACTOR), { ok: false, reason: "conflict", currentRev: 1 }, "a stale revision changes nothing");
      assert.equal((await getStaffAccess(ctx, A, u)).allSites, false);
      const second = await setStaffAccess(ctx, A, u, 1, { allSites: false, siteIds: [ids.s1] }, ACTOR);
      assert.ok(second.ok && second.rev === 2);
      // Two people saving on the same revision: the first wins; the second neither changes the flag nor the sites.
      const third = await setStaffAccess(ctx, A, u, 2, { allSites: false, siteIds: [ids.s2] }, ACTOR);
      const late = await setStaffAccess(ctx, A, u, 2, { allSites: false, siteIds: [ids.s1, ids.s2] }, ACTOR);
      assert.ok(third.ok);
      assert.deepEqual(late, { ok: false, reason: "conflict", currentRev: 3 });
      assert.deepEqual((await getStaffAccess(ctx, A, u)).siteIds, [ids.s2]);
      await rejects(setStaffAccess(ctx, A, u, 3, { allSites: false, siteIds: [ids.sB] }, ACTOR), /does not exist in this clinic/);
      await rejects(setStaffAccess(ctx, A, u, 3, { allSites: false, siteIds: [] }, ACTOR), /at least one site/);
      assert.deepEqual((await getStaffAccess(ctx, B, u)).rev, 0, "the same person in another clinic: untouched");
      const back = await setStaffAccess(ctx, A, u, 3, { allSites: true, siteIds: [ids.s1] }, ACTOR);
      assert.ok(back.ok);
      assert.deepEqual((await getStaffAccess(ctx, A, u)).siteIds, [], "every site: the list is cleared");
      await setStaffAccess(ctx, A, "user_practitioner_1", 0, { allSites: false, siteIds: [ids.s1] }, ACTOR);
      const all = await listStaffAccess(ctx, A);
      assert.deepEqual(Array.from(all.keys()).sort(), ["user_practitioner_1", u]);
      assert.deepEqual(all.get("user_practitioner_1")?.siteIds, [ids.s1]);
      assert.deepEqual(await getSiteScope(ctx, A, "user_practitioner_1", "clinician"), { all: false, siteIds: [ids.s1] });
      assert.deepEqual(await getSiteScope(ctx, A, "user_practitioner_1", "owner"), { all: true }, "owners always see every site");
      const audit = await listAudit(ctx, A, { action: "pms.staff_access.set" });
      assert.equal(audit.length, 5, "only the saves that won are recorded");
      assert.deepEqual(audit[0].detail, { allSites: false, sites: 1, rev: 1 });
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

    it("report loaders: sources checked (another site's or month's facts left out), the viewer's sites only", async () => {
      clock = Date.parse("2026-10-24T09:00:00.000Z");
      const dir = await loadDirectory(ctx, A);
      const appts: AppointmentFact[] = [
        { month: "2026-10", siteId: ids.s1, roomId: ids.r1, practitionerId: ids.p1, outcome: "attended", appointments: 10, minutes: 300 },
        { month: "2026-10", siteId: ids.s1, roomId: ids.r2, practitionerId: ids.p1, outcome: "dna", appointments: 2, minutes: 60 },
        { month: "2026-10", siteId: ids.s2, roomId: ids.r3, practitionerId: ids.p2, outcome: "late_cancel", appointments: 1, minutes: 30 },
        { month: "2026-10", siteId: ids.s2, roomId: ids.r3, practitionerId: ids.p2, outcome: "attended", appointments: 7, minutes: 210 },
        { month: "2026-09", siteId: ids.s1, roomId: ids.r1, practitionerId: ids.p1, outcome: "attended", appointments: 5, minutes: 150 },
        { month: "2026-10", siteId: ids.sB, roomId: null, practitionerId: null, outcome: "attended", appointments: 99, minutes: 999 },
        { month: "2027-01", siteId: ids.s1, roomId: ids.r1, practitionerId: ids.p1, outcome: "attended", appointments: 50, minutes: 500 },
      ];
      const revenue: RevenueFact[] = [
        { month: "2026-10", siteId: ids.s1, practitionerId: ids.p1, payerType: "insurer", kind: "invoiced", count: 4, amountPence: 20000 },
        { month: "2026-10", siteId: ids.s2, practitionerId: ids.p2, payerType: "self_pay", kind: "invoiced", count: 2, amountPence: 13000 },
        { month: "2026-10", siteId: ids.s2, practitionerId: null, payerType: "self_pay", kind: "received", count: 2, amountPence: 13000 },
        { month: "2026-10", siteId: ids.s1, practitionerId: null, payerType: "insurer", kind: "credited", count: 1, amountPence: 5000 },
      ];
      const debt: DebtFact[] = [
        { payerType: "insurer", payerReferrerId: ids.ins, siteId: ids.s1, dueOn: "2026-08-01", invoices: 3, outstandingPence: 15000 },
        { payerType: "self_pay", payerReferrerId: null, siteId: ids.s2, dueOn: "2026-10-20", invoices: 1, outstandingPence: 6500 },
        { payerType: "insurer", payerReferrerId: ids.insB, siteId: ids.sB, dueOn: "2026-10-01", invoices: 1, outstandingPence: 1 },
      ];
      // In-memory sources that (wrongly) ignore the filter: the loaders' checks must keep the figures right.
      const sources: ReportingSources = {
        diary: {
          appointmentFacts: async (_c, t) => (t === A ? appts.filter((f) => f.month === "2026-10" || f.siteId === ids.sB || f.month === "2027-01") : []),
          availabilityFacts: async () => [
            { practitionerId: ids.p1, siteId: ids.s1, month: "2026-10", minutes: 1200 },
            { practitionerId: ids.p2, siteId: ids.s2, month: "2026-10", minutes: 600 },
          ],
          attendedPatients: async () => ({ patients: 12, newPatients: 4 }),
        },
        billing: { revenueFacts: async () => revenue, debtFacts: async () => debt },
      };
      const owner = buildReportRequest({ tenantId: A, params: parseReportFilter({ period: "this_month" }), today: "2026-10-24", now: new Date(clock).toISOString(), scope: { all: true }, directory: dir });
      const req = owner.request;
      assert.deepEqual([req.period.from, req.period.to, req.siteIds], ["2026-10-01", "2026-10-31", null]);

      const util = await loadUtilisation(ctx, req, dir, sources);
      assert.ok(util.available);
      const s1 = util.bySite.find((r) => r.key === ids.s1);
      // s1: Mon + Tue 08:00–18:00 = 600 min a day; October 2026 has 4 Mondays + 4 Tuesdays = 4800, less the 12 Oct closure (600) = 4200, × 2 rooms.
      assert.deepEqual([s1?.bookedMinutes, s1?.availableMinutes], [360, 8400]);
      assert.ok(!util.bySite.some((r) => r.key === ids.sB), "another clinic's site never shows");
      assert.equal(util.byPractitioner.find((r) => r.key === ids.p1)?.utilisation, 360 / 1200);
      assert.equal(util.byRoom.find((r) => r.key === ids.r3)?.availableMinutes, 4 * 240 - 0, "s2: Mondays 09:00–13:00, the 13 Oct closure is a Tuesday");

      const att = await loadAttendance(ctx, req, sources);
      assert.ok(att.available);
      assert.deepEqual([att.total.total, att.total.attended, att.total.dna, att.total.lateCancel], [20, 17, 2, 1], "September, January and the other site are left out");
      assert.equal(att.byMonth.length, 1);

      const rev = await loadRevenue(ctx, req, sources);
      assert.ok(rev.available);
      assert.deepEqual([rev.total.invoicedPence, rev.total.creditedPence, rev.total.netPence, rev.total.receivedPence], [33000, 5000, 28000, 13000]);
      const debts = await loadDebtors(ctx, req, sources);
      assert.ok(debts.available);
      assert.deepEqual(debts.rows.map((r) => [r.name, r.outstandingPence]), [["Northwell Health Insurance (fictional)", 15000], ["Self-pay patients", 6500]], "another clinic's site and account are left out");

      // A receptionist limited to Wolverton: only Wolverton's figures, even from a source that sends everything.
      const limited = buildReportRequest({ tenantId: A, params: parseReportFilter({ period: "this_month", site: ids.s1 }), today: "2026-10-24", now: new Date(clock).toISOString(), scope: { all: false, siteIds: [ids.s2] }, directory: dir });
      assert.deepEqual([limited.request.siteId, limited.request.siteIds, limited.siteChoices.map((s) => s.id)], [null, [ids.s2], [ids.s2]], "a site outside the scope is ignored");
      const latt = await loadAttendance(ctx, limited.request, sources);
      assert.ok(latt.available);
      assert.deepEqual([latt.total.total, latt.total.lateCancel], [8, 1]);
      const lrev = await loadRevenue(ctx, limited.request, sources);
      assert.ok(lrev.available);
      assert.equal(lrev.total.netPence, 13000);
      const ldebt = await loadDebtors(ctx, limited.request, sources);
      assert.ok(ldebt.available);
      assert.deepEqual(ldebt.rows.map((r) => r.outstandingPence), [6500]);
      const lutil = await loadUtilisation(ctx, limited.request, dir, sources);
      assert.ok(lutil.available);
      assert.deepEqual(lutil.bySite.map((r) => r.key), [ids.s2]);
      assert.deepEqual(lutil.byPractitioner.map((r) => r.key), [ids.p2], "practitioners of the chosen sites");

      // Practitioner filter.
      const one = buildReportRequest({ tenantId: A, params: parseReportFilter({ period: "this_month", practitioner: ids.p2 }), today: "2026-10-24", now: new Date(clock).toISOString(), scope: { all: true }, directory: dir });
      const patt = await loadAttendance(ctx, one.request, sources);
      assert.ok(patt.available);
      assert.equal(patt.total.total, 8);
      assert.equal(buildReportRequest({ tenantId: A, params: parseReportFilter({ practitioner: "prac_unknown" }), today: "2026-10-24", now: "", scope: { all: true }, directory: dir }).request.practitionerId, null);
      const bad = buildReportRequest({ tenantId: A, params: parseReportFilter({ period: "custom", from: "2026-10-05" }), today: "2026-10-24", now: "", scope: { all: true }, directory: dir });
      assert.equal(bad.periodError, "Enter a start and an end date.");
      assert.equal(bad.request.period.preset, "this_month", "the default period instead");

      // No diary, no invoicing yet: the reports say so.
      const none: ReportingSources = { diary: null, billing: null };
      assert.deepEqual(await loadUtilisation(ctx, req, dir, none), { available: false });
      assert.deepEqual(await loadRevenue(ctx, req, none), { available: false });
      const pats = await loadPatients(ctx, req, none);
      assert.deepEqual([pats.byCases.patients, pats.byCases.newPatients, pats.byAppointments, pats.casesOpened, pats.registered], [2, 1, null, 2, 3]);
      assert.deepEqual(pats.sourcesByKind.map((k) => k.kind).sort(), ["gp", "insurer"]);
      const withDiary = await loadPatients(ctx, req, sources);
      assert.deepEqual(withDiary.byAppointments, { patients: 12, newPatients: 4, returning: 8, newShare: 4 / 12 });
      assert.equal((await loadPatients(ctx, limited.request, none)).registered, null, "registrations are clinic-wide only");
      const cl = await loadCaseload(ctx, req);
      assert.deepEqual([cl.openTotal, cl.opened, cl.closed], [2, 2, 1]);
      const auths = await loadAuthorisations(ctx, req, 14);
      assert.deepEqual(auths.map((a) => [a.authorisation.code, a.reasons]), [["NW-SOON", ["expires_soon"]], ["LAST-ONE", ["few_sessions_left"]]]);
      const dash = await loadDashboard(ctx, req, dir, sources);
      assert.equal(dash.attendance?.now.dnaRate, 2 / 20);
      assert.deepEqual([dash.previous.from, dash.previous.to], ["2026-08-31", "2026-09-30"]);
      assert.equal(dash.revenue?.now.netPence, 28000);
      assert.equal(dash.debt?.outstandingPence, 21500);
      assert.equal(dash.authorisationsToAct, 2);
      assert.equal(dash.openCases, 2);
      const bare = await loadDashboard(ctx, req, dir, none);
      assert.deepEqual([bare.attendance, bare.utilisation, bare.revenue, bare.debt], [null, null, null, null]);
    });

    it("tenant-scope guard: every clinic-system statement named tenant_id", () => {
      if (!suite.log) return;
      assert.ok(suite.log.statements.length > 50, `recorded ${suite.log.statements.length} statements`);
      assert.deepEqual(unscopedStatements(suite.log.statements), []);
    });
  });
}
