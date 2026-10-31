/**
 * The demonstration clinic (scripts/pms/demo-data.ts, seed-lib.ts): the sizes asked for, fictional data only, the
 * safety checks, and a second run refused unless fresh. Run by `npm run test:db` (node:sqlite; PGlite for the load).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createClinic } from "../../src/server/auth/platform";
import { createPgliteTestDb, createSqliteTestDb, testCipher, type TestDb } from "../../src/server/db/testing/databases";
import { listAudit } from "../../src/server/repos/audit";
import { RepoInputError } from "../../src/server/repos/context";
import { listAuthorisations, listCasesForPatient } from "../../src/server/repos/pms/cases";
import { listPractitioners, listRooms, listServices, listSites } from "../../src/server/repos/pms/directory";
import { isPackageOn } from "../../src/server/repos/pms/entitlements";
import { getPatient, searchPatients } from "../../src/server/repos/pms/patients";
import { listReferrers } from "../../src/server/repos/pms/referrers";
import { getPmsSettings } from "../../src/server/repos/pms/settings";
import { createPatient } from "../../src/server/repos/pms/patients";
import { DEMO_CLINIC, PRACTITIONERS, REFERRERS, SITES, demoPatients } from "./demo-data";
import { seedDemoClinic } from "./seed-lib";

const SECRET = "s".repeat(40);
const OFCOM_MOBILE = /^07700 900\d{3}$/;

describe("demonstration data (pure)", () => {
  const people = demoPatients(200, 2026, "2026-10-24");
  it("200 patients, sim-pat labels unique, Megan Hart and Daniel Brooks first", () => {
    assert.equal(people.length, 200);
    assert.equal(new Set(people.map((p) => p.importRef)).size, 200);
    assert.deepEqual(people.slice(0, 3).map((p) => p.importRef), ["sim-pat-001", "sim-pat-002", "sim-pat-007"]);
    assert.ok(people.every((p) => /^sim-pat-\d{3}$/.test(p.importRef)));
    assert.equal(people[0].patient.lastName, "Hart");
    assert.equal(people[1].patient.lastName, "Brooks");
  });
  it("fictional only: drama phone numbers, example.com addresses, (fictional) organisations, PH-DEMO practitioners", () => {
    const phones = people.flatMap((p) => [p.patient.phoneMobile, p.patient.emergencyPhone]).filter((x): x is string => typeof x === "string");
    assert.ok(phones.every((x) => OFCOM_MOBILE.test(x)), "07700 900xxx");
    assert.equal(new Set(phones).size, phones.length, "no number used twice");
    assert.ok(people.every((p) => !p.patient.email || p.patient.email.endsWith("@example.com")));
    assert.ok(people.every((p) => (p.patient.address ?? []).some((l) => l.includes("(fictional)"))));
    assert.ok(REFERRERS.every((r) => r.name.endsWith("(fictional)")), "every organisation ends (fictional)");
    assert.ok(REFERRERS.every((r) => !r.phone || /^01632 960\d{3}$/.test(r.phone)));
    assert.ok(SITES.every((s) => s.name.endsWith("(fictional)") && /^01632 960\d{3}$/.test(String(s.phone))));
    assert.deepEqual(PRACTITIONERS.map((p) => p.registrationNumber), ["PH-DEMO-01", "PH-DEMO-02", "PH-DEMO-03", "PH-DEMO-04", "PH-DEMO-05", "PH-DEMO-06", "PH-DEMO-07", "PH-DEMO-08"]);
    assert.ok(DEMO_CLINIC.name.endsWith("(fictional)"));
  });
  it("the same seed gives the same clinic; payers are a realistic mix", () => {
    assert.deepEqual(demoPatients(200, 2026, "2026-10-24"), people);
    const payers = people.flatMap((p) => p.cases.map((c) => c.payerType));
    for (const t of ["self_pay", "insurer", "mlc", "solicitor", "employer"]) assert.ok(payers.includes(t as never), t);
    assert.ok(payers.filter((t) => t === "self_pay").length > payers.length / 3);
  });
});

for (const [label, factory] of [
  ["SQLite", async () => createSqliteTestDb()],
  ["PGlite", () => createPgliteTestDb()],
] as const) {
  describe(`loading the demonstration clinic on ${label}`, () => {
    let t: TestDb;
    const cipher = testCipher();
    before(async () => {
      t = await factory();
      await createClinic(t.db, { name: DEMO_CLINIC.name, slug: DEMO_CLINIC.slug, ownerEmail: DEMO_CLINIC.ownerEmail, appOrigin: "http://localhost:3180", linkSecret: SECRET });
      await createClinic(t.db, { name: "Harbour Clinic", slug: "harbour-clinic", ownerEmail: "o@harbour.example.com", appOrigin: "http://localhost:3180", linkSecret: SECRET });
    });
    after(async () => {
      await t?.close();
    });

    it("refuses a clinic that is not a demonstration clinic, and one whose name is not fictional", async () => {
      const ctx = { db: t.db, cipher };
      await assert.rejects(seedDemoClinic(ctx, { tenantId: DEMO_CLINIC.slug }), /not flagged as a demonstration clinic/);
      await assert.rejects(seedDemoClinic(ctx, { tenantId: "harbour-clinic", markDemo: true }), /does not end "\(fictional\)"/);
      await assert.rejects(seedDemoClinic(ctx, { tenantId: "nobody", markDemo: true }), RepoInputError);
    });

    it("loads 3 sites, 6 rooms, 8 practitioners, services, prices, 200 patients with cases and authorisations", async () => {
      const ctx = { db: t.db, cipher, now: () => new Date("2026-10-24T10:00:00.000Z") };
      const summary = await seedDemoClinic(ctx, { tenantId: DEMO_CLINIC.slug, markDemo: true, now: new Date("2026-10-24T10:00:00.000Z") });
      assert.deepEqual([summary.sites, summary.rooms, summary.practitioners, summary.patients], [3, 6, 8, 200]);
      assert.ok(summary.cases >= 200 && summary.authorisations >= 30, JSON.stringify(summary));
      const tid = DEMO_CLINIC.slug;
      assert.equal((await listSites(ctx, tid)).length, 3);
      assert.equal((await listRooms(ctx, tid)).length, 6);
      assert.equal((await listPractitioners(ctx, tid)).length, 8);
      assert.ok((await listServices(ctx, tid)).length >= 8);
      assert.equal((await listReferrers(ctx, tid, { limit: 500 })).length, REFERRERS.length);
      assert.equal((await getPmsSettings(ctx, tid)).isDemo, true);
      assert.equal(await isPackageOn(ctx, tid, "clinic"), true, "the clinic system is on for the demo clinic");
      assert.equal(await isPackageOn(ctx, "harbour-clinic", "clinic"), false);
      const [megan] = await searchPatients(ctx, tid, { q: "megan hart" });
      assert.equal(megan.importRef, "sim-pat-001");
      assert.equal(megan.patientNumber, 1);
      const cases = await listCasesForPatient(ctx, tid, megan.id);
      assert.equal(cases[0].payerType, "solicitor");
      assert.equal((await listAuthorisations(ctx, tid, { patientId: megan.id }))[0].sessionsUsed, 8);
      assert.ok((await getPatient(ctx, tid, megan.id))?.lastSeenOn);
      const audit = await listAudit(ctx, tid, { action: "pms.demo.seed" });
      assert.equal(audit.length, 1);
      assert.equal(audit[0].detail?.patients, 200);
      assert.ok((await listAudit(ctx, tid, { limit: 500 })).length < 150, "bulk loads write one audit row per batch, not per row");
    });

    it("a second run is refused; fresh replaces the data (local use)", async () => {
      const ctx = { db: t.db, cipher };
      await assert.rejects(seedDemoClinic(ctx, { tenantId: DEMO_CLINIC.slug }), /already has clinic-system patients/);
      const again = await seedDemoClinic(ctx, { tenantId: DEMO_CLINIC.slug, fresh: true, patients: 20 });
      assert.equal(again.patients, 20);
      assert.equal((await searchPatients(ctx, DEMO_CLINIC.slug, { status: "any", limit: 100 })).length, 20);
      assert.equal(await isPackageOn(ctx, DEMO_CLINIC.slug, "clinic"), true, "fresh keeps the packages");
    });

    it("an empty fictional clinic can be flagged, a clinic holding data cannot", async () => {
      const ctx = { db: t.db, cipher };
      await createClinic(t.db, { name: "Busy Clinic (fictional)", slug: "busy-clinic", ownerEmail: "o@busy.example.com", appOrigin: "http://localhost:3180", linkSecret: SECRET });
      await createPatient(ctx, "busy-clinic", { firstName: "Real", lastName: "Looking" }, { userId: "u_1", sessionId: null });
      await assert.rejects(seedDemoClinic(ctx, { tenantId: "busy-clinic", markDemo: true }), /already holds data/);
    });
  });
}
