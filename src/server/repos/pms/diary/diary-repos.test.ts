/**
 * The diary's repository suite on node:sqlite and PGlite, with the tenant-scope guard. The D1 runs (stand-in and
 * real local D1) are in workers/data-gateway/test/pms-diary-stack.test.ts. Run by `npm run test:pms` / `test:db`.
 */
import { createGuardedPgliteDb, createGuardedSqliteDb } from "../testing/guarded-db";
import { defineDiaryRepoSuite } from "./testing/diary-suite";

defineDiaryRepoSuite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
defineDiaryRepoSuite("Postgres (PGlite)", () => createGuardedPgliteDb());
