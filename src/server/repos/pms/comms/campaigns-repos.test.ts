/**
 * Bulk email's repository and sending suite on node:sqlite and PGlite, with the tenant-scope guard. The D1 run is in
 * workers/data-gateway/test/pms-comms-campaigns-stack.test.ts.
 */
import { createGuardedPgliteDb, createGuardedSqliteDb } from "../testing/guarded-db";
import { defineCampaignsRepoSuite } from "./testing/campaigns-suite";

defineCampaignsRepoSuite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
defineCampaignsRepoSuite("Postgres (PGlite)", () => createGuardedPgliteDb());
