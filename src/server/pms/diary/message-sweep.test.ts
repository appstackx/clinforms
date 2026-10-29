/**
 * The message run's diary sweep (testing/message-sweep-suite.ts) on node:sqlite and PGlite, with the tenant-scope
 * guard. The D1 runs are in workers/data-gateway/test/pms-diary-stack.test.ts. Run by `npm run test:pms`.
 */
import { createGuardedPgliteDb, createGuardedSqliteDb } from "../../repos/pms/testing/guarded-db";
import { defineMessageSweepSuite } from "./testing/message-sweep-suite";

defineMessageSweepSuite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
defineMessageSweepSuite("Postgres (PGlite)", () => createGuardedPgliteDb());
