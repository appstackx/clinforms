/**
 * The comms module's repository suite on node:sqlite and PGlite, with the tenant-scope guard. The D1 run is in
 * workers/data-gateway/test/pms-comms-stack.test.ts. Run by `npm run test:db` and `npm run test:pms`.
 */
import { createGuardedPgliteDb, createGuardedSqliteDb } from "../testing/guarded-db";
import { defineCommsRepoSuite } from "./testing/comms-suite";

defineCommsRepoSuite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
defineCommsRepoSuite("Postgres (PGlite)", () => createGuardedPgliteDb());
