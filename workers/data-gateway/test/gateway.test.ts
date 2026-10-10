/**
 * Unit tests of the gateway Worker's handler (HMAC, validation, limits, denylist, error mapping), with a
 * node:sqlite stand-in for the D1 binding. Run from the repository root: `npm run test:gateway`.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { signGatewayRequest } from "../../../src/server/db/dialects/d1-http";
import { SIG_HEADER, TS_HEADER, signRequest } from "../src/auth";
import { handleRequest, mapDatabaseError } from "../src/index";
import { LIMITS, checkSql } from "../src/validate";
import { FakeD1 } from "./fake-d1";

const SECRET = "test-secret-".padEnd(48, "x");
const BASE = "https://gateway.test";
const NOW = 1_790_000_000_000;

const d1 = new FakeD1();
const env = { DB: d1, GATEWAY_SECRET: SECRET };
after(() => d1.close());

async function signed(body: unknown, opts: { ts?: number; secret?: string; path?: string; method?: string } = {}): Promise<Request> {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const ts = String(opts.ts ?? NOW);
  const path = opts.path ?? "/v1/query";
  const sig = await signRequest(opts.secret ?? SECRET, ts, opts.method ?? "POST", path, new TextEncoder().encode(text));
  return new Request(`${BASE}${path}`, {
    method: opts.method ?? "POST",
    headers: { "content-type": "application/json", [TS_HEADER]: ts, [SIG_HEADER]: sig },
    body: text,
  });
}

async function call(req: Request): Promise<{ status: number; body: any }> {
  const res = await handleRequest(req, env, NOW);
  return { status: res.status, body: await res.json() };
}

describe("gateway: routing and auth", () => {
  it("serves /v1/health without auth and nothing else", async () => {
    assert.deepEqual(await call(new Request(`${BASE}/v1/health`)), { status: 200, body: { ok: true } });
    assert.equal((await call(new Request(`${BASE}/v1/nope`))).status, 404);
    assert.equal((await call(new Request(`${BASE}/v1/query`))).status, 405);
    assert.equal((await call(new Request(`${BASE}/v1/email`, { method: "POST" }))).status, 404);
  });

  it("accepts a correctly signed request (and the app's Node signer agrees with the Worker's)", async () => {
    const body = JSON.stringify({ statements: [{ sql: "select 1 as one", params: [] }], mode: "single" });
    const nodeSig = signGatewayRequest(SECRET, String(NOW), "POST", "/v1/query", body);
    const workerSig = await signRequest(SECRET, String(NOW), "POST", "/v1/query", new TextEncoder().encode(body));
    assert.equal(nodeSig, workerSig);
    const res = await call(
      new Request(`${BASE}/v1/query`, { method: "POST", headers: { [TS_HEADER]: String(NOW), [SIG_HEADER]: nodeSig }, body }),
    );
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.results[0].rows, [{ one: 1 }]);
  });

  it("refuses missing headers, bad signatures, other secrets, tampered bodies and stale timestamps", async () => {
    const body = { statements: [{ sql: "select 1", params: [] }], mode: "single" };
    const unsigned = new Request(`${BASE}/v1/query`, { method: "POST", body: JSON.stringify(body) });
    assert.equal((await call(unsigned)).status, 401);
    const wrongSecret = await call(await signed(body, { secret: "another-secret".padEnd(48, "y") }));
    assert.deepEqual(wrongSecret, { status: 401, body: { error: { code: "UNAUTHORIZED", message: "Signature does not match." } } });
    const good = await signed(body);
    const tampered = new Request(good.url, {
      method: "POST",
      headers: good.headers,
      body: JSON.stringify({ ...body, statements: [{ sql: "select 2", params: [] }] }),
    });
    assert.equal((await call(tampered)).status, 401);
    const old = await call(await signed(body, { ts: NOW - 61_000 }));
    assert.equal(old.status, 401);
    assert.match(old.body.error.message, /outside the allowed window/);
    assert.equal((await call(await signed(body, { ts: NOW + 61_000 }))).status, 401);
    assert.equal((await call(await signed(body, { ts: NOW - 59_000 }))).status, 200);
    // the signature covers the path: a signature made for another path fails
    const otherPath = await signed(body, { path: "/v1/other" });
    const moved = new Request(`${BASE}/v1/query`, { method: "POST", headers: otherPath.headers, body: JSON.stringify(body) });
    assert.equal((await call(moved)).status, 401);
    const notHex = new Request(`${BASE}/v1/query`, {
      method: "POST",
      headers: { [TS_HEADER]: String(NOW), [SIG_HEADER]: "z".repeat(64) },
      body: "{}",
    });
    assert.equal((await call(notHex)).status, 401);
  });

  it("is closed when GATEWAY_SECRET is missing or short", async () => {
    const req = await signed({ statements: [{ sql: "select 1", params: [] }], mode: "single" });
    const res = await handleRequest(req, { DB: d1, GATEWAY_SECRET: "short" }, NOW);
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as any).error.code, "NOT_CONFIGURED");
  });
});

describe("gateway: limits and validation", () => {
  it("rejects bodies over 8 MiB (declared or streamed)", async () => {
    const declared = new Request(`${BASE}/v1/query`, {
      method: "POST",
      headers: { [TS_HEADER]: String(NOW), [SIG_HEADER]: "a".repeat(64), "content-length": String(LIMITS.maxBodyBytes + 1) },
      body: "{}",
    });
    assert.equal((await call(declared)).status, 413);
    const big = "x".repeat(LIMITS.maxBodyBytes + 10);
    const streamed = new Request(`${BASE}/v1/query`, {
      method: "POST",
      headers: { [TS_HEADER]: String(NOW), [SIG_HEADER]: "a".repeat(64) },
      body: new Blob([big]).stream(),
      // @ts-expect-error Node's fetch needs duplex for stream bodies
      duplex: "half",
    });
    assert.equal((await call(streamed)).status, 413);
  });

  it("rejects malformed bodies, > 100 statements, > 100 params and bad parameter types", async () => {
    const stmt = { sql: "select ?", params: [1] };
    assert.equal((await call(await signed("not json"))).body.error.code, "BAD_REQUEST");
    assert.equal((await call(await signed({ statements: [stmt], mode: "both" }))).status, 400);
    assert.equal((await call(await signed({ statements: [], mode: "batch" }))).status, 400);
    assert.equal((await call(await signed({ statements: [stmt, stmt], mode: "single" }))).status, 400);
    const many = await call(await signed({ statements: Array.from({ length: 101 }, () => stmt), mode: "batch" }));
    assert.equal(many.body.error.code, "TOO_MANY_STATEMENTS");
    const params = await call(await signed({ statements: [{ sql: "select 1", params: Array.from({ length: 101 }, () => 1) }], mode: "single" }));
    assert.equal(params.status, 400);
    const obj = await call(await signed({ statements: [{ sql: "select ?", params: [{ a: 1 }] }], mode: "single" }));
    assert.equal(obj.status, 400);
    const long = await call(await signed({ statements: [{ sql: `select '${"x".repeat(LIMITS.maxSqlLength)}'`, params: [] }], mode: "single" }));
    assert.equal(long.status, 400);
  });

  it("denies ATTACH, DETACH, PRAGMA, VACUUM, DDL, transaction control, comments, REPLACE, internal-table writes and stacked statements", async () => {
    const denied = [
      "ATTACH DATABASE 'x.db' AS x",
      "detach database x",
      "PRAGMA writable_schema = 1",
      "pragma foreign_keys=off",
      "VACUUM",
      "CREATE TABLE t (a)",
      "drop table reports",
      "ALTER TABLE reports ADD COLUMN x",
      "BEGIN",
      "commit",
      "UPDATE sqlite_master SET sql = ''",
      "delete from d1_migrations",
      "insert into _cf_KV values (1)",
      "select 1; delete from reports",
      "select load_extension('x')",
      // a leading comment must not hide the real first keyword (security review, wave 1)
      "/* x */ DROP TRIGGER audit_log_no_delete",
      "-- x\nDROP TRIGGER audit_log_no_update",
      "select 1 /* note */",
      "select 1 -- note",
      // writes to internal tables are refused whatever the statement starts with
      "WITH x AS (SELECT 1) DELETE FROM d1_migrations",
      "with x as (select 1) insert into sqlite_master select * from x",
      // REPLACE conflict resolution overwrites rows without firing DELETE triggers (append-only bypass)
      "INSERT OR REPLACE INTO audit_log (id, tenant_id, action, at) VALUES ('A1', 't', 'x', 'y')",
      "insert  or\treplace into audit_log (id) values (?)",
      "REPLACE INTO audit_log (id, tenant_id, action, at) VALUES ('A1', 't', 'x', 'y')",
      "update or replace audit_log set id = 'x'",
      // only SELECT / INSERT / UPDATE / DELETE / WITH statements
      "DROP TRIGGER audit_log_no_delete",
      "values (1)",
      "explain select 1",
      "(select 1)",
      "reindex",
    ];
    for (const sql of denied) {
      const res = await call(await signed({ statements: [{ sql, params: [] }], mode: "single" }));
      assert.equal(res.status, 400, sql);
      assert.equal(res.body.error.code, "SQL_DENIED", sql);
    }
    // allowed: reads of the schema (Kysely's introspector) and our own statements
    for (const sql of [
      "select name from sqlite_master where type = 'table'",
      "select * from pragma_table_info('reports')",
      "select 1;",
      'insert into "rate_limits" ("key", "window_start", "count") values (?, ?, ?) on conflict ("key", "window_start") do update set "count" = "rate_limits"."count" + 1 returning "count"',
      "with recent as (select id from reports where tenant_id = ?) delete from reports where id in (select id from recent)",
      "  \n select replace(name, 'a', 'b') from reports",
      'select name from sqlite_schema where type = ? and name not like ?',
    ]) {
      assert.doesNotThrow(() => checkSql(sql), sql);
    }
  });
});

