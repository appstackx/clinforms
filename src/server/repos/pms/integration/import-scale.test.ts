/**
 * 50,000 fictional patients through the whole import on node:sqlite and PGlite (upload, check, import, re-run with
 * no duplicates, undo). IMPORT_SCALE_ROWS overrides the size. The D1 stand-in run (smaller) is in
 * workers/data-gateway/test/pms-integration-stack.test.ts.
 */
import { describe, it } from "node:test";
import { createPgliteTestDb, createSqliteTestDb } from "../../../db/testing/databases";
import { runPatientsAtScale } from "./testing/scale";

const ROWS = Number(process.env.IMPORT_SCALE_ROWS ?? 50_000);

describe(`data import at scale (${ROWS.toLocaleString("en-GB")} patients)`, { timeout: 3_600_000 }, () => {
  it("SQLite (node:sqlite)", { timeout: 3_600_000 }, async () => {
    const t = createSqliteTestDb();
    try {
      await runPatientsAtScale(t.db, ROWS, (l) => console.log(`  SQLite: ${l}`));
    } finally {
      await t.close();
    }
  });
  it("Postgres (PGlite)", { timeout: 3_600_000 }, async () => {
    const t = await createPgliteTestDb();
    try {
      await runPatientsAtScale(t.db, ROWS, (l) => console.log(`  PGlite: ${l}`));
    } finally {
      await t.close();
    }
  });
});
