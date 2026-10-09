/**
 * "Request access": validation, honeypot, rate limits, storage and the notification email, against an
 * in-memory SQLite database with the real migrations; plus the API route's HTTP behaviour.
 */
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createSqliteTestDb, testCipher, type TestDb } from "../db/testing/databases";
import { listAccessRequests } from "../repos/access-requests";
import type { RepoContext } from "../repos/context";
import { clientIpFrom, hashClientIp, storedMessage, submitAccessRequest, type NotificationPayload } from "./access-request";
import { accessRequestEmail, escapeHtml, mailerSendSettingsFromEnv } from "./notify";

const VALID = {
  clinicName: "Riverside Physiotherapy (fictional)",
  contactName: "Sarah Reid",
  email: "sarah@riverside-physio.example",
  phone: "01908 000000",
  sites: "2-5",
  message: "Mostly insurer forms.",
  website: "",
};

let testDb: TestDb;
let ctx: RepoContext;
const NOW = new Date("2026-10-09T10:15:00.000Z");

beforeEach(() => {
  testDb = createSqliteTestDb();
  ctx = { db: testDb.db, cipher: testCipher(), now: () => NOW };
});
afterEach(async () => {
  await testDb.close();
});

describe("submitAccessRequest", () => {
  test("stores a valid request with the number of sites in the message", async () => {
    const outcome = await submitAccessRequest(VALID, { ctx, clientKey: "k1" });
    assert.equal(outcome.kind, "stored");
    const rows = await listAccessRequests(ctx);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].clinicName, VALID.clinicName);
    assert.equal(rows[0].email, VALID.email);
    assert.equal(rows[0].phone, VALID.phone);
    assert.equal(rows[0].message, "Sites: 2-5\n\nMostly insurer forms.");
    assert.equal(rows[0].createdAt, NOW.toISOString());
  });

  test("optional fields may be empty or missing", async () => {
    const { phone: _p, message: _m, website: _w, ...minimal } = VALID;
    const outcome = await submitAccessRequest(minimal, { ctx, clientKey: null });
    assert.equal(outcome.kind, "stored");
    const [row] = await listAccessRequests(ctx);
    assert.equal(row.phone, null);
    assert.equal(row.message, "Sites: 2-5");
  });

  test("invalid input returns field errors and stores nothing", async () => {
    const outcome = await submitAccessRequest({ ...VALID, email: "not-an-email", sites: "lots", clinicName: " " }, { ctx, clientKey: "k1" });
    assert.equal(outcome.kind, "invalid");
    if (outcome.kind !== "invalid") return;
    assert.deepEqual(Object.keys(outcome.fieldErrors).sort(), ["clinicName", "email", "sites"]);
    assert.equal((await listAccessRequests(ctx)).length, 0);
    for (const raw of [null, "text", 42, [], {}]) {
      assert.equal((await submitAccessRequest(raw, { ctx, clientKey: "k1" })).kind, "invalid");
    }
    const tooLong = await submitAccessRequest({ ...VALID, message: "x".repeat(2001) }, { ctx, clientKey: "k1" });
    assert.equal(tooLong.kind, "invalid");
    const badPhone = await submitAccessRequest({ ...VALID, phone: "call me <script>" }, { ctx, clientKey: "k1" });
    assert.equal(badPhone.kind, "invalid");
  });

  test("a filled honeypot is accepted quietly and dropped, even with other errors", async () => {
    assert.equal((await submitAccessRequest({ ...VALID, website: "https://spam.example" }, { ctx, clientKey: "k1" })).kind, "spam");
    assert.equal((await submitAccessRequest({ website: "spam" }, { ctx, clientKey: "k1" })).kind, "spam");
    assert.equal((await listAccessRequests(ctx)).length, 0);
  });

  test("more than 5 requests per client per hour are refused with Retry-After", async () => {
    for (let i = 0; i < 5; i++) assert.equal((await submitAccessRequest(VALID, { ctx, clientKey: "same" })).kind, "stored");
    const sixth = await submitAccessRequest(VALID, { ctx, clientKey: "same" });
    assert.equal(sixth.kind, "rate_limited");
    if (sixth.kind === "rate_limited") assert.equal(sixth.retryAfterSeconds, 45 * 60);
    assert.equal((await submitAccessRequest(VALID, { ctx, clientKey: "other" })).kind, "stored");
    assert.equal((await listAccessRequests(ctx)).length, 6);
  });

  test("the notification gets the details; a failed send still stores the request", async () => {
    const sent: NotificationPayload[] = [];
    const ok = await submitAccessRequest(VALID, { ctx, clientKey: "k1", notify: async (r) => void sent.push(r) });
    assert.equal(ok.kind, "stored");
    assert.equal(ok.notified, true);
    assert.equal(sent[0].sites, "2-5");
    assert.equal(sent[0].message, "Mostly insurer forms.");
    const failed = await submitAccessRequest(VALID, {
      ctx,
      clientKey: "k2",
      notify: async () => {
        throw new Error("provider down");
      },
    });
    assert.equal(failed.kind, "stored");
    assert.equal(failed.notified, false);
    assert.equal((await listAccessRequests(ctx)).length, 2);
  });
});