describe("gateway: execution", () => {
  it("runs single statements and reports changes / lastRowId", async () => {
    const at = "2026-10-09T10:00:00.000Z";
    const ins = await call(
      await signed({
        statements: [{ sql: "insert into tenant_settings (tenant_id, referrer_links_json, updated_at) values (?, ?, ?)", params: ["t1", "{}", at] }],
        mode: "single",
      }),
    );
    assert.equal(ins.status, 200);
    assert.equal(ins.body.results[0].changes, 1);
    const sel = await call(
      await signed({ statements: [{ sql: "select tenant_id, ? as flag from tenant_settings where tenant_id = ?", params: [true, "t1"] }], mode: "single" }),
    );
    assert.deepEqual(sel.body.results[0].rows, [{ tenant_id: "t1", flag: 1 }]);
  });

  it("runs a batch atomically: one failing statement rolls back all of it", async () => {
    const at = "2026-10-09T10:00:00.000Z";
    const insert = (id: string) => ({
      sql: "insert into tenant_settings (tenant_id, referrer_links_json, updated_at) values (?, ?, ?)",
      params: [id, "{}", at],
    });
    const res = await call(await signed({ statements: [insert("b1"), insert("b2"), insert("b1")], mode: "batch" }));
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "CONSTRAINT_UNIQUE");
    const check = await call(
      await signed({ statements: [{ sql: "select count(*) as n from tenant_settings where tenant_id in ('b1', 'b2')", params: [] }], mode: "single" }),
    );
    assert.equal(check.body.results[0].rows[0].n, 0);
    const ok = await call(await signed({ statements: [insert("b1"), insert("b2")], mode: "batch" }));
    assert.equal(ok.status, 200);
    assert.equal(ok.body.results.length, 2);
  });

  it("refuses audit UPDATE/DELETE (append-only) and never echoes parameters in errors", async () => {
    const at = "2026-10-09T10:00:00.000Z";
    await call(
      await signed({
        statements: [{ sql: "insert into audit_log (id, tenant_id, action, at) values (?, ?, ?, ?)", params: ["01AUDIT", "t1", "x.y", at] }],
        mode: "single",
      }),
    );
    const upd = await call(await signed({ statements: [{ sql: "update audit_log set action = ? where id = ?", params: ["SECRET-VALUE-123", "01AUDIT"] }], mode: "single" }));
    assert.deepEqual(upd, { status: 409, body: { error: { code: "APPEND_ONLY", message: "audit_log is append-only." } } });
    const del = await call(await signed({ statements: [{ sql: "delete from audit_log where id = ?", params: ["01AUDIT"] }], mode: "single" }));
    assert.equal(del.body.error.code, "APPEND_ONLY");
    const dup = await call(
      await signed({
        statements: [{ sql: "insert into audit_log (id, tenant_id, action, at) values (?, ?, ?, ?)", params: ["01AUDIT", "PATIENT-NAME-XYZ", "x.y", at] }],
        mode: "single",
      }),
    );
    assert.equal(dup.status, 409);
    assert.ok(!JSON.stringify(dup.body).includes("PATIENT-NAME-XYZ"));
    const bad = await call(await signed({ statements: [{ sql: "select * from no_such_table where x = ?", params: ["PATIENT-NAME-XYZ"] }], mode: "single" }));
    assert.equal(bad.status, 400);
    assert.ok(!JSON.stringify(bad.body).includes("PATIENT-NAME-XYZ"));
  });

  it("maps unknown database failures to 503 without detail", () => {
    assert.deepEqual(mapDatabaseError(new Error("D1_ERROR: Network connection lost.")), {
      status: 503,
      code: "UNAVAILABLE",
      message: "The database is temporarily unavailable.",
    });
    assert.equal(mapDatabaseError(new Error("D1_ERROR: no such table: x: SQLITE_ERROR")).code, "SQL_ERROR");
  });
});
