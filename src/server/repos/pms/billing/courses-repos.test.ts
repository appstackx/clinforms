/**
 * Course repositories (PK02, migrations 0231–0233 and 0238) on node:sqlite and PGlite: types, selling on an invoice,
 * using sessions from visits, reversing, cancelling with a credit note, expiry, offboarding, the tenant-scope guard.
 * Run by `npm run test:db` and `npm run test:pms`.
 */
import { createGuardedPgliteDb, createGuardedSqliteDb } from "../testing/guarded-db";
import { defineCoursesRepoSuite } from "./testing/courses-suite";

defineCoursesRepoSuite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
defineCoursesRepoSuite("Postgres (PGlite)", () => createGuardedPgliteDb());
