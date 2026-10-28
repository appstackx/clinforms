/**
 * The portal module's suite (repositories and the booking, sign-in and form flows) on node:sqlite and PGlite, with
 * the tenant-scope guard. The D1 runs are in workers/data-gateway/test/pms-portal-stack.test.ts. Run by
 * `npm run test:db` and `npm run test:pms`.
 */
import { createGuardedPgliteDb, createGuardedSqliteDb } from "../testing/guarded-db";
import { definePortalSuite } from "./testing/portal-suite";

definePortalSuite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
definePortalSuite("Postgres (PGlite)", () => createGuardedPgliteDb());
