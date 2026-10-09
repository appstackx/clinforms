/** The repository suite on local SQLite (node:sqlite) and on Postgres (PGlite). */
import { createPgliteTestDb, createSqliteTestDb } from "../db/testing/databases";
import { defineRepoSuite } from "./testing/repo-suite";

defineRepoSuite("SQLite (node:sqlite)", async () => createSqliteTestDb());
defineRepoSuite("Postgres (PGlite)", () => createPgliteTestDb());
