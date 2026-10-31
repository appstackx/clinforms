/**
 * The text credit ledger's repository suite on node:sqlite and PGlite, with the tenant-scope guard. The D1 run is in
 * workers/data-gateway/test/pms-sms-credits-stack.test.ts; real-Postgres concurrency in ./credits-concurrency.test.ts.
 */
import { createGuardedPgliteDb, createGuardedSqliteDb } from "../testing/guarded-db";
import { defineCreditsRepoSuite } from "./testing/credits-suite";

defineCreditsRepoSuite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
defineCreditsRepoSuite("Postgres (PGlite)", () => createGuardedPgliteDb());
