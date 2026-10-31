/**
 * Subscription billing (31/10/2026) on SQLite and PGlite, the payment service mocked (./testing/billing-suite.ts).
 * Run by npm run test:db.
 */
import { createPgliteTestDb, createSqliteTestDb } from "../db/testing/databases";
import { defineBillingSuite } from "./testing/billing-suite";

defineBillingSuite("SQLite", async () => createSqliteTestDb());
defineBillingSuite("PGlite", async () => createPgliteTestDb());
