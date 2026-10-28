/**
 * Security fix 24/10/2026 (ops M1): the release on a database before migration 0006, on node:sqlite and PGlite (the D1
 * runs are in workers/data-gateway/test/admin-stack.test.ts). Run by `npm run test:db`.
 */
import { createMigratedPgliteDb } from "../db/testing/pglite";
import { createSqliteTestDb } from "../db/testing/databases";
import { defineBefore0006Suite, defineMissingTableMatcherTests } from "./testing/before-0006-suite";

defineMissingTableMatcherTests();

defineBefore0006Suite("node:sqlite", async () => {
  const t = createSqliteTestDb();
  t.sqlite.exec("DROP TABLE clinic_plan");
  return t;
});

defineBefore0006Suite("PGlite (Postgres)", async () => {
  const { db, pglite } = await createMigratedPgliteDb();
  await pglite.exec("DROP TABLE public.clinic_plan");
  return { db, close: () => db.destroy() };
});
