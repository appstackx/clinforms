/**
 * Live self-test of a deployed data gateway + D1, from this machine:
 *
 *   node --import ./scripts/medreport/test-setup.mjs --import tsx scripts/db/selftest-gateway.ts [--env preview]
 *
 * Reads <ENV>_CLINFORMS_D1_GATEWAY_URL / _SECRET / _DATA_KEYS / _DATA_KEY_ID from
 * ~/.config/appstackx/clinforms.secrets.env (never printed). Works in tenant "zz-selftest" and deletes what
 * it wrote afterwards (audit rows stay – append-only is the point). Checks: health, insert/select, encrypted
 * report round-trip, batch atomicity, a 2.4 MB encrypted file round-trip, audit UPDATE/DELETE refused,
 * concurrent rate-limit increments, a bad signature refused, an old timestamp refused, no transactions.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { CompiledQuery, Kysely } from "kysely";
import { DataCipher, parseKeyring } from "../../src/server/crypto/envelope";
import { runBatch } from "../../src/server/db/batch";
import { D1HttpDialect, GATEWAY_SIG_HEADER, GATEWAY_TS_HEADER, signGatewayRequest } from "../../src/server/db/dialects/d1-http";
import { DbError, classifyDbError } from "../../src/server/db/errors";
import type { Database } from "../../src/server/db/schema";
import { appendAudit, listAudit } from "../../src/server/repos/audit";
import type { RepoContext } from "../../src/server/repos/context";
import { deleteFormFile, getFormFile, putFormFile } from "../../src/server/repos/form-files";
import { claimLaunchToken } from "../../src/server/repos/launch-tokens";
import { hitRateLimit } from "../../src/server/repos/rate-limits";
import { createReport, deleteReport, getReport, updateReport } from "../../src/server/repos/reports";
import { deleteTenantSettings, getTenantSettings, putTenantSettings } from "../../src/server/repos/tenant-settings";
import { readSecretsFile } from "./provision-gateway-secrets";

const TENANT = "zz-selftest";
const target = process.argv.includes("--env") ? process.argv[process.argv.indexOf("--env") + 1] : "preview";
const prefix = target === "production" ? "PRODUCTION_" : "PREVIEW_";

let failures = 0;
async function check(name: string, fn: () => Promise<string | void>): Promise<void> {
  const started = Date.now();
  try {
    const note = await fn();
    console.log(`PASS  ${name} (${Date.now() - started} ms)${note ? ` – ${note}` : ""}`);
  } catch (err) {
    failures += 1;
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.log(`FAIL  ${name} – ${message.slice(0, 300)}`);
  }
}

async function main(): Promise<void> {
  const secrets = readSecretsFile();
  const get = (k: string) => {
    const v = secrets.get(`${prefix}${k}`);
    if (!v) throw new Error(`${prefix}${k} is missing from the secrets file`);
    return v;
  };
  const url = get("CLINFORMS_D1_GATEWAY_URL");
  const secret = get("CLINFORMS_D1_GATEWAY_SECRET");
  const cipher = new DataCipher(parseKeyring(get("CLINFORMS_DATA_KEYS"), get("CLINFORMS_DATA_KEY_ID")));
  const db = new Kysely<Database>({ dialect: new D1HttpDialect({ url, secret, timeoutMs: 30_000 }) });
  const ctx: RepoContext = { db, cipher };
  console.log(`Gateway self-test against ${url} (tenant ${TENANT})`);

  const rawQuery = async (body: string, ts: string, sig: string) =>
    fetch(new URL("/v1/query", url), { method: "POST", headers: { [GATEWAY_TS_HEADER]: ts, [GATEWAY_SIG_HEADER]: sig }, body });

  try {
    await check("GET /v1/health", async () => {
      const res = await fetch(new URL("/v1/health", url));
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true });
    });

    await check("insert / select (tenant_settings)", async () => {
      await putTenantSettings(ctx, TENANT, { "Selftest referrer": "form-x" });
      assert.deepEqual((await getTenantSettings(ctx, TENANT))?.referrerLinks, { "Selftest referrer": "form-x" });
    });

    await check("encrypted report round-trip + optimistic concurrency", async () => {
      await deleteReport(ctx, TENANT, "selftest-report");
      assert.equal((await createReport(ctx, TENANT, { id: "selftest-report", status: "draft", templateId: "t", payload: { n: 1 } })).ok, true);
      const upd = await updateReport(ctx, TENANT, { id: "selftest-report", status: "draft", templateId: "t", payload: { n: 2 } }, 1);
      assert.equal(upd.ok && upd.rev, 2);
      assert.deepEqual(await updateReport(ctx, TENANT, { id: "selftest-report", status: "x", templateId: "t", payload: {} }, 1), {
        ok: false,
        reason: "conflict",
        currentRev: 2,
      });
      assert.deepEqual((await getReport(ctx, TENANT, "selftest-report"))?.payload, { n: 2 });
      const raw = await db.selectFrom("reports").select("payload_enc").where("tenant_id", "=", TENANT).executeTakeFirstOrThrow();
      assert.match(raw.payload_enc, /^v1\./);
    });

    await check("batch atomicity (a failing statement rolls back the batch)", async () => {
      const at = new Date().toISOString();
      const row = { key: "selftest:batch", window_start: at, count: 1 };
      await assert.rejects(runBatch(db, [db.insertInto("rate_limits").values(row), db.insertInto("rate_limits").values(row)]), (err: unknown) => {
        assert.equal(classifyDbError(err), "CONSTRAINT_UNIQUE");
        return true;
      });
      const left = await db.selectFrom("rate_limits").select("count").where("key", "=", "selftest:batch").execute();
      assert.equal(left.length, 0);
    });

    await check("2.4 MB encrypted file round-trip", async () => {
      const bytes = randomBytes(2_400_000);
      const sha = createHash("sha256").update(bytes).digest("hex");
      const t0 = Date.now();
      const put = await putFormFile(ctx, TENANT, { bytes, fileName: "selftest.pdf", mimeType: "application/pdf" });
      const t1 = Date.now();
      assert.equal(put.sha256, sha);
      const file = await getFormFile(ctx, TENANT, sha);
      const t2 = Date.now();
      assert.ok(file && file.bytes.equals(bytes), "bytes differ");
      const stored = await db
        .selectFrom("form_file_chunks")
        .select((eb) => eb.fn.countAll<number>().as("n"))
        .where("tenant_id", "=", TENANT)
        .where("sha256", "=", sha)
        .executeTakeFirstOrThrow();
      assert.equal(Number(stored.n), put.chunkCount);
      assert.equal(await deleteFormFile(ctx, TENANT, sha), true);
      return `${put.chunkCount} chunks, write ${t1 - t0} ms, read+verify ${t2 - t1} ms`;
    });

    await check("audit_log UPDATE and DELETE refused", async () => {
      const entry = await appendAudit(ctx, TENANT, { action: "selftest.run", detail: { at: new Date().toISOString() } });
      await assert.rejects(db.updateTable("audit_log").set({ action: "tampered" }).where("id", "=", entry.id).execute(), (err: unknown) => {
        assert.equal(classifyDbError(err), "APPEND_ONLY");
        return true;
      });
      await assert.rejects(db.deleteFrom("audit_log").where("id", "=", entry.id).execute(), (err: unknown) => {
        assert.equal(classifyDbError(err), "APPEND_ONLY");
        return true;
      });
      assert.equal((await listAudit(ctx, TENANT, { limit: 1 }))[0].id, entry.id);
    });

    await check("rate-limit increments are atomic under concurrency", async () => {
      const key = `selftest:rl:${Date.now()}`;
      const counts = (await Promise.all(Array.from({ length: 20 }, () => hitRateLimit(ctx, key, 60_000)))).map((h) => h.count);
      assert.deepEqual(
        counts.sort((a, b) => a - b),
        Array.from({ length: 20 }, (_, i) => i + 1),
      );
      await db.deleteFrom("rate_limits").where("key", "=", key).execute();
    });

    await check("launch token claimed once", async () => {
      const jti = `lt_selftest_${randomBytes(6).toString("hex")}`;
      const exp = new Date(Date.now() + 60_000).toISOString();
      assert.equal(await claimLaunchToken(ctx, jti, exp), true);
      assert.equal(await claimLaunchToken(ctx, jti, exp), false);
      await db.deleteFrom("launch_token_uses").where("jti", "=", jti).execute();
    });

    await check("bad signature refused (401)", async () => {
      const body = JSON.stringify({ statements: [{ sql: "select 1", params: [] }], mode: "single" });
      const ts = String(Date.now());
      const res = await rawQuery(body, ts, signGatewayRequest(randomBytes(48).toString("base64url"), ts, "POST", "/v1/query", body));
      assert.equal(res.status, 401);
      assert.equal(((await res.json()) as { error: { code: string } }).error.code, "UNAUTHORIZED");
    });

    await check("old timestamp refused (401)", async () => {
      const body = JSON.stringify({ statements: [{ sql: "select 1", params: [] }], mode: "single" });
      const ts = String(Date.now() - 5 * 60_000);
      const res = await rawQuery(body, ts, signGatewayRequest(secret, ts, "POST", "/v1/query", body));
      assert.equal(res.status, 401);
      assert.match(((await res.json()) as { error: { message: string } }).error.message, /window/);
    });

    await check("denylisted SQL refused (400 SQL_DENIED)", async () => {
      await assert.rejects(db.executeQuery(CompiledQuery.raw("PRAGMA table_list")), (err: unknown) => {
        assert.equal(classifyDbError(err), "SQL_DENIED");
        return true;
      });
    });

    await check("interactive transactions refused with a clear error", async () => {
      await assert.rejects(db.transaction().execute(async () => undefined), (err: unknown) => err instanceof DbError && err.code === "TRANSACTIONS_UNSUPPORTED");
    });
  } finally {
    // Clean up what can be deleted (audit rows stay by design).
    try {
      await deleteReport(ctx, TENANT, "selftest-report");
      await deleteTenantSettings(ctx, TENANT);
      await db.deleteFrom("rate_limits").where("key", "like", "selftest:%").execute();
      const files = await db.selectFrom("form_files").select("sha256").where("tenant_id", "=", TENANT).execute();
      for (const f of files) await deleteFormFile(ctx, TENANT, f.sha256);
      console.log("cleanup done (audit rows for zz-selftest remain: append-only)");
    } catch (err) {
      console.log(`cleanup incomplete: ${err instanceof Error ? err.message : String(err)}`);
    }
    await db.destroy();
  }
  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  if (failures) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