describe("helpers", () => {
  test("storedMessage puts the number of sites first", () => {
    assert.equal(storedMessage("11+", ""), "Sites: 11+");
    assert.equal(storedMessage("1", "Hello"), "Sites: 1\n\nHello");
  });

  test("the client IP comes from the platform headers and is never stored in clear", () => {
    assert.equal(clientIpFrom(new Headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" })), "203.0.113.7");
    assert.equal(clientIpFrom(new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" })), "198.51.100.1");
    assert.equal(clientIpFrom(new Headers()), null);
    const a = hashClientIp("203.0.113.7", "a-long-enough-server-secret");
    assert.match(a, /^[0-9a-f]{32}$/);
    assert.ok(!a.includes("203"));
    assert.notEqual(a, hashClientIp("203.0.113.7", "another-long-server-secret"));
    assert.equal(a, hashClientIp("203.0.113.7", "a-long-enough-server-secret"));
  });

  test("the notification email escapes everything the visitor typed", () => {
    const email = accessRequestEmail({
      id: "ar_1",
      clinicName: 'Evil <img src=x onerror="alert(1)"> Clinic\r\nBcc: x@y.z',
      contactName: "A & B",
      email: "a@b.example",
      phone: null,
      sites: "1",
      message: "<script>alert(1)</script>",
      createdAt: NOW.toISOString(),
    });
    assert.ok(!email.html.includes("<script>"));
    assert.ok(!email.html.includes("<img"));
    assert.ok(email.html.includes("&lt;script&gt;"));
    assert.ok(!/[\r\n]/.test(email.subject), "subject is one line");
    assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#039;");
  });

  test("email is off unless both the key and the sender are set", () => {
    assert.equal(mailerSendSettingsFromEnv({}), null);
    assert.equal(mailerSendSettingsFromEnv({ MAILERSEND_API_KEY: "k" }), null);
    assert.equal(mailerSendSettingsFromEnv({ MAILERSEND_FROM_EMAIL: "noreply@example.com" }), null);
    assert.deepEqual(mailerSendSettingsFromEnv({ MAILERSEND_API_KEY: "k", MAILERSEND_FROM_EMAIL: "noreply@example.com" }), {
      apiKey: "k",
      fromEmail: "noreply@example.com",
      to: "khuram@appstackx.co.uk",
    });
  });
});

describe("POST /api/access-requests", () => {
  const ENV_KEYS = ["CLINFORMS_DB", "CLINFORMS_SQLITE_PATH", "MAILERSEND_API_KEY", "MAILERSEND_FROM_EMAIL", "VERCEL"] as const;
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.CLINFORMS_DB = "sqlite";
    process.env.CLINFORMS_SQLITE_PATH = ":memory:";
    delete process.env.MAILERSEND_API_KEY;
    delete process.env.MAILERSEND_FROM_EMAIL;
    delete process.env.VERCEL;
    const { closeDb } = await import("../db");
    await closeDb();
  });
  afterEach(async () => {
    const { closeDb } = await import("../db");
    await closeDb();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request("http://localhost:3000/api/access-requests", {
      method: "POST",
      headers: { host: "localhost:3000", "content-type": "application/json", origin: "http://localhost:3000", "x-real-ip": "203.0.113.9", ...headers },
      body,
    });

  test("stores a request and answers 201", async () => {
    const { POST } = await import("@/app/api/access-requests/route");
    const res = await POST(post(JSON.stringify(VALID)));
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  test("rejects cross-site posts, wrong content types, bad JSON, oversize bodies and invalid fields", async () => {
    const { POST } = await import("@/app/api/access-requests/route");
    assert.equal((await POST(post(JSON.stringify(VALID), { origin: "https://evil.example" }))).status, 403);
    assert.equal((await POST(post(JSON.stringify(VALID), { "content-type": "text/plain" }))).status, 415);
    assert.equal((await POST(post("{not json"))).status, 400);
    assert.equal((await POST(post(JSON.stringify({ ...VALID, message: "x".repeat(20_000) })))).status, 413);
    const invalid = await POST(post(JSON.stringify({ ...VALID, email: "nope" })));
    assert.equal(invalid.status, 422);
    const body = (await invalid.json()) as { fieldErrors: Record<string, string> };
    assert.ok(body.fieldErrors.email);
  });

  test("answers 429 with Retry-After after 5 requests from one address", async () => {
    const { POST } = await import("@/app/api/access-requests/route");
    for (let i = 0; i < 5; i++) assert.equal((await POST(post(JSON.stringify(VALID)))).status, 201);
    const limited = await POST(post(JSON.stringify(VALID)));
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
  });

  test("answers 503 (not 500) when the database is not configured", async () => {
    process.env.VERCEL = "1";
    delete process.env.CLINFORMS_DB;
    const { POST } = await import("@/app/api/access-requests/route");
    const res = await POST(post(JSON.stringify(VALID)));
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /khuram@appstackx\.co\.uk/);
  });
});
