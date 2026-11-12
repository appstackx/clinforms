/**
 * TESTS ONLY: the public clinic API v1 (0171, tracker xt03) end to end through its HTTP pipeline (serve(): switch,
 * HTTPS, rate limits, Bearer keys, the clinic's setting, scopes, JSON body) and the repositories underneath, on a
 * real migrated database. Covers: the switch off = 404 everywhere, auth failures (none, malformed, wrong secret,
 * revoked, expired, cookies ignored), the clinic's setting and package, scopes, site restriction, tenant isolation
 * (clinic A's key on clinic B's ids → 404), cursor pagination and limits, booking only into free slots with an
 * Idempotency-Key (replay, mismatch, taken slot, concurrent duplicate), rate limits per key and per network, use
 * counting (one audit row per key per day), patient reads in the patient's history, rotation, no internal fields,
 * offboarding by cascade, and the tenant-scope guard. Run on node:sqlite and PGlite (../api.test.ts) and on D1 through
 * the gateway (workers/data-gateway/test/pms-integration-api-stack.test.ts).
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Kysely } from "kysely";
import type { Database } from "../../../../db/schema";
import { runBatch } from "../../../../db/batch";
import { testCipher } from "../../../../db/testing/databases";
import { listAudit } from "../../../../repos/audit";
import type { RepoContext } from "../../../../repos/context";
import { createPractitioner, createService, createSite } from "../../../../repos/pms/directory";
import { setEntitlement } from "../../../../repos/pms/entitlements";
import { createPatient } from "../../../../repos/pms/patients";
import { bookAppointment } from "../../../../repos/pms/diary/appointments";
import { createAvailability } from "../../../../repos/pms/diary/availability";
import { listPatientHistory } from "../../../../repos/pms/records/history";
import { createApiKey, listApiKeys, revokeApiKey, rotateApiKey, setApiEnabled } from "../../../../repos/pms/integration/api-keys";
import { unscopedStatements, type QueryLog } from "../../../../repos/pms/testing/guarded-db";
import { countPmsRows, deletePmsQueries } from "../../../offboard";
import { INTEGRATION_CASCADE_DELETED_TABLES } from "../../../../db/pms-schema/integration";
import { serve, type ApiEndpoint, type ClinicApiDeps } from "../http";
import { bookAppointmentEndpoint, getAppointmentById, getInvoiceById, getPatientById, listAppointments, listInvoices, listPatients, listSlots } from "../endpoints";

export interface ApiSuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
  log?: QueryLog;
}

const A = "riverside-a";
const B = "harbour-b";
const OWNER = { userId: "user_owner_a", sessionId: "sess_a" };
const OWNER_B = { userId: "user_owner_b", sessionId: "sess_b" };
const ORIGIN = "https://clinic.example.com";

type AnyEndpoint = ApiEndpoint<Record<string, string>>;
/** The route files' table (src/app/api/clinic/v1/**), for the tests. */
const ROUTES: { re: RegExp; GET?: AnyEndpoint; POST?: AnyEndpoint }[] = [
  { re: /^\/appointments$/, GET: listAppointments, POST: bookAppointmentEndpoint },
  { re: /^\/appointments\/([^/]+)$/, GET: getAppointmentById as unknown as AnyEndpoint },
  { re: /^\/slots$/, GET: listSlots },
  { re: /^\/patients$/, GET: listPatients },
  { re: /^\/patients\/([^/]+)$/, GET: getPatientById as unknown as AnyEndpoint },
  { re: /^\/invoices$/, GET: listInvoices },
  { re: /^\/invoices\/([^/]+)$/, GET: getInvoiceById as unknown as AnyEndpoint },
];

