/**
 * The whole demonstration seed (`npm run pms:seed-demo`: scripts/pms/seed-lib.ts + seed-modules.ts) on D1 through
 * the gateway – the Worker's own limits (100 parameters and 100 statements per request) apply, which local SQLite
 * does not have (the preview seed of 29/10/2026 stopped in billing at "Statement 0: at most 100 parameters"):
 *   1. in-process Worker + node:sqlite D1 stand-in: the full seed, a second run that adds nothing, and a run
 *      stopped part-way through billing then finished with `resume` – the same totals as an uninterrupted run;
 *   2. real local D1 in workerd with every migration applied by wrangler (when the Worker's dependencies are
 *      installed): the full seed for fewer patients (DEMO_SEED_WORKERD_PATIENTS, default 60 – every request goes
 *      through workerd, ~2 minutes).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { Kysely } from "kysely";
import { createClinic } from "../../../src/server/auth/platform";
import { D1HttpDialect } from "../../../src/server/db/dialects/d1-http";
import type { Database } from "../../../src/server/db/schema";
import { testCipher } from "../../../src/server/db/testing/databases";
import { DEMO_CLINIC } from "../../../scripts/pms/demo-data";
import { seedBilling } from "../../../scripts/pms/seed-billing";
import { seedDiary } from "../../../scripts/pms/seed-diary";
import { seedDemoClinic } from "../../../scripts/pms/seed-lib";
import { seedDemoModules, type SeedModulesSummary } from "../../../scripts/pms/seed-modules";
import { seedRecords } from "../../../scripts/pms/seed-records";
import { seedSetup } from "../../../scripts/pms/seed-setup";
import { handleRequest } from "../src/index";
import { FakeD1 } from "./fake-d1";
import { available, gatewayDb, startLocalD1 } from "./local-d1";

const SECRET = "demo-seed-stack-secret-".padEnd(48, "d");
const NOW = new Date("2026-10-29T10:00:00.000Z");
// The real seed's 200 patients: the diary's past weeks then hold more invoices per week than D1 binds parameters.
const PATIENTS = Number(process.env.DEMO_SEED_D1_PATIENTS ?? 200);
const cipher = testCipher();
const TID = DEMO_CLINIC.slug;

/** The stand-in behind the real gateway handler; `failAfter` makes the gateway unreachable after that many requests. */
function standIn(): { db: Kysely<Database>; d1: FakeD1; requests: () => number; failAfter: (n: number | null) => void; close: () => Promise<void> } {
  const d1 = new FakeD1();
  let requests = 0;
  let limit: number | null = null;
  const db = new Kysely<Database>({
    dialect: new D1HttpDialect({
      url: "https://gateway.test",
      secret: SECRET,
      fetch: async (url, init) => {
        requests += 1;
        if (limit !== null && requests > limit) throw new Error("demo-seed-stack: the gateway went away (simulated).");
        return handleRequest(new Request(url, init), { DB: d1, GATEWAY_SECRET: SECRET });
      },
    }),
  });
  return {
    db,
    d1,
    requests: () => requests,
    failAfter: (n) => {
      limit = n === null ? null : requests + n;
    },
    close: async () => {
      await db.destroy();
      d1.close();
    },
  };
}

async function createDemoClinic(db: Kysely<Database>): Promise<void> {
  await createClinic(db, { name: DEMO_CLINIC.name, slug: TID, ownerEmail: DEMO_CLINIC.ownerEmail, appOrigin: "http://localhost:3180", linkSecret: "s".repeat(40) });
}

async function fullSeed(db: Kysely<Database>, options: { resume?: boolean; patients?: number } = {}): Promise<SeedModulesSummary> {
  const ctx = { db, cipher, now: () => NOW };
  await seedDemoClinic(ctx, { tenantId: TID, markDemo: true, now: NOW, patients: options.patients ?? PATIENTS, resume: options.resume });
  return seedDemoModules(ctx, TID, { now: NOW });
}

