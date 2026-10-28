/**
 * The billing repository suite on node:sqlite and PGlite, with the tenant-scope guard. The D1 run is in
 * workers/data-gateway/test/pms-billing-stack.test.ts. Run by `npm run test:db` and `npm run test:pms`.
 */
import { createGuardedPgliteDb, createGuardedSqliteDb } from "../testing/guarded-db";
import { defineBillingRepoSuite } from "./testing/billing-suite";

defineBillingRepoSuite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
defineBillingRepoSuite("Postgres (PGlite)", () => createGuardedPgliteDb());
