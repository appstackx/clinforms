/**
 * The billing server layer (M5: what the billing screens call, with the diary's visit adapter) on node:sqlite and
 * PGlite, with the tenant-scope guard. The D1 runs are in workers/data-gateway/test/pms-billing-stack.test.ts.
 */
import { createGuardedPgliteDb, createGuardedSqliteDb } from "../../repos/pms/testing/guarded-db";
import { defineBillingServiceSuite } from "./testing/service-suite";

defineBillingServiceSuite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
defineBillingServiceSuite("Postgres (PGlite)", () => createGuardedPgliteDb());
