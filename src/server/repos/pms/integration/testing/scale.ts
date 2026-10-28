/**
 * TESTS ONLY: a large fictional patients file through the whole import (upload in parts of 1,000 → check → import →
 * re-run finds every row already in the clinic → undo), on any database (K2-IMP-004 at the size of a real clinic's
 * export). Used by import-scale.test.ts (50,000 rows on node:sqlite and PGlite) and the gateway's D1 stand-in run.
 */
import assert from "node:assert/strict";
import type { Kysely } from "kysely";
import type { Database } from "../../../../db/schema";
import { testCipher } from "../../../../db/testing/databases";
import type { RepoContext } from "../../../context";
import { countPatients } from "../../patients";
import { setEntitlement } from "../../entitlements";
import { getImportBatch } from "../import-batches";
import { runCheckPage, runUndoPage } from "../../../../pms/integration/importer";
import { diaryAdapter, recordsAdapter } from "../../../../pms/integration/adapters";
import { checkAndImport, patientsCsv, untilDone, uploadBatch } from "./integration-suite";

const OWNER = { userId: "user_owner_scale", sessionId: "sess_scale" };

export async function runPatientsAtScale(db: Kysely<Database>, rows: number, log: (line: string) => void = () => {}): Promise<{ seconds: { upload: number; checkImport: number; rerun: number; undo: number } }> {
  let clock = Date.parse("2026-11-02T09:00:00.000Z");
  const ctx: RepoContext = { db, cipher: testCipher(), now: () => new Date(clock++) };
  const tenant = "scale-clinic";
  await db.insertInto("organization").values({ id: "org_scale", name: "Scale Clinic (fictional)", slug: tenant, logo: null, createdAt: new Date(clock).toISOString(), metadata: null }).execute();
  await setEntitlement(ctx, tenant, "clinic", { status: "active" }, OWNER);
  const ports = { records: recordsAdapter, diary: diaryAdapter, billing: null };
  const file = patientsCsv(rows);
  const t0 = Date.now();
  const id = await uploadBatch(ctx, tenant, "patients", file, OWNER, 1000);
  const t1 = Date.now();
  const done = await checkAndImport(ctx, tenant, id, OWNER, ports);
  const t2 = Date.now();
  assert.equal(done.counts?.imported, rows);
  assert.equal(await countPatients(ctx, tenant, "any"), rows);
  // The same file again: nothing new.
  const again = await uploadBatch(ctx, tenant, "patients", file, OWNER, 1000);
  await untilDone(() => runCheckPage(ctx, tenant, again, OWNER, ports));
  const c = (await getImportBatch(ctx, tenant, again))!.counts;
  assert.deepEqual([c.ready, c.duplicates], [0, rows]);
  const t3 = Date.now();
  const undone = await untilDone(() => runUndoPage(ctx, tenant, id, OWNER, ports));
  assert.equal(undone.counts?.undone, rows);
  assert.equal(await countPatients(ctx, tenant, "active"), 0);
  const t4 = Date.now();
  const seconds = { upload: (t1 - t0) / 1000, checkImport: (t2 - t1) / 1000, rerun: (t3 - t2) / 1000, undo: (t4 - t3) / 1000 };
  log(`${rows} patients: upload ${seconds.upload}s, check+import ${seconds.checkImport}s, re-run check ${seconds.rerun}s, undo ${seconds.undo}s`);
  return { seconds };
}
