/**
 * The diary's reporting SQL picks its Postgres or SQLite form by the database's dialect. The app's database is cached
 * on globalThis and Next.js gives each bundle (route handlers, pages, dev reloads) its own copy of kysely, so the
 * adapter can come from ANOTHER module instance: `instanceof PostgresAdapter` was then false and Postgres got the SQLite
 * form ("function julianday(timestamp with time zone) does not exist" – the dashboard's utilisation tile failed on
 * `next dev` with CLINFORMS_DB=postgres). Here a second instance of kysely's PostgresAdapter is loaded for real
 * (file URL + query string), on PGlite. Run by `npm run test:pms` / `test:db`.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { Kysely, PGliteDialect, PostgresAdapter, SqliteAdapter, type DialectAdapter } from "kysely";
import { D1HttpAdapter } from "../../db/dialects/d1-http";
import { isPostgresAdapter } from "../../db/dialect-kind";
import type { Database } from "../../db/schema";
import { createMigratedPgliteDb } from "../../db/testing/pglite";
import { testCipher } from "../../db/testing/databases";
import { DIARY_REPORTING_SOURCE, isPostgres } from "./reporting-source";

async function foreignPostgresAdapter(): Promise<DialectAdapter> {
  const dist = path.resolve("node_modules/kysely/dist"); // tests run from the repository root
  const mod = (await import(`${pathToFileURL(path.join(dist, "dialect/postgres/postgres-adapter.js")).href}?second-instance`)) as { PostgresAdapter: new () => DialectAdapter };
  return new mod.PostgresAdapter();
}

describe("dialect detection survives a second module instance of kysely", () => {
  it("a PostgresAdapter from another instance is not instanceof ours – and still counts as Postgres; SQLite and D1 do not", async () => {
    const foreign = await foreignPostgresAdapter();
    assert.equal(foreign instanceof PostgresAdapter, false, "the hazard is real: another class object");
    assert.equal(isPostgresAdapter(foreign), true);
    assert.equal(isPostgresAdapter(new PostgresAdapter()), true);
    assert.equal(isPostgresAdapter(new SqliteAdapter()), false);
    assert.equal(isPostgresAdapter(new D1HttpAdapter()), false);
  });

  it("the diary reporting facts run on Postgres through such an adapter (no SQLite julianday)", async () => {
    const { pglite, db: own } = await createMigratedPgliteDb();
    const foreign = await foreignPostgresAdapter();
    const base = new PGliteDialect({ pglite });
    const db = new Kysely<Database>({
      dialect: {
        createAdapter: () => foreign,
        createDriver: () => base.createDriver(),
        createIntrospector: (k) => base.createIntrospector(k),
        createQueryCompiler: () => base.createQueryCompiler(),
      },
    });
    try {
      assert.equal(isPostgres(db), true);
      const ctx = { db, cipher: testCipher(), now: () => new Date("2026-10-28T10:30:00.000Z") };
      const facts = await DIARY_REPORTING_SOURCE.appointmentFacts(ctx, "dialect-clinic", {
        from: "2026-10-01",
        to: "2026-10-31",
        start: "2026-09-30T23:00:00.000Z",
        end: "2026-10-31T23:59:59.999Z",
        now: "2026-10-28T10:30:00.000Z",
        siteIds: null,
        practitionerId: null,
      });
      assert.deepEqual(facts, []);
    } finally {
      await own.destroy();
    }
  });
});