/** What the clinic holds at the end (counts only). */
async function totals(db: Kysely<Database>) {
  const n = async (table: "pms_invoices" | "pms_payments" | "pms_payment_allocations" | "pms_credit_notes" | "pms_saved_cards" | "pms_appointments" | "pms_clinical_notes", where?: [string, string]) => {
    let q = db.selectFrom(table).select((eb) => eb.fn.countAll<number>().as("n")).where("tenant_id", "=", TID);
    if (where) q = q.where(where[0] as never, "=", where[1] as never);
    return Number((await q.executeTakeFirst())?.n ?? 0);
  };
  return {
    invoices: await n("pms_invoices"),
    issued: await n("pms_invoices", ["status", "issued"]),
    drafts: await n("pms_invoices", ["status", "draft"]),
    payments: await n("pms_payments"),
    allocations: await n("pms_payment_allocations"),
    creditNotes: await n("pms_credit_notes"),
    savedCards: await n("pms_saved_cards"),
    appointments: await n("pms_appointments"),
    notes: await n("pms_clinical_notes"),
  };
}

function assertSeeded(s: SeedModulesSummary, full = true): void {
  assert.ok(s.diary.historyWeeks === 8 && s.diary.historyAppointments > (full ? 600 : 100), JSON.stringify(s.diary));
  assert.ok(s.records.notes > 0, JSON.stringify(s.records));
  // More than 100 invoices a week on average: the week's invoices are read in groups (D1: 100 parameters).
  if (full) assert.ok(s.billing.historyInvoices > 7 * 100, JSON.stringify(s.billing));
  assert.ok(s.billing.payments > 0 && s.billing.uninvoicedLeft > 0 && !s.billing.existed, JSON.stringify(s.billing));
  assert.ok(s.comms.planned > 0 && !s.comms.existed, JSON.stringify(s.comms));
  assert.equal(s.portal.existed, false);
}

describe("demonstration seed on D1 (in-process Worker, node:sqlite D1 stand-in)", () => {
  let reference: Awaited<ReturnType<typeof totals>>;

  it("loads every module through the gateway's limits; a second run adds nothing", { timeout: 600_000 }, async () => {
    const s = standIn();
    try {
      await createDemoClinic(s.db);
      assertSeeded(await fullSeed(s.db));
      reference = await totals(s.db);
      assert.equal(reference.drafts, 0, "no drafts left by the seed");
      const again = await fullSeed(s.db, { resume: true });
      assert.equal(again.billing.existed, true);
      assert.equal(again.comms.existed, true);
      assert.equal(again.diary.appointments, 0);
      assert.deepEqual(await totals(s.db), reference, "a resumed run on a complete clinic adds nothing");
      // Without resume a second run is refused (contract §9), as before.
      await assert.rejects(seedDemoClinic({ db: s.db, cipher, now: () => NOW }, { tenantId: TID, now: NOW }), /already has clinic-system patients/);
    } finally {
      await s.close();
    }
  });

  // Billing makes ~29,000 requests for 200 patients: the hand-made invoices, the first past week, a later one, the end.
  for (const stopAt of [5, 60, 400, 15_000, 28_300, 28_800]) {
    it(`a run stopped ${stopAt} requests into billing is finished by resume, with the same totals`, { timeout: 600_000 }, async () => {
      const s = standIn();
      try {
        await createDemoClinic(s.db);
        const ctx = { db: s.db, cipher, now: () => NOW };
        await seedDemoClinic(ctx, { tenantId: TID, markDemo: true, now: NOW, patients: PATIENTS });
        // Stop inside billing: everything before it completes, then the gateway goes away.
        await seedSetup(ctx, TID);
        await seedDiary(ctx, TID, { now: NOW });
        await seedRecords(ctx, TID, { now: NOW });
        s.failAfter(stopAt);
        await assert.rejects(seedBilling(ctx, TID, { now: NOW }), /could not be reached/);
        s.failAfter(null);
        await fullSeed(s.db, { resume: true });
        const t = await totals(s.db);
        assert.equal(t.drafts, 0, "drafts left by the stop are issued");
        // The same invoices, payments, credit notes, cards, appointments and notes as an uninterrupted run.
        assert.deepEqual(t, reference);
      } finally {
        await s.close();
      }
    });
  }
});

if (available) {
  describe("demonstration seed on D1 (local workerd D1, wrangler-applied migrations)", () => {
    it("loads every module", { timeout: 900_000 }, async () => {
      const { proxy, dir } = await startLocalD1();
      const db = gatewayDb(proxy.env.DB);
      try {
        await createDemoClinic(db);
        assertSeeded(await fullSeed(db, { patients: Number(process.env.DEMO_SEED_WORKERD_PATIENTS ?? 60) }), false);
        assert.equal((await totals(db)).drafts, 0);
      } finally {
        await db.destroy();
        await proxy.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
}
