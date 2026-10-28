/**
 * The reports' server layer (M8) on node:sqlite and PGlite with the tenant-scope guard: every report's figures equal
 * the hand-worked fact checks of ./testing/reports-suite.ts. The D1 runs are in
 * workers/data-gateway/test/pms-reporting-stack.test.ts.
 */
import { createGuardedPgliteDb, createGuardedSqliteDb } from "../../repos/pms/testing/guarded-db";
import { defineReportsServiceSuite } from "./testing/reports-suite";

defineReportsServiceSuite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
defineReportsServiceSuite("Postgres (PGlite)", () => createGuardedPgliteDb());
