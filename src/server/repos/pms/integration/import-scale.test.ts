/**
 * 50,000 fictional patients through the whole import (upload, check, import, re-run with no duplicates, undo) on
 * node:sqlite; on PGlite 5,000 in the everyday chain (the in-process Postgres takes about 8 minutes for 50,000 –
 * run it with IMPORT_SCALE_PGLITE_ROWS=50000; measured 29/10/2026: check+import 316 s, re-run 24 s, undo 135 s).
 * IMPORT_SCALE_ROWS overrides the SQLite size. The D1 stand-in run (2,000) is in
 * workers/data-gateway/test/pms-integration-stack.test.ts.
 */
import { describe, it } from "node:test";
import { createPgliteTestDb, createSqliteTestDb } from "../../../db/testing/databases";
import { runPatientsAtScale } from "./testing/scale";

const ROWS = Number(process.env.IMPORT_SCALE_ROWS ?? 50_000);
const PG_ROWS = Number(process.env.IMPORT_SCALE_PGLITE_ROWS ?? 5_000);

describe(`data import at scale (${ROWS.toLocaleString("en-GB")} patients; PGlite ${PG_ROWS.toLocaleString("en-GB")})`, { timeout: 3_600_000 }, () => {
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
      await runPatientsAtScale(t.db, PG_ROWS, (l) => console.log(`  PGlite: ${l}`));
    } finally {
      await t.close();
    }
  });
});
