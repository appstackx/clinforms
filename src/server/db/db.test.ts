import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { Kysely } from "kysely";
import { runBatch, isD1Database } from "./batch";
import { D1GatewayClient, D1HttpDialect, signGatewayRequest, toGatewayValue } from "./dialects/d1-http";
import { pgInt8ToNumber, pgTimestampToIso, sessionPostgresConfigFromEnv } from "./dialects/postgres";
import { DbError, classifyDbError } from "./errors";
import { closeDb, createDb, getDb, resolveDbKind } from "./index";
import type { Database } from "./schema";

describe("getDb / resolveDbKind", () => {
  it("defaults to sqlite locally and requires CLINFORMS_DB on Vercel", () => {
    assert.equal(resolveDbKind({}), "sqlite");
    assert.equal(resolveDbKind({ CLINFORMS_DB: " D1 " }), "d1");
    assert.equal(resolveDbKind({ CLINFORMS_DB: "postgres", VERCEL: "1" }), "postgres");
    assert.throws(() => resolveDbKind({ VERCEL: "1" }), /CLINFORMS_DB must be set on Vercel/);
    assert.throws(() => resolveDbKind({ VERCEL: "1", CLINFORMS_DB: "sqlite" }), /local development only/);
    assert.throws(() => resolveDbKind({ CLINFORMS_DB: "mysql" }), /must be d1, postgres or sqlite/);
  });

  it("sqlite: creates the file, migrates it on first use and caches the instance", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clinforms-db-"));
    const file = path.join(dir, "nested", "local.db");
    const saved = { ...process.env };
    try {
      process.env.CLINFORMS_DB = "sqlite";
      process.env.CLINFORMS_SQLITE_PATH = file;
      delete process.env.VERCEL;
      const db = getDb();
      assert.equal(getDb(), db);
      const rows = await db.selectFrom("reports").selectAll().execute();
      assert.deepEqual(rows, []);
      assert.ok(fs.existsSync(file));
      await closeDb();
    } finally {
      process.env = saved;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("d1 and postgres need their settings", () => {
    assert.throws(() => createDb("d1", { CLINFORMS_D1_GATEWAY_URL: "https://x.example", CLINFORMS_D1_GATEWAY_SECRET: "short" }), /32\+ characters/);
    assert.throws(() => createDb("d1", { CLINFORMS_D1_GATEWAY_URL: "http://x.example", CLINFORMS_D1_GATEWAY_SECRET: "s".repeat(40) }), /https/);
    assert.throws(() => createDb("postgres", {}), /DATABASE_URL/);
  });
});

describe("D1 HTTP dialect (client side)", () => {
  const secret = "s".repeat(48);

  it("signs ts\\nMETHOD\\npath\\nsha256(body) with HMAC-SHA256 (hex)", () => {
    const sig = signGatewayRequest(secret, "1700000000000", "post", "/v1/query", "{}");
    assert.match(sig, /^[0-9a-f]{64}$/);
    assert.equal(sig, signGatewayRequest(secret, "1700000000000", "POST", "/v1/query", Buffer.from("{}")));
    assert.notEqual(sig, signGatewayRequest(secret, "1700000000001", "POST", "/v1/query", "{}"));
  });

  it("refuses interactive transactions with a clear error, and runBatch uses one batch request", async () => {
    const calls: { mode: string; n: number }[] = [];
    const db = new Kysely<Database>({
      dialect: new D1HttpDialect({
        url: "https://gateway.example",
        secret,
        fetch: async (_url, init) => {
          const body = JSON.parse(String(init.body)) as { mode: string; statements: unknown[] };
          calls.push({ mode: body.mode, n: body.statements.length });
          return new Response(JSON.stringify({ results: body.statements.map(() => ({ rows: [], changes: 1, lastRowId: 1 })) }), {
            status: 200,
          });
        },
      }),
    });
    assert.equal(isD1Database(db), true);
    await assert.rejects(
      db.transaction().execute(async () => undefined),
      (err: unknown) => err instanceof DbError && err.code === "TRANSACTIONS_UNSUPPORTED" && /runBatch/.test(err.message),
    );
    const at = "2026-10-09T00:00:00.000Z";
    const results = await runBatch(db, [
      db.insertInto("tenant_settings").values({ tenant_id: "t", referrer_links_json: "{}", updated_at: at }),
      db.deleteFrom("tenant_settings").where("tenant_id", "=", "t"),
    ]);
    assert.equal(results.length, 2);
    assert.deepEqual(calls, [{ mode: "batch", n: 2 }]);
    await db.selectFrom("reports").selectAll().execute();
    assert.deepEqual(calls[1], { mode: "single", n: 1 });
  });

  it("maps gateway errors to DbError codes without leaking parameters", async () => {
    const client = new D1GatewayClient({
      url: "https://gateway.example",
      secret,
      fetch: async () =>
        new Response(JSON.stringify({ error: { code: "CONSTRAINT_UNIQUE", message: "UNIQUE constraint failed: forms.id" } }), {
          status: 409,
        }),
    });
    await assert.rejects(client.query([{ sql: "insert …", params: ["secret-value"] }], "single"), (err: unknown) => {
      assert.ok(err instanceof DbError);
      assert.equal(err.code, "CONSTRAINT_UNIQUE");
      assert.equal(err.status, 409);
      assert.ok(!err.message.includes("secret-value"));
      return true;
    });
    const down = new D1GatewayClient({
      url: "https://gateway.example",
      secret,
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await assert.rejects(down.query([{ sql: "select 1", params: [] }], "single"), (err: unknown) => classifyDbError(err) === "GATEWAY_UNAVAILABLE");
  });

  it("converts parameters for JSON transport", () => {
    assert.equal(toGatewayValue(true), true);
    assert.equal(toGatewayValue(BigInt(5)), 5);
    assert.equal(toGatewayValue(new Date("2026-10-09T00:00:00Z")), "2026-10-09T00:00:00.000Z");
    assert.throws(() => toGatewayValue(undefined), /undefined/);
    assert.throws(() => toGatewayValue(new Uint8Array(2)), /Unsupported/);
    assert.throws(() => toGatewayValue(Number.NaN), /finite/);
    assert.throws(() => toGatewayValue(BigInt("1152921504606846976")), /safe integer/);
  });
});

describe("Postgres type parsers", () => {
  it("timestamptz text → ISO-8601 UTC with ms", () => {
    assert.equal(pgTimestampToIso("2026-10-09 12:00:00.123+00"), "2026-10-09T12:00:00.123Z");
    assert.equal(pgTimestampToIso("2026-10-09 12:00:00.123456+00"), "2026-10-09T12:00:00.123Z");
    assert.equal(pgTimestampToIso("2026-10-09 13:00:00+01"), "2026-10-09T12:00:00.000Z");
    assert.equal(pgTimestampToIso("2026-10-09 17:30:00+05:30"), "2026-10-09T12:00:00.000Z");
    assert.equal(pgTimestampToIso("2026-10-09 12:00:00"), "2026-10-09T12:00:00.000Z");
    assert.equal(pgTimestampToIso("infinity"), "infinity");
  });
  it("migrations and the copy use one session: DATABASE_URL_SESSION first, the transaction pooler refused", () => {
    const session = "postgresql://postgres.ref:pw@aws-0-eu-west-2.pooler.supabase.com:5432/postgres";
    const transaction = "postgresql://postgres.ref:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres";
    assert.equal(sessionPostgresConfigFromEnv({ DATABASE_URL: transaction, DATABASE_URL_SESSION: session }).connectionString, session);
    assert.equal(sessionPostgresConfigFromEnv({ DATABASE_URL: session }).connectionString, session);
    assert.throws(() => sessionPostgresConfigFromEnv({ DATABASE_URL: transaction }), /session pooler/);
    assert.throws(() => sessionPostgresConfigFromEnv({}), /DATABASE_URL/);
  });

  it("int8 → number, refusing unsafe values", () => {
    assert.equal(pgInt8ToNumber("42"), 42);
    assert.throws(() => pgInt8ToNumber("9007199254740993"));
  });
});

describe("classifyDbError", () => {
  it("normalises SQLite, D1 and Postgres errors", () => {
    assert.equal(classifyDbError({ code: "23505", message: "duplicate key value violates unique constraint" }), "CONSTRAINT_UNIQUE");
    assert.equal(classifyDbError({ code: "P0001", message: "audit_log is append-only" }), "APPEND_ONLY");
    assert.equal(classifyDbError({ errcode: 2067, message: "UNIQUE constraint failed: t.a" }), "CONSTRAINT_UNIQUE");
    assert.equal(classifyDbError(new Error("D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT")), "CONSTRAINT_FOREIGN_KEY");
    assert.equal(classifyDbError(new DbError("GATEWAY_AUTH", "x")), "GATEWAY_AUTH");
    assert.equal(classifyDbError(null), "UNKNOWN");
  });
});
