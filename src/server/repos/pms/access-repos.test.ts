/**
 * Configurable access (migration 0103) on node:sqlite and PGlite, with the tenant-scope guard. The D1 runs are in
 * workers/data-gateway/test/pms-access-stack.test.ts. Run by `npm run test:db` and `npm run test:pms`.
 */
import { createGuardedPgliteDb, createGuardedSqliteDb } from "./testing/guarded-db";
import { defineAccessSuite } from "./testing/access-suite";

defineAccessSuite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
defineAccessSuite("Postgres (PGlite)", () => createGuardedPgliteDb());
