/**
 * PK06 reports (./testing/pk06-reports-suite.ts) on node:sqlite and PGlite with the tenant-scope guard. The D1 runs are in
 * workers/data-gateway/test/pk06-stack.test.ts. Run by `npm run test:pms` and `npm run test:db`.
 */
import { createGuardedPgliteDb, createGuardedSqliteDb } from "../../repos/pms/testing/guarded-db";
import { definePk06ReportsSuite } from "./testing/pk06-reports-suite";

definePk06ReportsSuite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
definePk06ReportsSuite("Postgres (PGlite)", () => createGuardedPgliteDb());
