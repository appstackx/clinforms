/**
 * The audit trail's "area" filter is a byte-order range ("pms.closure." ≤ action < "pms.closure/"). Supabase's
 * default collation is en_US.UTF-8 (glibc), which ignores punctuation on the first pass, so the same range is EMPTY
 * there unless the comparison is made in byte order (COLLATE "C"). PGlite's own collation is C, so this test gives
 * audit_log.action an ICU collation that orders like glibc en_US ("en@colAlternate=shifted"); with
 * CLINFORMS_TEST_PG_URL (a local Postgres with --locale=en_US.UTF-8, db/testing/real-pg.ts) it also runs there as is.
 * Fictional data only. Run by `npm run test:pms` / `test:db`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Kysely, PGliteDialect } from "kysely";
import type { Database } from "../../../db/schema";
import { createMigratedPgliteDb } from "../../../db/testing/pglite";
import { createRealPgDb, realPgTestUrl } from "../../../db/testing/real-pg";
import { searchAudit } from "./audit-search";

const T = "collation-clinic";
const ACTIONS = ["pms.closure.create", "pms.closure.remove", "pms.closure_extra.create", "pms.site.update", "pms.site_hours.update", "pms.patient.create"];

async function seed(db: Kysely<Database>): Promise<void> {
  let n = 0;
  for (const action of ACTIONS) {
    n++;
    await db
      .insertInto("audit_log")
      .values({ id: `01M6000000000000000000000${n}`, tenant_id: T, user_id: "user_x", session_id: null, action, target_type: "pms_site", target_id: `site_${n}`, detail_json: null, at: "2026-10-28T10:30:00.000Z" })
      .execute();
  }
}

async function check(db: Kysely<Database>): Promise<void> {
  const ctx = { db, now: () => new Date("2026-10-28T10:30:00.000Z") };
  const closures = await searchAudit(ctx, T, { actionPrefix: "pms.closure." });
  assert.deepEqual(closures.entries.map((e) => e.action).sort(), ["pms.closure.create", "pms.closure.remove"]);
  const sites = await searchAudit(ctx, T, { actionPrefix: "pms.site." });
  assert.deepEqual(sites.entries.map((e) => e.action), ["pms.site.update"], "the prefix includes the dot: pms.site_hours… is another area");
  assert.equal((await searchAudit(ctx, T, { actionPrefix: "pms." })).entries.length, ACTIONS.length);
}

describe("audit search by area on a database whose text order is not byte order (Supabase: en_US.UTF-8)", () => {
  it("PGlite with a glibc-like collation on audit_log.action", async () => {
    const { db, pglite } = await createMigratedPgliteDb();
    try {
      await pglite.exec(`create collation en_glibc_like (provider = icu, locale = 'en@colAlternate=shifted');
        alter table public.audit_log alter column action type text collate en_glibc_like;`);
      const { rows } = await pglite.query<{ after: boolean }>(`select 'pms.closure.create' > 'pms.closure/' collate en_glibc_like as after`);
      assert.equal(rows[0].after, true, "the collation orders like glibc en_US (punctuation ignored first)");
      const kysely = new Kysely<Database>({ dialect: new PGliteDialect({ pglite }) });
      await seed(kysely);
      await check(kysely);
    } finally {
      await db.destroy();
    }
  });

  const realUrl = realPgTestUrl();
  it("a real local Postgres (CLINFORMS_TEST_PG_URL)", { skip: realUrl ? false : "CLINFORMS_TEST_PG_URL not set" }, async () => {
    const real = await createRealPgDb(realUrl as string);
    try {
      await seed(real.db);
      await check(real.db);
    } finally {
      await real.close();
    }
  });
});
