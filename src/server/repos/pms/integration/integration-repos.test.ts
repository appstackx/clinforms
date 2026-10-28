/**
 * The integration module's suite (data import with the records and diary adapters, the native connector) on
 * node:sqlite and PGlite, with the tenant-scope guard. The D1 runs are in
 * workers/data-gateway/test/pms-integration-stack.test.ts. Run by `npm run test:db` and `npm run test:pms`.
 */
import { createGuardedPgliteDb, createGuardedSqliteDb } from "../testing/guarded-db";
import { defineIntegrationSuite } from "./testing/integration-suite";

defineIntegrationSuite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
defineIntegrationSuite("Postgres (PGlite)", () => createGuardedPgliteDb());
