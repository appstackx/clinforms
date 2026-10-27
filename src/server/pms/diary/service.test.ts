/**
 * The diary's server layer (what the server actions and route handlers call) on node:sqlite and PGlite, with the
 * tenant-scope guard. The D1 runs (stand-in and real local D1) are in workers/data-gateway/test/pms-diary-stack.test.ts.
 */
import { createGuardedPgliteDb, createGuardedSqliteDb } from "../../repos/pms/testing/guarded-db";
import { defineDiaryServiceSuite } from "./testing/service-suite";

defineDiaryServiceSuite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
defineDiaryServiceSuite("Postgres (PGlite)", () => createGuardedPgliteDb());