export function defineClinicApiSuite(label: string, factory: () => Promise<ApiSuiteDb>): void {
  describe(`clinic API v1 on ${label}`, () => {
    let suite: ApiSuiteDb;
    let ctx: RepoContext;
    // Thursday 12 November 2026, 10:00 UTC.
    let clock = Date.parse("2026-11-12T10:00:00.000Z");
    let env: Record<string, string | undefined> = { CLINFORMS_CLINIC_API: "on" };
    let limits: ClinicApiDeps["limits"] = {};
    const ids: Record<string, string> = {};
    const keys: Record<string, string> = {};
    let ipSeq = 1;
    let ip = "203.0.113.1";

    const deps = (): ClinicApiDeps => ({ db: () => suite.db, cipher: testCipher, env, now: () => new Date(clock), limits });

    interface CallOptions {
      key?: string | null;
      body?: unknown;
      rawBody?: string;
      headers?: Record<string, string>;
      origin?: string;
      method?: string;
    }
    async function call(path: string, options: CallOptions = {}): Promise<{ status: number; json: Record<string, unknown>; headers: Headers }> {
      const method = options.method ?? (options.body !== undefined || options.rawBody !== undefined ? "POST" : "GET");
      const headers: Record<string, string> = { "x-forwarded-for": ip, ...(options.headers ?? {}) };
      if (options.key) headers.authorization = `Bearer ${options.key}`;
      let body: string | undefined;
      if (options.rawBody !== undefined) body = options.rawBody;
      else if (options.body !== undefined) {
        body = JSON.stringify(options.body);
        headers["content-type"] ??= "application/json";
      }
      const url = new URL(`${options.origin ?? ORIGIN}/api/clinic/v1${path}`);
      const req = new Request(url, { method, headers, body });
      const route = ROUTES.find((r) => r.re.test(url.pathname.slice("/api/clinic/v1".length)));
      const m = route?.re.exec(url.pathname.slice("/api/clinic/v1".length));
      const params: Record<string, string> = m && m[1] ? { id: decodeURIComponent(m[1]) } : {};
      const endpoint = method === "GET" ? (route?.GET ?? null) : method === "POST" ? (route?.POST ?? null) : null;
      const allowed = route ? (["GET", "POST"] as const).filter((x) => route[x]) : [];
      const res = await serve(req, params, endpoint, allowed, deps());
      const text = await res.text();
      return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {}, headers: res.headers };
    }
    const dataOf = (r: { json: Record<string, unknown> }) => r.json.data as Record<string, unknown>;
    const listOf = (r: { json: Record<string, unknown> }) => r.json.data as Record<string, unknown>[];
    const codeOf = (r: { json: Record<string, unknown> }) => (r.json.error as { code: string } | undefined)?.code;
    const nextIp = () => {
      ip = `203.0.113.${++ipSeq}`;
    };

    async function invoice(tenantId: string, id: string, siteId: string | null, patientId: string, status: "draft" | "issued", issuedOn: string | null, seq: number | null) {
      const at = new Date(clock).toISOString();
      await ctx.db
        .insertInto("pms_invoices")
        .values({
          tenant_id: tenantId,
          id,
          rev: 1,
          status,
          number_prefix: status === "issued" ? "INV-" : null,
          number_seq: seq,
          patient_id: patientId,
          case_id: null,
          bill_to: "patient",
          payer_type: "self_pay",
          payer_referrer_id: null,
          authorisation_id: null,
          related_invoice_id: null,
          issued_on: issuedOn,
          due_on: issuedOn,
          first_service_on: issuedOn,
          last_service_on: issuedOn,
          net_pence: 6000,
          vat_pence: 0,
          total_pence: 6000,
          paid_pence: 1500,
          credited_pence: 0,
          prices_include_vat: 0,
          auth_sessions: 0,
          auth_value_pence: 0,
          bill_to_enc: ctx.cipher.encrypt("Megan Hart, 1 Example Road", { tenantId, table: "pms_invoices.bill_to_enc", rowId: id }),
          diagnosis_enc: null,
          notes_enc: null,
          exported_at: null,
          edit_token: null,
          import_ref: null,
          created_by: null,
          issued_by: null,
          issued_at: status === "issued" ? at : null,
          cancelled_at: null,
          site_id: siteId,
          voided_at: null,
          per_visit_contribution_pence: null,
          created_at: at,
          updated_at: at,
        } as never)
        .execute();
    }

    before(async () => {
      suite = await factory();
      ctx = { db: suite.db, cipher: testCipher(), now: () => new Date(clock) };
      for (const [t, who] of [
        [A, OWNER],
        [B, OWNER_B],
      ] as const)
        await setEntitlement(ctx, t, "clinic", { status: "trial" }, who);
      const s1 = await createSite(ctx, A, { name: "Bletchley (fictional)", address: ["2 Station Parade (fictional)"], postcode: "MK2 9ZZ" }, OWNER);
      const s2 = await createSite(ctx, A, { name: "Wolverton (fictional)", address: ["18 Market Row (fictional)"], postcode: "MK12 9ZZ" }, OWNER);
      const sb = await createSite(ctx, B, { name: "Harbour (fictional)", address: ["1 Quay (fictional)"], postcode: "PL1 9ZZ" }, OWNER_B);
      const prac = await createPractitioner(ctx, A, { displayName: "Sarah Reid", registrationNumber: "PH-DEMO-01", defaultSiteId: s1.id, onlineBookable: true }, OWNER);
      const pracB = await createPractitioner(ctx, B, { displayName: "Tom Ellis", registrationNumber: "PH-DEMO-02", defaultSiteId: sb.id, onlineBookable: true }, OWNER_B);
      const svc = await createService(ctx, A, { name: "Follow-up", durationMinutes: 30, onlineBookable: true }, OWNER);
      const svcB = await createService(ctx, B, { name: "Follow-up", durationMinutes: 30, onlineBookable: true }, OWNER_B);
      // Mondays 09:00–12:00 at Bletchley, open to online booking.
      await createAvailability(ctx, A, { practitionerId: prac.id, siteId: s1.id, weekday: 1, startTime: "09:00", endTime: "12:00", validFrom: "2026-11-02", onlineBookable: true }, OWNER);
      await createAvailability(ctx, B, { practitionerId: pracB.id, siteId: sb.id, weekday: 1, startTime: "09:00", endTime: "12:00", validFrom: "2026-11-02", onlineBookable: true }, OWNER_B);
      const megan = await createPatient(ctx, A, { firstName: "Megan", lastName: "Hart", dateOfBirth: "1991-11-22", email: "megan.hart@example.com", phoneMobile: "07700 900123" }, OWNER);
      const daniel = await createPatient(ctx, A, { firstName: "Daniel", lastName: "Brooks", dateOfBirth: "1980-03-01", email: "daniel.brooks@example.com" }, OWNER);
      const nell = await createPatient(ctx, A, { firstName: "Nell", lastName: "Example (fictional)", dateOfBirth: "1970-01-01" }, OWNER);
      const bea = await createPatient(ctx, B, { firstName: "Bea", lastName: "Harbour (fictional)", dateOfBirth: "1985-05-05" }, OWNER_B);
      Object.assign(ids, { s1: s1.id, s2: s2.id, sb: sb.id, prac: prac.id, pracB: pracB.id, svc: svc.id, svcB: svcB.id, megan: megan.id, daniel: daniel.id, nell: nell.id, bea: bea.id });
      // Tuesday 17/11: five appointments at Bletchley (Megan), one at Wolverton (Daniel). B: one.
      for (const [i, time] of Array.from(["09:00", "09:30", "10:00", "10:30", "11:00"].entries())) {
        const r = await bookAppointment(ctx, A, { patientId: megan.id, serviceId: svc.id, practitionerId: prac.id, siteId: s1.id, date: "2026-11-17", startTime: time, notes: "Bring the parking permit (booking note)" }, OWNER);
        assert.ok(r.ok);
        ids[`a${i}`] = r.items[0].id;
      }
      const w = await bookAppointment(ctx, A, { patientId: daniel.id, serviceId: svc.id, practitionerId: prac.id, siteId: s2.id, date: "2026-11-17", startTime: "14:00" }, OWNER);
      assert.ok(w.ok);
      ids.wolverton = w.items[0].id;
      const bb = await bookAppointment(ctx, B, { patientId: bea.id, serviceId: svcB.id, practitionerId: pracB.id, siteId: sb.id, date: "2026-11-17", startTime: "09:00" }, OWNER_B);
      assert.ok(bb.ok);
      ids.apptB = bb.items[0].id;
      await invoice(A, "inv_01JD0000000000000000000001", s1.id, megan.id, "issued", "2026-11-05", 1);
      await invoice(A, "inv_01JD0000000000000000000002", s1.id, megan.id, "draft", null, null);
      await invoice(A, "inv_01JD0000000000000000000003", s2.id, daniel.id, "issued", "2026-11-06", 2);
      await invoice(A, "inv_01JD0000000000000000000004", null, nell.id, "issued", "2026-11-07", 3);
      await invoice(B, "inv_01JD0000000000000000000005", sb.id, bea.id, "issued", "2026-11-05", 1);
      Object.assign(ids, { inv1: "inv_01JD0000000000000000000001", inv2: "inv_01JD0000000000000000000002", inv3: "inv_01JD0000000000000000000003", inv4: "inv_01JD0000000000000000000004", invB: "inv_01JD0000000000000000000005" });

      await setApiEnabled(ctx, A, true, OWNER);
      await setApiEnabled(ctx, B, true, OWNER_B);
      const mk = async (name: string, tenantId: string, input: Parameters<typeof createApiKey>[2], who = OWNER) => {
        const k = await createApiKey(ctx, tenantId, input, who);
        keys[name] = k.key;
        ids[`key_${name}`] = k.id;
      };
      await mk("all", A, { name: "Website (fictional)", scopes: ["appointments:read", "appointments:write", "patients:read", "invoices:read"], siteIds: [], expiresInDays: 90 });
      await mk("apptOnly", A, { name: "Wall screen", scopes: ["appointments:read"], siteIds: [], expiresInDays: 0 });
      await mk("site1", A, { name: "Bletchley kiosk", scopes: ["appointments:read", "appointments:write", "patients:read", "invoices:read"], siteIds: [s1.id], expiresInDays: 30 });
      await mk("b", B, { name: "Harbour system", scopes: ["appointments:read", "patients:read", "invoices:read"], siteIds: [], expiresInDays: 90 }, OWNER_B);
    });

    after(async () => {
      await suite.close();
    });

    beforeEach(() => {
      // A fresh rate-limit minute and network for every test (the limit tests set their own).
      clock += 61_000;
      nextIp();
      limits = {};
      env = { CLINFORMS_CLINIC_API: "on" };
    });

    /* ---------------------------------------------------------------------------------------- */

    it("the platform switch off: every route answers 404, even with a valid key (and OPTIONS)", async () => {
      env = {};
      for (const p of ["/appointments?from=2026-11-17&to=2026-11-17", `/patients/${ids.megan}`, "/invoices", "/slots"]) {
        const r = await call(p, { key: keys.all });
        assert.equal(r.status, 404, p);
        assert.equal(codeOf(r), "NOT_FOUND");
      }
      assert.equal((await call("/appointments", { key: keys.all, method: "OPTIONS" })).status, 404);
      assert.equal((await call("/appointments", { key: keys.all, method: "DELETE" })).status, 404);
      env = { CLINFORMS_CLINIC_API: "off" };
      assert.equal((await call("/invoices", { key: keys.all })).status, 404);
    });

    it("switch on: an unknown method answers 405 without CORS headers; OPTIONS too", async () => {
      const r = await call("/appointments", { key: keys.all, method: "OPTIONS", headers: { origin: "https://evil.example.com", "access-control-request-method": "GET" } });
      assert.equal(r.status, 405);
      assert.equal(r.headers.get("access-control-allow-origin"), null);
      assert.equal(codeOf(await call("/invoices", { key: keys.all, method: "PUT" })), "METHOD_NOT_ALLOWED");
    });

    it("auth: no key, a malformed key, a wrong secret, a key in a cookie – all 401 with the same body", async () => {
      const bodies = [];
      for (const key of [null, "nonsense", keys.all.slice(0, -2) + (keys.all.endsWith("AA") ? "BB" : "AA"), `cdk_${B}_${keys.all.split("_")[2]}_${keys.all.slice(-43)}`]) {
        const r = await call("/invoices", { key });
        assert.equal(r.status, 401, String(key));
        assert.equal(codeOf(r), "UNAUTHENTICATED");
        assert.match(r.headers.get("www-authenticate") ?? "", /^Bearer/);
        bodies.push(JSON.stringify(r.json));
      }
      assert.equal(new Set(bodies).size, 1, "one answer for every failure");
      const cookie = await call("/invoices", { headers: { cookie: `clinforms.session_token=abc; api_key=${keys.all}` } });
      assert.equal(cookie.status, 401, "cookies are never read");
      const basic = await call("/invoices", { headers: { authorization: `Basic ${Buffer.from(`x:${keys.all}`).toString("base64")}` } });
      assert.equal(basic.status, 401, "Bearer only");
      const ok = await call("/invoices", { key: keys.all });
      assert.equal(ok.status, 200);
      assert.equal(ok.headers.get("set-cookie"), null, "never sets a cookie");
      assert.equal(ok.headers.get("cache-control"), "no-store");
    });

    it("HTTPS only: plain HTTP to a public host is refused, localhost is allowed", async () => {
      assert.equal(codeOf(await call("/invoices", { key: keys.all, origin: "http://clinic.example.com" })), "HTTPS_REQUIRED");
      assert.equal(codeOf(await call("/invoices", { key: keys.all, headers: { "x-forwarded-proto": "http" } })), "HTTPS_REQUIRED");
      assert.equal((await call("/invoices", { key: keys.all, origin: "http://localhost:3190" })).status, 200);
    });

    it("the clinic's own setting off, or the clinic package off: 403 API_OFF", async () => {
      await setApiEnabled(ctx, A, false, OWNER);
      assert.equal(codeOf(await call("/invoices", { key: keys.all })), "API_OFF");
      await setApiEnabled(ctx, A, true, OWNER);
      assert.equal((await call("/invoices", { key: keys.all })).status, 200);
      await setEntitlement(ctx, B, "clinic", { status: "paused" }, OWNER_B);
      assert.equal(codeOf(await call("/invoices", { key: keys.b })), "API_OFF");
      await setEntitlement(ctx, B, "clinic", { status: "trial" }, OWNER_B);
      assert.equal((await call("/invoices", { key: keys.b })).status, 200);
    });

    it("scopes: a key without the scope gets 403 INSUFFICIENT_SCOPE", async () => {
      assert.equal((await call("/appointments?from=2026-11-17&to=2026-11-17", { key: keys.apptOnly })).status, 200);
      for (const p of ["/patients", `/patients/${ids.megan}`, "/invoices", `/invoices/${ids.inv1}`, `/slots?siteId=${ids.s1}&serviceId=${ids.svc}&from=2026-11-16`]) {
        const r = await call(p, { key: keys.apptOnly });
        assert.equal(r.status, 403, p);
        assert.equal(codeOf(r), "INSUFFICIENT_SCOPE");
      }
      const book = await call("/appointments", { key: keys.b, headers: { "idempotency-key": "scope-check-0001" }, body: {} });
      assert.equal(codeOf(book), "INSUFFICIENT_SCOPE");
    });

    it("appointments: date range, filters, ISO dates, no notes or internal fields", async () => {
      const r = await call("/appointments?from=2026-11-17&to=2026-11-17", { key: keys.all });
      assert.equal(r.status, 200);
      const rows = listOf(r);
      assert.equal(rows.length, 6);
      assert.equal(r.json.nextCursor, null);
      assert.deepEqual(
        rows.map((x) => x.id),
        [ids.a0, ids.a1, ids.a2, ids.a3, ids.a4, ids.wolverton],
      );
      assert.equal(rows[0].startsAt, "2026-11-17T09:00:00.000Z");
      assert.equal(rows[0].date, "2026-11-17");
      assert.equal(rows[0].status, "booked");
      const text = JSON.stringify(r.json);
      assert.ok(!/_enc|parking permit|notes|tenant/i.test(text), "no notes, no internal fields");
      assert.equal(listOf(await call(`/appointments?from=2026-11-17&to=2026-11-17&siteId=${ids.s2}`, { key: keys.all })).length, 1);
      assert.equal(listOf(await call(`/appointments?from=2026-11-17&to=2026-11-17&practitionerId=${ids.prac}&status=cancelled`, { key: keys.all })).length, 0);
      assert.equal(listOf(await call("/appointments?from=2026-11-18&to=2026-11-30", { key: keys.all })).length, 0);
      const one = await call(`/appointments/${ids.a2}`, { key: keys.all });
      assert.equal(one.status, 200);
      assert.equal(dataOf(one).patientId, ids.megan);
    });

    it("appointments: invalid queries are 422 (range over 31 days, to before from, unknown or repeated parameter, bad cursor)", async () => {
      for (const p of [
        "/appointments?from=2026-11-01&to=2026-12-02",
        "/appointments?from=2026-11-17&to=2026-11-16",
        "/appointments?from=2026-11-17",
        "/appointments?from=2026-11-17&to=2026-11-17&colour=red",
        "/appointments?from=2026-11-17&to=2026-11-17&from=2026-11-18",
        "/appointments?from=2026-11-17&to=2026-11-17&cursor=!!!",
        `/appointments?from=2026-11-17&to=2026-11-17&cursor=${Buffer.from('{"s":"x","i":"y z"}').toString("base64url")}`,
        "/appointments?from=2026-11-17&to=2026-11-17&limit=101",
        "/appointments?from=17/11/2026&to=2026-11-17",
      ]) {
        const r = await call(p, { key: keys.all });
        assert.equal(r.status, 422, p);
        assert.equal(codeOf(r), "INVALID_REQUEST");
      }
      assert.equal((await call("/appointments?from=2026-11-01&to=2026-12-01", { key: keys.all })).status, 200, "31 days is allowed");
    });

    it("cursor pagination: every row once, in order, then nextCursor null", async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const q: string = `/appointments?from=2026-11-17&to=2026-11-17&limit=2${cursor ? `&cursor=${cursor}` : ""}`;
        const r = await call(q, { key: keys.all });
        assert.equal(r.status, 200);
        seen.push(...listOf(r).map((x) => x.id as string));
        cursor = r.json.nextCursor as string | null;
        pages++;
      } while (cursor && pages < 10);
      assert.equal(pages, 3);
      assert.deepEqual(seen, [ids.a0, ids.a1, ids.a2, ids.a3, ids.a4, ids.wolverton]);
      // Patients by id.
      const p1 = await call("/patients?limit=2&status=any", { key: keys.all });
      assert.equal(listOf(p1).length, 2);
      const p2 = await call(`/patients?limit=2&status=any&cursor=${p1.json.nextCursor}`, { key: keys.all });
      assert.equal(listOf(p2).length, 1);
      assert.equal(p2.json.nextCursor, null);
      assert.equal(new Set([...listOf(p1), ...listOf(p2)].map((x) => x.id)).size, 3);
    });

    it("site restriction: a key for Bletchley sees only Bletchley – other sites' rows are 404 or left out, naming another site is 403", async () => {
      const r = await call("/appointments?from=2026-11-17&to=2026-11-17", { key: keys.site1 });
      assert.deepEqual(
        listOf(r).map((x) => x.siteId),
        [ids.s1, ids.s1, ids.s1, ids.s1, ids.s1],
      );
      assert.equal(codeOf(await call(`/appointments?from=2026-11-17&to=2026-11-17&siteId=${ids.s2}`, { key: keys.site1 })), "SITE_NOT_ALLOWED");
      assert.equal((await call(`/appointments/${ids.wolverton}`, { key: keys.site1 })).status, 404);
      // Patients: Megan (Bletchley) and Nell (no site yet) – never Daniel (Wolverton only).
      const pats = listOf(await call("/patients", { key: keys.site1 })).map((x) => x.id);
      assert.ok(pats.includes(ids.megan) && pats.includes(ids.nell) && !pats.includes(ids.daniel), JSON.stringify(pats));
      assert.equal((await call(`/patients/${ids.daniel}`, { key: keys.site1 })).status, 404);
      // Invoices: only Bletchley's (an invoice without a site needs every site).
      const invs = listOf(await call("/invoices", { key: keys.site1 })).map((x) => x.id);
      assert.deepEqual(invs.sort(), [ids.inv1, ids.inv2].sort());
      assert.equal((await call(`/invoices/${ids.inv3}`, { key: keys.site1 })).status, 404);
      assert.equal((await call(`/invoices/${ids.inv4}`, { key: keys.site1 })).status, 404);
      const book = await call("/appointments", {
        key: keys.site1,
        headers: { "idempotency-key": "site-check-0001" },
        body: { patientId: ids.megan, serviceId: ids.svc, practitionerId: ids.prac, siteId: ids.s2, date: "2026-11-16", startTime: "09:00" },
      });
      assert.equal(codeOf(book), "SITE_NOT_ALLOWED");
    });

    it("tenant isolation: clinic A's key on clinic B's ids answers 404 – and B's key never sees A", async () => {
      for (const p of [`/appointments/${ids.apptB}`, `/patients/${ids.bea}`, `/invoices/${ids.invB}`]) {
        const r = await call(p, { key: keys.all });
        assert.equal(r.status, 404, p);
        assert.equal(codeOf(r), "NOT_FOUND");
      }
      const b = await call("/appointments?from=2026-11-17&to=2026-11-17", { key: keys.b });
      assert.deepEqual(
        listOf(b).map((x) => x.id),
        [ids.apptB],
      );
      assert.deepEqual(
        listOf(await call("/invoices", { key: keys.b })).map((x) => x.id),
        [ids.invB],
      );
      assert.ok(!listOf(await call("/patients?status=any", { key: keys.b })).some((x) => x.id === ids.megan));
      // A's key filtered by B's site: nothing (not an error – the site is simply not A's).
      assert.equal(listOf(await call(`/appointments?from=2026-11-17&to=2026-11-17&siteId=${ids.sb}`, { key: keys.all })).length, 0);
      // Booking B's patient with A's key.
      const book = await call("/appointments", {
        key: keys.all,
        headers: { "idempotency-key": "tenant-check-0001" },
        body: { patientId: ids.bea, serviceId: ids.svc, practitionerId: ids.prac, siteId: ids.s1, date: "2026-11-16", startTime: "09:00" },
      });
      assert.equal(book.status, 404);
    });

    it("patients: search by name, date of birth and email; minimal fields; every read in the patient's history", async () => {
      const byName = listOf(await call("/patients?name=hart", { key: keys.all }));
      assert.deepEqual(
        byName.map((x) => x.id),
        [ids.megan],
      );
      assert.deepEqual(Object.keys(byName[0]).sort(), ["dateOfBirth", "firstName", "id", "lastName", "patientNumber", "preferredName", "status"]);
      assert.deepEqual(
        listOf(await call("/patients?dateOfBirth=1980-03-01", { key: keys.all })).map((x) => x.id),
        [ids.daniel],
      );
      assert.deepEqual(
        listOf(await call("/patients?email=MEGAN.HART@example.com", { key: keys.all })).map((x) => x.id),
        [ids.megan],
      );
      assert.equal(codeOf(await call("/patients?name=h", { key: keys.all })), "INVALID_REQUEST");
      const one = await call(`/patients/${ids.megan}`, { key: keys.all });
      assert.equal(dataOf(one).email, "megan.hart@example.com");
      assert.ok(!/_enc|alerts|notes|gp/i.test(JSON.stringify(one.json)), "no clinical or internal fields");
      const history = await listPatientHistory(ctx, A, ids.megan);
      const reads = history.filter((e) => e.action === "pms.api.patient_read");
      assert.ok(reads.length >= 3, `history shows the API reads (${reads.length})`);
      assert.equal(reads[0].userId, null);
      assert.equal(reads[0].detail?.apiKeyId, ids.key_all);
      assert.ok(reads.some((e) => e.detail?.kind === "record") && reads.some((e) => e.detail?.kind === "list"));
      // Daniel was not returned by the name search for Hart: no read row from it.
      const danielReads = (await listPatientHistory(ctx, A, ids.daniel)).filter((e) => e.action === "pms.api.patient_read");
      assert.ok(danielReads.every((e) => e.detail?.kind === "list"));
    });

    it("invoices: money in pence, balance, number, status and date filters, lines without descriptions", async () => {
      const all = listOf(await call("/invoices", { key: keys.all }));
      assert.equal(all.length, 4);
      const issued = listOf(await call("/invoices?status=issued&from=2026-11-05&to=2026-11-06", { key: keys.all }));
      assert.deepEqual(issued.map((x) => x.id).sort(), [ids.inv1, ids.inv3].sort());
      const one = dataOf(await call(`/invoices/${ids.inv1}`, { key: keys.all }));
      assert.equal(one.totalPence, 6000);
      assert.equal(one.balancePence, 4500);
      assert.equal(typeof one.number, "string");
      assert.deepEqual(one.lines, []);
      assert.ok(!/_enc|Example Road|diagnosis|billToText/i.test(JSON.stringify(one)), "no bill-to text, no diagnosis");
      assert.equal(listOf(await call(`/invoices?patientId=${ids.daniel}`, { key: keys.all })).length, 1);
      assert.equal(codeOf(await call("/invoices?from=2026-11-01", { key: keys.all })), "INVALID_REQUEST");
    });

    it("free slots: the diary's free online-bookable times", async () => {
      const r = await call(`/slots?siteId=${ids.s1}&serviceId=${ids.svc}&from=2026-11-16&days=1`, { key: keys.all });
      assert.equal(r.status, 200);
      const slots = listOf(r);
      assert.ok(slots.length > 0);
      assert.equal(slots[0].date, "2026-11-16");
      assert.equal(slots[0].startTime, "09:00");
      assert.equal(listOf(await call(`/slots?siteId=${ids.s2}&serviceId=${ids.svc}&from=2026-11-16&days=1`, { key: keys.all })).length, 0, "no rota at Wolverton");
      assert.equal((await call(`/slots?siteId=${ids.sb}&serviceId=${ids.svc}&from=2026-11-16`, { key: keys.all })).status, 404, "another clinic's site");
    });

    it("booking: Idempotency-Key required, JSON only, size limit, unknown fields refused", async () => {
      const body = { patientId: ids.megan, serviceId: ids.svc, practitionerId: ids.prac, siteId: ids.s1, date: "2026-11-16", startTime: "09:00" };
      assert.equal(codeOf(await call("/appointments", { key: keys.all, body })), "IDEMPOTENCY_KEY_REQUIRED");
      assert.equal(codeOf(await call("/appointments", { key: keys.all, body, headers: { "idempotency-key": "short" } })), "IDEMPOTENCY_KEY_REQUIRED");
      assert.equal(codeOf(await call("/appointments", { key: keys.all, rawBody: JSON.stringify(body), headers: { "idempotency-key": "content-type-0001", "content-type": "text/plain" } })), "UNSUPPORTED_MEDIA_TYPE");
      assert.equal(codeOf(await call("/appointments", { key: keys.all, rawBody: JSON.stringify({ ...body, note: "x".repeat(9000) }), headers: { "idempotency-key": "too-large-0001", "content-type": "application/json" } })), "PAYLOAD_TOO_LARGE");
      assert.equal(codeOf(await call("/appointments", { key: keys.all, rawBody: "{not json", headers: { "idempotency-key": "bad-json-0001", "content-type": "application/json" } })), "INVALID_REQUEST");
      assert.equal(codeOf(await call("/appointments", { key: keys.all, body: { ...body, source: "staff" }, headers: { "idempotency-key": "unknown-field-0001" } })), "INVALID_REQUEST");
      assert.equal(codeOf(await call("/appointments", { key: keys.all, body: { ...body, startTime: "9am" }, headers: { "idempotency-key": "bad-time-0001" } })), "INVALID_REQUEST");
    });

    it("booking: only into a free slot; idempotent replay; mismatch refused; the slot then taken", async () => {
      const body = { patientId: ids.nell, serviceId: ids.svc, practitionerId: ids.prac, siteId: ids.s1, date: "2026-11-16", startTime: "09:30", note: "Prefers the ground-floor room" };
      // Not free: outside the rota (Tuesday), before the rota starts (08:00), in the past.
      for (const [k, b] of [
        ["not-free-0001", { ...body, date: "2026-11-17" }],
        ["not-free-0002", { ...body, startTime: "08:00" }],
        ["not-free-0003", { ...body, startTime: "11:45" }],
        ["not-free-0004", { ...body, date: "2026-11-09" }],
      ] as const) {
        const r = await call("/appointments", { key: keys.all, body: b, headers: { "idempotency-key": k } });
        assert.equal(codeOf(r), "SLOT_NOT_FREE", k);
      }
      const first = await call("/appointments", { key: keys.all, body, headers: { "idempotency-key": "booking-nell-0001" } });
      assert.equal(first.status, 201, JSON.stringify(first.json));
      const appt = dataOf(first);
      assert.equal(appt.status, "booked");
      assert.equal(appt.source, "online");
      assert.equal(appt.startsAt, "2026-11-16T09:30:00.000Z");
      assert.equal(first.headers.get("location"), `/api/clinic/v1/appointments/${appt.id}`);
      assert.ok(!JSON.stringify(first.json).includes("ground-floor"), "the booking note is stored, never returned");
      // Replay: same key, same body → the same appointment, 200, nothing new booked.
      const again = await call("/appointments", { key: keys.all, body, headers: { "idempotency-key": "booking-nell-0001" } });
      assert.equal(again.status, 200);
      assert.equal(again.headers.get("idempotent-replayed"), "true");
      assert.equal(dataOf(again).id, appt.id);
      const rows = await ctx.db.selectFrom("pms_appointments").select("id").where("tenant_id", "=", A).where("patient_id", "=", ids.nell).execute();
      assert.equal(rows.length, 1, "booked once");
      // Same key, different body → 422.
      assert.equal(codeOf(await call("/appointments", { key: keys.all, body: { ...body, startTime: "10:00" }, headers: { "idempotency-key": "booking-nell-0001" } })), "IDEMPOTENCY_MISMATCH");
      // The slot is taken now: another key or another Idempotency-Key cannot book it.
      assert.equal(codeOf(await call("/appointments", { key: keys.all, body: { ...body, patientId: ids.megan }, headers: { "idempotency-key": "booking-megan-0001" } })), "SLOT_NOT_FREE");
      assert.equal(codeOf(await call("/appointments", { key: keys.site1, body: { ...body, patientId: ids.megan }, headers: { "idempotency-key": "booking-nell-0001" } })), "SLOT_NOT_FREE", "keys do not share Idempotency-Keys");
      const slots = listOf(await call(`/slots?siteId=${ids.s1}&serviceId=${ids.svc}&from=2026-11-16&days=1`, { key: keys.all }));
      assert.ok(!slots.some((s) => s.startTime === "09:30"), "taken time no longer offered");
      // Audit: the diary's booking row plus one naming the key, in the same batch.
      const audit = await listAudit(ctx, A, { limit: 200 });
      assert.ok(audit.some((e) => e.action === "pms.api.appointment_book" && e.targetId === appt.id && e.detail?.apiKeyId === ids.key_all));
      assert.ok(audit.some((e) => e.action === "pms.appointment.book"));
      // Archived patients cannot be booked.
      await ctx.db.updateTable("pms_patients").set({ status: "archived" }).where("tenant_id", "=", A).where("id", "=", ids.daniel).execute();
      assert.equal(codeOf(await call("/appointments", { key: keys.all, body: { ...body, patientId: ids.daniel, startTime: "11:00" }, headers: { "idempotency-key": "archived-0001" } })), "INVALID_REQUEST");
      await ctx.db.updateTable("pms_patients").set({ status: "active" }).where("tenant_id", "=", A).where("id", "=", ids.daniel).execute();
    });

    it("booking: the same Idempotency-Key sent twice at once books once", async () => {
      const body = { patientId: ids.megan, serviceId: ids.svc, practitionerId: ids.prac, siteId: ids.s1, date: "2026-11-23", startTime: "10:00" };
      const [r1, r2] = await Promise.all([
        call("/appointments", { key: keys.all, body, headers: { "idempotency-key": "concurrent-0001" } }),
        call("/appointments", { key: keys.all, body, headers: { "idempotency-key": "concurrent-0001" } }),
      ]);
      assert.deepEqual([r1.status, r2.status].sort(), [200, 201], JSON.stringify([r1.json, r2.json]));
      const ok = [r1, r2];
      const made = await ctx.db.selectFrom("pms_api_idempotency").select("appointment_id").where("tenant_id", "=", A).where("idem_key", "=", "concurrent-0001").execute();
      assert.equal(made.length, 1);
      const booked = await ctx.db.selectFrom("pms_appointments").select("id").where("tenant_id", "=", A).where("starts_on", "=", "2026-11-23").where("status", "=", "booked").execute();
      assert.equal(booked.length, 1, "one appointment");
      for (const r of ok) assert.equal(dataOf(r).id, made[0].appointment_id);
    });

    it("rate limits: per key per minute and per network per minute answer 429 with Retry-After", async () => {
      limits = { perKeyPerMinute: 3, perIpPerMinute: 1000 };
      for (let i = 0; i < 3; i++) assert.equal((await call("/appointments?from=2026-11-17&to=2026-11-17", { key: keys.apptOnly })).status, 200);
      const over = await call("/appointments?from=2026-11-17&to=2026-11-17", { key: keys.apptOnly });
      assert.equal(over.status, 429);
      assert.equal(codeOf(over), "RATE_LIMITED");
      assert.ok(Number(over.headers.get("retry-after")) >= 1);
      assert.equal((await call("/invoices", { key: keys.all })).status, 200, "another key is not limited");
      clock += 61_000;
      assert.equal((await call("/appointments?from=2026-11-17&to=2026-11-17", { key: keys.apptOnly })).status, 200, "a new minute");
      limits = { perIpPerMinute: 2 };
      nextIp();
      await call("/invoices", { key: keys.all });
      await call("/invoices", { key: keys.all });
      assert.equal(codeOf(await call("/invoices", { key: keys.all })), "RATE_LIMITED");
      nextIp();
      assert.equal((await call("/invoices", { key: keys.all })).status, 200, "another network");
    });

    it("rate limits: repeated wrong keys from one network block it for a while – even a right key", async () => {
      limits = { failedPerIpPer10Minutes: 3 };
      for (let i = 0; i < 3; i++) assert.equal((await call("/invoices", { key: `cdk_${A}_aaaaaaaaaaaaaaaa_${"x".repeat(43)}` })).status, 401);
      const blocked = await call("/invoices", { key: keys.all });
      assert.equal(blocked.status, 429);
      nextIp();
      assert.equal((await call("/invoices", { key: keys.all })).status, 200);
    });

    it("use is counted: last_used_at, use_count, calls per day – ONE audit row per key per day", async () => {
      const before = (await listApiKeys(ctx, A)).find((k) => k.id === ids.key_apptOnly);
      await call("/appointments?from=2026-11-17&to=2026-11-17", { key: keys.apptOnly });
      await call("/appointments?from=2026-11-17&to=2026-11-17", { key: keys.apptOnly });
      const afterKey = (await listApiKeys(ctx, A)).find((k) => k.id === ids.key_apptOnly);
      assert.equal(afterKey!.useCount, (before?.useCount ?? 0) + 2);
      assert.equal(afterKey!.lastUsedAt, new Date(clock).toISOString());
      const uses = (await listAudit(ctx, A, { limit: 500 })).filter((e) => e.action === "pms.api_key.use" && e.targetId === ids.key_apptOnly);
      assert.equal(uses.length, 1, "first call of the day only");
      const day = await ctx.db.selectFrom("pms_api_key_days").select(["calls"]).where("tenant_id", "=", A).where("key_id", "=", ids.key_apptOnly).where("day", "=", "2026-11-12").executeTakeFirstOrThrow();
      assert.ok(Number(day.calls) >= afterKey!.useCount - (before?.useCount ?? 0));
      const reads = await ctx.db.selectFrom("pms_api_key_days").select(["patient_reads"]).where("tenant_id", "=", A).where("key_id", "=", ids.key_all).where("day", "=", "2026-11-12").executeTakeFirstOrThrow();
      assert.ok(Number(reads.patient_reads) > 0, "patient reads counted");
    });

    it("revoke and expiry: a revoked key and an expired key get 401", async () => {
      const k = await createApiKey(ctx, A, { name: "Short lived", scopes: ["invoices:read"], siteIds: [], expiresInDays: 30 }, OWNER);
      assert.equal((await call("/invoices", { key: k.key })).status, 200);
      const saved = clock;
      clock += 31 * 86_400_000;
      assert.equal((await call("/invoices", { key: k.key })).status, 401, "expired");
      clock = saved + 62_000;
      assert.equal(await revokeApiKey(ctx, A, k.id, OWNER), true);
      assert.equal(await revokeApiKey(ctx, A, k.id, OWNER), false, "once");
      assert.equal((await call("/invoices", { key: k.key })).status, 401, "revoked");
      assert.equal(await revokeApiKey(ctx, B, ids.key_all, OWNER_B), false, "another clinic cannot revoke it");
    });

    it("rotation: the new key works at once, the old one for 24 hours, a key is replaced only once", async () => {
      const old = await createApiKey(ctx, A, { name: "Rotating", scopes: ["invoices:read"], siteIds: [ids.s1], expiresInDays: 90 }, OWNER);
      const fresh = await rotateApiKey(ctx, A, old.id, OWNER);
      assert.ok(fresh);
      assert.equal(await rotateApiKey(ctx, A, old.id, OWNER), null, "already replaced");
      assert.equal(await rotateApiKey(ctx, B, fresh.id, OWNER_B), null, "another clinic cannot rotate it");
      assert.deepEqual(fresh.siteIds, [ids.s1]);
      assert.deepEqual(fresh.scopes, ["invoices:read"]);
      assert.equal((await call("/invoices", { key: fresh.key })).status, 200);
      assert.equal((await call("/invoices", { key: old.key })).status, 200, "grace period");
      const saved = clock;
      clock += 25 * 3_600_000;
      assert.equal((await call("/invoices", { key: old.key })).status, 401, "after the grace period");
      assert.equal((await call("/invoices", { key: fresh.key })).status, 200);
      clock = saved + 62_000;
      const audit = await listAudit(ctx, A, { limit: 500 });
      assert.ok(audit.some((e) => e.action === "pms.api_key.rotate" && e.targetId === old.id && e.detail?.newKeyId === fresh.id));
      assert.ok(audit.some((e) => e.action === "pms.api_key.create" && e.targetId === old.id));
    });

    it("keys are stored as SHA-256 only, with lookup and last4", async () => {
      const rows = await ctx.db.selectFrom("pms_api_keys").selectAll().where("tenant_id", "=", A).execute();
      const raw = JSON.stringify(rows);
      for (const k of [keys.all, keys.site1, keys.apptOnly]) assert.ok(!raw.includes(k) && !raw.includes(k.slice(-43)), "no key or secret stored");
      for (const r of rows) assert.match(r.key_hash, /^[0-9a-f]{64}$/);
    });

    it("offboarding: only pms_api_settings is named; keys, day counters and idempotency rows go by cascade", async () => {
      const before = await countPmsRows(ctx.db, B);
      assert.ok((before.pms_api_keys ?? 0) >= 1 && (before.pms_api_key_days ?? 0) >= 1, JSON.stringify(before));
      const queries = deletePmsQueries(ctx.db, B, { only: Object.keys(before) });
      const named = queries.map((q) => ("compile" in q && typeof q.compile === "function" ? q.compile().sql : ""));
      for (const t of INTEGRATION_CASCADE_DELETED_TABLES) assert.ok(!named.some((s) => s.includes(`"${t}"`)), `${t} is not named`);
      assert.ok(named.some((s) => s.includes('"pms_api_settings"')));
      await runBatch(ctx.db, queries);
      assert.deepEqual(await countPmsRows(ctx.db, B), {});
      assert.ok(((await countPmsRows(ctx.db, A)).pms_api_keys ?? 0) >= 3, "clinic A untouched");
      assert.equal((await call("/invoices", { key: keys.b })).status, 401, "B's key is gone");
    });

    it("tenant scope: every statement names tenant_id", () => {
      if (!suite.log) return;
      assert.deepEqual(unscopedStatements(suite.log.statements), []);
    });
  });
}
