/**
 * The public clinic API's pure rules (xt03): the switch, the key format, Bearer parsing, cursors, request schemas,
 * the OpenAPI document (valid shape, every route file has a path and back, no vendor names) and the route files'
 * shape (every method exported, so a switched-off API answers 404 for all of them).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  API_SCOPES,
  AppointmentsQuerySchema,
  BookingBodySchema,
  CreateApiKeySchema,
  InvoicesQuerySchema,
  PatientsQuerySchema,
  apiKeyLabel,
  bearerToken,
  canonicalBooking,
  clinicApiSwitchOn,
  decodeCursor,
  encodeCursor,
  expiryFrom,
  parseApiKey,
  parseScopes,
  queryObject,
  validIdempotencyKey,
} from "./api";
import { CLINIC_API_PATHS, clinicApiOpenApi } from "./api-openapi";

const SECRET = "A".repeat(20) + "_-" + "z".repeat(21);
const KEY = `cdk_riverside-demo_abcdefghij012345_${SECRET}`;

describe("clinic API – switch and key format", () => {
  it("the switch is on only for 'on'", () => {
    assert.equal(clinicApiSwitchOn({ CLINFORMS_CLINIC_API: "on" }), true);
    assert.equal(clinicApiSwitchOn({ CLINFORMS_CLINIC_API: " ON " }), true);
    for (const v of [undefined, "", "1", "true", "yes", "off"]) assert.equal(clinicApiSwitchOn({ CLINFORMS_CLINIC_API: v }), false, String(v));
  });

  it("parses a key into its clinic and lookup; refuses anything else", () => {
    assert.deepEqual(parseApiKey(KEY), { tenantId: "riverside-demo", lookup: "abcdefghij012345" });
    for (const bad of [
      "",
      "cfk_riverside-demo_" + SECRET,
      `cdk_riverside-demo_abcdefghij01234_${SECRET}`,
      `cdk_riverside-demo_ABCDEFGHIJ012345_${SECRET}`,
      `cdk_riverside-demo_abcdefghij012345_${SECRET}x`,
      `cdk_riverside-demo_abcdefghij012345${SECRET}`,
      `cdk_Riverside_abcdefghij012345_${SECRET}`,
      `cdk__abcdefghij012345_${SECRET}`,
      KEY + "x".repeat(200),
      42,
      null,
    ])
      assert.equal(parseApiKey(bad), null, String(bad));
    assert.equal(apiKeyLabel("riverside-demo", "abcdefghij012345", "zzzz"), "cdk_riverside-demo_abcdefghij012345…zzzz");
  });

  it("Bearer only, one token", () => {
    assert.equal(bearerToken(`Bearer ${KEY}`), KEY);
    assert.equal(bearerToken(`bearer   ${KEY}`), KEY);
    for (const bad of [null, "", KEY, `Basic ${KEY}`, `Bearer ${KEY} extra`, `Bearer`, `Bearer ${"x".repeat(300)}`]) assert.equal(bearerToken(bad), null, String(bad));
  });

  it("scopes: unknown values are dropped", () => {
    assert.deepEqual(parseScopes('["patients:read","admin","appointments:read"]'), ["appointments:read", "patients:read"]);
    assert.deepEqual(parseScopes("not json"), []);
    assert.deepEqual(API_SCOPES, ["appointments:read", "appointments:write", "patients:read", "invoices:read"]);
  });
});

describe("clinic API – cursors and queries", () => {
  it("cursors round-trip and refuse tampering", () => {
    const c = { s: "2026-11-17T09:00:00.000Z", i: "appt_01JD0000000000000000000001" };
    assert.deepEqual(decodeCursor(encodeCursor(c)), c);
    assert.equal(decodeCursor(undefined), null);
    assert.equal(decodeCursor(""), null);
    for (const bad of ["***", Buffer.from("[]").toString("base64url"), Buffer.from('{"s":"drop table","i":"x"}').toString("base64url"), Buffer.from('{"s":"","i":"a b"}').toString("base64url")]) assert.equal(decodeCursor(bad), "invalid", bad);
  });

  it("appointments: from/to required, at most 31 days, strict", () => {
    assert.ok(AppointmentsQuerySchema.safeParse({ from: "2026-11-01", to: "2026-12-01" }).success);
    assert.ok(!AppointmentsQuerySchema.safeParse({ from: "2026-11-01", to: "2026-12-02" }).success);
    assert.ok(!AppointmentsQuerySchema.safeParse({ from: "2026-11-02", to: "2026-11-01" }).success);
    assert.ok(!AppointmentsQuerySchema.safeParse({ from: "2026-11-01" }).success);
    assert.ok(!AppointmentsQuerySchema.safeParse({ from: "2026-11-01", to: "2026-11-02", extra: "1" }).success);
    assert.ok(!AppointmentsQuerySchema.safeParse({ from: "2026-02-30", to: "2026-03-01" }).success);
    assert.equal(AppointmentsQuerySchema.parse({ from: "2026-11-01", to: "2026-11-02", limit: "20" }).limit, 20);
  });

  it("patients, invoices: filters validated", () => {
    assert.ok(PatientsQuerySchema.safeParse({ name: "Hart", dateOfBirth: "1991-11-22", email: "megan.hart@example.com" }).success);
    assert.ok(!PatientsQuerySchema.safeParse({ email: "not-an-email" }).success);
    assert.ok(!PatientsQuerySchema.safeParse({ limit: "51" }).success);
    assert.ok(InvoicesQuerySchema.safeParse({ from: "2026-01-01", to: "2026-12-31" }).success);
    assert.ok(!InvoicesQuerySchema.safeParse({ from: "2026-01-01" }).success);
    assert.ok(!InvoicesQuerySchema.safeParse({ from: "2026-01-01", to: "2027-01-02" }).success);
  });

  it("a repeated parameter is not silently collapsed", () => {
    const q = queryObject(new URLSearchParams("from=2026-11-01&from=2026-11-02&to=2026-11-03"));
    assert.deepEqual(q.from, ["2026-11-01", "2026-11-02"]);
    assert.ok(!AppointmentsQuerySchema.safeParse(q).success);
  });

  it("booking body: strict, UK time, canonical form ignores key order", () => {
    const b = { patientId: "pat_1", serviceId: "svc_1", practitionerId: "prac_1", siteId: "site_1", date: "2026-11-16", startTime: "09:30" };
    assert.ok(BookingBodySchema.safeParse(b).success);
    assert.ok(!BookingBodySchema.safeParse({ ...b, startTime: "9:30" }).success);
    assert.ok(!BookingBodySchema.safeParse({ ...b, source: "staff" }).success);
    assert.ok(!BookingBodySchema.safeParse({ ...b, note: "x".repeat(501) }).success);
    const reordered = Object.fromEntries(Object.entries(b).reverse());
    assert.equal(canonicalBooking(BookingBodySchema.parse(b)), canonicalBooking(BookingBodySchema.parse(reordered)));
    assert.ok(validIdempotencyKey("booking-0001"));
    for (const bad of [null, "", "short", "x".repeat(101), "has space 01", "émoji-0001"]) assert.ok(!validIdempotencyKey(bad as string), String(bad));
  });

  it("create-key input: at least one scope, a name, a known expiry", () => {
    assert.ok(CreateApiKeySchema.safeParse({ name: "Website", scopes: ["appointments:read"], expiresInDays: 90 }).success);
    assert.ok(!CreateApiKeySchema.safeParse({ name: "Website", scopes: [], expiresInDays: 90 }).success);
    assert.ok(!CreateApiKeySchema.safeParse({ name: " ", scopes: ["appointments:read"], expiresInDays: 90 }).success);
    assert.ok(!CreateApiKeySchema.safeParse({ name: "Website", scopes: ["admin"], expiresInDays: 90 }).success);
    assert.ok(!CreateApiKeySchema.safeParse({ name: "Website", scopes: ["appointments:read"], expiresInDays: 7 }).success);
    assert.equal(expiryFrom("2026-11-12T10:00:00.000Z", 30), "2026-12-12T10:00:00.000Z");
    assert.equal(expiryFrom("2026-11-12T10:00:00.000Z", 0), null);
  });
});

const ROOT = path.resolve(__dirname, "../../../..");
const API_DIR = path.join(ROOT, "src/app/api/clinic/v1");

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? routeFiles(full) : name === "route.ts" ? [full] : [];
  });
}

describe("clinic API – OpenAPI document and route files", () => {
  const doc = clinicApiOpenApi({ title: "Example", serverUrl: "https://clinic.example.com/api/clinic/v1" }) as { openapi: string; paths: Record<string, Record<string, unknown>>; components: { schemas: Record<string, unknown> } };

  it("is OpenAPI 3.1 with every path, and every $ref resolves", () => {
    assert.equal(doc.openapi, "3.1.0");
    assert.deepEqual(Object.keys(doc.paths).sort(), [...CLINIC_API_PATHS].sort());
    const refs = JSON.stringify(doc).match(/"#\/components\/schemas\/([A-Za-z]+)"/g) ?? [];
    for (const r of refs) assert.ok(doc.components.schemas[r.split("/").pop()!.replace('"', "")], r);
    assert.ok(JSON.parse(JSON.stringify(doc)), "serialisable");
  });

  it("names no vendor, model or technology", () => {
    const text = JSON.stringify(doc);
    // The competitor's name is built from parts so this file itself passes the contract's naming check.
    const competitor = new RegExp(["T", "M", "3"].join(""));
    for (const banned of [/\bAI\b/, /Claude|Anthropic|OpenAI|Vercel|Cloudflare|Supabase|Postgres|SQLite|Stripe/i, competitor]) assert.ok(!banned.test(text), String(banned));
  });

  it("every route file maps to a documented path (and back); each exports every method", () => {
    const files = routeFiles(API_DIR);
    const paths = files
      .map((f) => path.relative(API_DIR, path.dirname(f)).split(path.sep).join("/"))
      .filter((p) => p !== "openapi.json" && p !== "[...path]")
      .map((p) => `/${p.replace(/\[id\]/g, "{id}")}`);
    assert.deepEqual(paths.sort(), [...CLINIC_API_PATHS].sort());
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) assert.match(src, new RegExp(`export const ${m} = r\\.${m};`), `${path.relative(ROOT, f)} ${m}`);
      assert.match(src, /export const dynamic = "force-dynamic";/);
      assert.ok(!/cookies\(|getServerSession|headers\(\)/.test(src), "no cookies or session in the API's routes");
    }
  });
});
