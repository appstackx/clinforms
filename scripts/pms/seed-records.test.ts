/**
 * The demonstration clinical records (scripts/pms/seed-records.ts) on top of the demonstration clinic: refused for a
 * clinic that is not a demonstration clinic, fictional text only, signed and unsigned notes with fingerprints,
 * outcome measures over time, and a second run that adds nothing. Run by `npm run test:pms` / `npm run test:db`.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createClinic } from "../../src/server/auth/platform";
import { createSqliteTestDb, testCipher, type TestDb } from "../../src/server/db/testing/databases";
import { listAudit } from "../../src/server/repos/audit";
import { searchPatients } from "../../src/server/repos/pms/patients";
import { countUnsignedNotesByAuthor, getNote, listNotesForPatient, noteFingerprint } from "../../src/server/repos/pms/records/notes";
import { listOutcomesForPatient } from "../../src/server/repos/pms/records/outcomes";
import { DEMO_CLINIC } from "./demo-data";
import { seedDemoClinic } from "./seed-lib";
import { seedRecords } from "./seed-records";

const SECRET = "s".repeat(40);
const NOW = new Date("2026-10-24T10:00:00.000Z");

describe("demonstration clinical records", () => {
  let t: TestDb;
  const cipher = testCipher();
  before(async () => {
    t = await createSqliteTestDb();
    await createClinic(t.db, { name: DEMO_CLINIC.name, slug: DEMO_CLINIC.slug, ownerEmail: DEMO_CLINIC.ownerEmail, appOrigin: "http://localhost:3180", linkSecret: SECRET });
    await createClinic(t.db, { name: "Harbour Clinic", slug: "harbour-clinic", ownerEmail: "o@harbour.example.com", appOrigin: "http://localhost:3180", linkSecret: SECRET });
  });
  after(async () => {
    await t?.close();
  });

  it("refuses a clinic that is not a demonstration clinic", async () => {
    await assert.rejects(seedRecords({ db: t.db, cipher }, "harbour-clinic", { now: NOW }), /not flagged as a demonstration clinic/);
  });

  it("adds signed and unsigned notes, an amendment and outcome measures for the demo cases; a second run adds nothing", async () => {
    const ctx = { db: t.db, cipher, now: () => NOW };
    await seedDemoClinic(ctx, { tenantId: DEMO_CLINIC.slug, markDemo: true, now: NOW });
    const first = await seedRecords(ctx, DEMO_CLINIC.slug, { now: NOW });
    assert.ok(first.notes > 60 && first.signed > first.drafts && first.drafts >= 3, JSON.stringify(first));
    assert.equal(first.amendments, 1);
    assert.ok(first.outcomes > first.notes / 2);
    assert.equal(first.skipped, 0);
    const again = await seedRecords(ctx, DEMO_CLINIC.slug, { now: NOW });
    assert.deepEqual([again.notes, again.outcomes, again.amendments], [0, 0, 0], "idempotent");
    assert.equal(again.skipped, first.notes + first.outcomes);

    const [megan] = await searchPatients(ctx, DEMO_CLINIC.slug, { q: "megan hart" });
    const notes = await listNotesForPatient(ctx, DEMO_CLINIC.slug, megan.id);
    assert.ok(notes.length >= 3);
    const initial = notes.find((n) => n.noteType === "initial");
    const full = initial ? await getNote(ctx, DEMO_CLINIC.slug, initial.id) : null;
    assert.ok(full && full.status === "signed" && full.amendments.length === 1 && full.bodyChart?.markers.length === 1);
    assert.equal(full.contentHash, noteFingerprint(full.templateId, full.seenOn, full.sections, full.bodyChart), "fingerprint over the content");
    assert.match(full.signedRegistration ?? "", /^PH-DEMO-0\d$/);
    assert.ok(notes.some((n) => n.noteType === "discharge"), "her discharged case has a discharge summary");
    const outcomes = await listOutcomesForPatient(ctx, DEMO_CLINIC.slug, megan.id);
    assert.ok(outcomes.filter((o) => o.measure === "nprs").length >= 2 && outcomes.some((o) => o.measure === "psfs") && outcomes.some((o) => o.measure === "ndi"));
    assert.ok(outcomes.every((o) => o.takenOn <= "2026-10-24"));
    const unsigned = await countUnsignedNotesByAuthor(ctx, DEMO_CLINIC.slug, { overdueOnOrBefore: "2026-10-21" });
    assert.ok(unsigned.reduce((n, c) => n + c.drafts, 0) === first.drafts && unsigned.every((c) => /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(c.authorName ?? "")));
    const raw = await t.db.selectFrom("pms_clinical_notes").select("sections_enc").where("tenant_id", "=", DEMO_CLINIC.slug).execute();
    assert.ok(raw.every((r) => !r.sections_enc || r.sections_enc.startsWith("v1.")), "encrypted at rest");
    const audit = await listAudit(ctx, DEMO_CLINIC.slug, { limit: 500 });
    assert.ok(audit.some((e) => e.action === "pms.note.bulk_create") && audit.some((e) => e.action === "pms.outcome.bulk_create"));
    assert.ok(!JSON.stringify(audit).includes("fictional)."), "no note text in the audit trail");
  });
});
