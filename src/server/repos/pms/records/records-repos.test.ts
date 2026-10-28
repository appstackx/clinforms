/**
 * The records module's repository suite on node:sqlite and PGlite, with the tenant-scope guard. The D1 runs are in
 * workers/data-gateway/test/pms-records-stack.test.ts. Run by `npm run test:db` and `npm run test:pms`.
 */
import { createGuardedPgliteDb, createGuardedSqliteDb } from "../testing/guarded-db";
import { defineRecordsRepoSuite } from "./testing/records-suite";

defineRecordsRepoSuite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
defineRecordsRepoSuite("Postgres (PGlite)", () => createGuardedPgliteDb());
