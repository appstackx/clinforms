/**
 * The D1 → Postgres copy (scripts/db/copy-d1-to-postgres.ts) reads the source through the gateway by KEYSET pages
 * (where (pk…) > (…)) since M10 – the gateway's SQL rules accept the row-value comparison, and every row comes back
 * once, in primary-key order, across several pages (250 reports, 200 a page; a composite primary key).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Kysely } from "kysely";
import { D1HttpDialect } from "../../../src/server/db/dialects/d1-http";
import type { Database } from "../../../src/server/db/schema";
import { testCipher } from "../../../src/server/db/testing/databases";
import { createPglite, pgliteMigrationClient } from "../../../src/server/db/testing/pglite";
import { applyPostgresMigrations } from "../../../src/server/db/migrations";
import { createReport } from "../../../src/server/repos/reports";
import { copyDatabase, gatewaySource } from "../../../scripts/db/copy-d1-to-postgres";
import { handleRequest } from "../src/index";
import { FakeD1 } from "./fake-d1";

const SECRET = "copy-keyset-secret-".padEnd(48, "k");

describe("copy to Postgres: keyset pages through the gateway", () => {
  const d1 = new FakeD1();
  const fetchImpl = ((url: string, init: RequestInit) => handleRequest(new Request(url, init), { DB: d1, GATEWAY_SECRET: SECRET })) as unknown as typeof fetch;
  const db = new Kysely<Database>({ dialect: new D1HttpDialect({ url: "https://gateway.test", secret: SECRET, fetch: fetchImpl as never }) });
  before(async () => {
    const ctx = { db, cipher: testCipher() };
    for (let i = 0; i < 250; i++) await createReport(ctx, i % 2 ? "clinic-b" : "clinic-a", { id: `r-${String(i).padStart(3, "0")}`, status: "draft", templateId: "t", payload: { i } });
  });
  after(async () => {
    await db.destroy();
    d1.close();
  });

  it("reads every row once, in key order, over several pages", async () => {
    const source = gatewaySource("https://gateway.test", SECRET, fetchImpl);
    const first = await source.readPage("reports", 200, null);
    const second = await source.readPage("reports", 200, first[first.length - 1]);
    assert.deepEqual([first.length, second.length], [200, 50]);
    const keys = [...first, ...second].map((r) => `${r.tenant_id}/${r.id}`);
    assert.equal(new Set(keys).size, 250);
    assert.deepEqual(keys, keys.slice().sort());
    const pglite = await createPglite();
    await applyPostgresMigrations(pgliteMigrationClient(pglite));
    const dry = await copyDatabase(source, pgliteMigrationClient(pglite), { dryRun: true });
    assert.equal(dry.tables.find((t) => t.table === "reports")?.rows, 250);
    await source.close();
    await pglite.close();
  });
});
