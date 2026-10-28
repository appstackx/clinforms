/**
 * The reporting and set-up module's repository suite on node:sqlite and PGlite, with the tenant-scope guard.
 * The D1 run is in workers/data-gateway/test/pms-reporting-stack.test.ts. Run by `npm run test:db` / `test:pms`.
 */
import { createGuardedPgliteDb, createGuardedSqliteDb } from "../testing/guarded-db";
import { defineReportingRepoSuite } from "./testing/reporting-suite";

defineReportingRepoSuite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
defineReportingRepoSuite("Postgres (PGlite)", () => createGuardedPgliteDb());
