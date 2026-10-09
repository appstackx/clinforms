/**
 * Identity flows on node:sqlite and PGlite (Postgres), plus the generated migration 0002 is complete: Better
 * Auth finds nothing left to create on either dialect. The D1 runs are in workers/data-gateway/test.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getMigrations } from "better-auth/db/migration";
import { getAuthTables } from "better-auth/db";
import { createPgliteTestDb, createSqliteTestDb } from "../db/testing/databases";
import { createAuth } from "./create-auth";
import { AUTH_DATE_COLUMNS } from "./pg-dates";
import { defineAuthSuite } from "./testing/auth-suite";

const SECRET = "auth-test-secret-".padEnd(48, "t");
const BASE = { kind: "static" as const, url: "http://localhost:3000" };

describe("migration 0002 is exactly what Better Auth needs", () => {
  it("SQLite: no table or column left to create", async () => {
    const t = createSqliteTestDb();
    const auth = createAuth({ db: t.db, dialect: "sqlite", secret: SECRET, baseUrl: BASE });
    const plan = await getMigrations(auth.options);
    assert.deepEqual(plan.toBeCreated.map((x) => x.table), []);
    assert.deepEqual(plan.toBeAdded.map((x) => x.table), []);
    assert.deepEqual(plan.schemaProblems, []);
    await t.close();
  });
  it("Postgres: no table or column left to create", async () => {
    const t = await createPgliteTestDb();
    const auth = createAuth({ db: t.db, dialect: "postgres", secret: SECRET, baseUrl: BASE });
    const plan = await getMigrations(auth.options);
    assert.deepEqual(plan.toBeCreated.map((x) => x.table), []);
    assert.deepEqual(plan.toBeAdded.map((x) => x.table), []);
    assert.deepEqual(plan.schemaProblems, []);
    await t.close();
  });
  it("the Postgres date plugin knows every date column of Better Auth's tables", () => {
    const t = createSqliteTestDb();
    const auth = createAuth({ db: t.db, dialect: "sqlite", secret: SECRET, baseUrl: BASE });
    const dates = new Set<string>();
    for (const table of Object.values(getAuthTables(auth.options))) {
      for (const [key, field] of Object.entries(table.fields)) if (field.type === "date") dates.add(field.fieldName ?? key);
    }
    assert.deepEqual(Array.from(dates).sort(), Array.from(AUTH_DATE_COLUMNS).sort());
    void t.close();
  });
});

defineAuthSuite("SQLite (node:sqlite)", async () => {
  const t = createSqliteTestDb();
  return { db: t.db, dialect: "sqlite", close: t.close };
});

defineAuthSuite("Postgres (PGlite, production type parsers)", async () => {
  const t = await createPgliteTestDb();
  return { db: t.db, dialect: "postgres", close: t.close };
});
