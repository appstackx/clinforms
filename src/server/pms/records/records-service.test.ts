/**
 * The records module's server layer (permissions, scope, validation, safe errors, the subject-access copy) on
 * node:sqlite and PGlite, with the tenant-scope guard. The D1 runs are in
 * workers/data-gateway/test/pms-records-stack.test.ts. Run by `npm run test:pms` and `npm run test:db`.
 */
import { createGuardedPgliteDb, createGuardedSqliteDb } from "../../repos/pms/testing/guarded-db";
import { defineRecordsServiceSuite } from "./testing/service-suite";

defineRecordsServiceSuite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
defineRecordsServiceSuite("Postgres (PGlite)", () => createGuardedPgliteDb());
