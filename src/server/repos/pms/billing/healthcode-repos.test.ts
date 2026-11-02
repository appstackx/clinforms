/**
 * Healthcode groundwork repositories (migrations 0220–0229) on node:sqlite and PGlite: audited upserts, two clinics
 * kept apart, the tenant-scope guard. Run by `npm run test:db` and `npm run test:pms`.
 */
import { createGuardedPgliteDb, createGuardedSqliteDb } from "../testing/guarded-db";
import { defineHealthcodeRepoSuite } from "./testing/healthcode-suite";

defineHealthcodeRepoSuite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
defineHealthcodeRepoSuite("Postgres (PGlite)", () => createGuardedPgliteDb());
