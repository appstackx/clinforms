/**
 * Xero sync (xe06): the suite against the fake Xero on node:sqlite and PGlite, with the tenant-scope guard. The D1
 * runs are in workers/data-gateway/test/pms-xero-stack.test.ts. Run by `npm run test:pms` and `npm run test:db`.
 */
import { createGuardedPgliteDb, createGuardedSqliteDb } from "../../../repos/pms/testing/guarded-db";
import { defineXeroSuite } from "./testing/xero-suite";

defineXeroSuite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
defineXeroSuite("Postgres (PGlite)", () => createGuardedPgliteDb());
