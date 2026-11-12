/**
 * PK06 expiry (./testing/pk06-expiry-suite.ts) on node:sqlite and PGlite with the tenant-scope guard. The D1 runs are in
 * workers/data-gateway/test/pk06-stack.test.ts. Run by `npm run test:pms` and `npm run test:db`.
 */
import { createGuardedPgliteDb, createGuardedSqliteDb } from "../../repos/pms/testing/guarded-db";
import { definePk06ExpirySuite } from "./testing/pk06-expiry-suite";

definePk06ExpirySuite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
definePk06ExpirySuite("Postgres (PGlite)", () => createGuardedPgliteDb());
