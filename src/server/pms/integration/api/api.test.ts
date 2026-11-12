/**
 * The public clinic API v1 (xt03): the integration suite through its HTTP pipeline on node:sqlite and PGlite, with the
 * tenant-scope guard. The D1 runs are in workers/data-gateway/test/pms-integration-api-stack.test.ts. Run by
 * `npm run test:pms` and `npm run test:db`.
 */
import { createGuardedPgliteDb, createGuardedSqliteDb } from "../../../repos/pms/testing/guarded-db";
import { defineClinicApiSuite } from "./testing/api-suite";

defineClinicApiSuite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
defineClinicApiSuite("Postgres (PGlite)", () => createGuardedPgliteDb());
