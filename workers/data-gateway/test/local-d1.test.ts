/**
 * Integration test against REAL (local) D1 in workerd, through wrangler:
 *   1. `wrangler d1 migrations apply clinforms-preview --local --env preview --persist-to <tmp>` – the real
 *      migration path (wrangler's own statement splitting, incl. the trigger bodies);
 *   2. getPlatformProxy() gives the local D1 binding; the gateway handler runs against it;
 *   3. checks: append-only triggers, batch atomicity, a ~700 KB chunk parameter, concurrent rate-limit hits,
 *      then the full repository suite through the app's D1 dialect.
 * Skipped when the Worker's dependencies are not installed (`npm ci` in workers/data-gateway).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, describe, it } from "node:test";
import { defineRepoSuite } from "../../../src/server/repos/testing/repo-suite";
import { SIG_HEADER, TS_HEADER, signRequest } from "../src/auth";
import { handleRequest } from "../src/index";
import { SECRET, available, gatewayDb, startLocalD1, type Proxy } from "./local-d1";

describe("gateway on local D1 (workerd via wrangler)", { skip: !available && "wrangler not installed in workers/data-gateway" }, () => {
  let proxy: Proxy;
  let dir: string;

  before(async () => {
    ({ proxy, dir } = await startLocalD1());
  });
  after(async () => {
    await proxy?.dispose();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  async function query(statements: { sql: string; params: unknown[] }[], mode: "single" | "batch") {
    const body = new TextEncoder().encode(JSON.stringify({ statements, mode }));
    const ts = String(Date.now());
    const sig = await signRequest(SECRET, ts, "POST", "/v1/query", body);
    const res = await handleRequest(
      new Request("https://gateway.test/v1/query", { method: "POST", headers: { [TS_HEADER]: ts, [SIG_HEADER]: sig }, body }),
      { DB: proxy.env.DB, GATEWAY_SECRET: SECRET },
    );
    return { status: res.status, body: (await res.json()) as any };
  }

  it("wrangler applied 0001_init: our tables and the audit triggers exist", async () => {
    const res = await query([{ sql: "select name, type from sqlite_master where type in ('table', 'trigger') order by name", params: [] }], "single");
    const names = res.body.results[0].rows.map((r: { name: string }) => r.name);
    for (const t of ["reports", "forms", "form_file_chunks", "audit_log", "rate_limits", "audit_log_no_update", "audit_log_no_delete"]) {
      assert.ok(names.includes(t), t);
    }
  });

  it("audit_log refuses UPDATE and DELETE on real D1", async () => {
    const at = new Date().toISOString();
    const ins = await query([{ sql: "insert into audit_log (id, tenant_id, action, at) values (?, ?, ?, ?)", params: ["01LOCAL", "t", "a.b", at] }], "single");
    assert.equal(ins.status, 200);
    assert.equal((await query([{ sql: "update audit_log set action = 'x' where id = ?", params: ["01LOCAL"] }], "single")).body.error.code, "APPEND_ONLY");
    assert.equal((await query([{ sql: "delete from audit_log where id = ?", params: ["01LOCAL"] }], "single")).body.error.code, "APPEND_ONLY");
  });

  it("batch is atomic on real D1", async () => {
    const at = new Date().toISOString();
    const insert = (id: string) => ({ sql: "insert into tenant_settings (tenant_id, referrer_links_json, updated_at) values (?, '{}', ?)", params: [id, at] });
    const res = await query([insert("x1"), insert("x2"), insert("x1")], "batch");
    assert.equal(res.status, 409);
    const n = await query([{ sql: "select count(*) as n from tenant_settings where tenant_id in ('x1', 'x2')", params: [] }], "single");
    assert.equal(n.body.results[0].rows[0].n, 0);
  });

  it("stores a ~700 KB text parameter (one encrypted 512 KiB chunk)", async () => {
    const at = new Date().toISOString();
    const big = "A".repeat(700_000);
    const res = await query(
      [
        {
          sql: "insert into form_files (tenant_id, sha256, file_name, mime_type, size_bytes, chunk_count, created_at) values ('t', ?, 'f', 'application/pdf', 1, 1, ?)",
          params: ["b".repeat(64), at],
        },
        { sql: "insert into form_file_chunks (tenant_id, sha256, idx, data_enc) values ('t', ?, 0, ?)", params: ["b".repeat(64), big] },
      ],
      "batch",
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const back = await query([{ sql: "select length(data_enc) as n from form_file_chunks where sha256 = ?", params: ["b".repeat(64)] }], "single");
    assert.equal(back.body.results[0].rows[0].n, 700_000);
  });

  it("counts concurrent rate-limit hits atomically on real D1", async () => {
    const db = gatewayDb(proxy.env.DB);
    const hit = () =>
      db
        .insertInto("rate_limits")
        .values({ key: "conc", window_start: "2026-10-09T10:00:00.000Z", count: 1 })
        .onConflict((oc) => oc.columns(["key", "window_start"]).doUpdateSet((eb) => ({ count: eb("rate_limits.count", "+", 1) })))
        .returning("count")
        .executeTakeFirstOrThrow();
    const counts = (await Promise.all(Array.from({ length: 25 }, hit))).map((r) => Number(r.count)).sort((a, b) => a - b);
    assert.deepEqual(counts, Array.from({ length: 25 }, (_, i) => i + 1));
    await db.destroy();
  });
});

if (available) {
  defineRepoSuite("D1 via the gateway (local workerd D1, wrangler-applied migrations)", async () => {
    const { proxy, dir } = await startLocalD1();
    const db = gatewayDb(proxy.env.DB);
    return {
      db,
      close: async () => {
        await db.destroy();
        await proxy.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
      },
    };
  });
}
