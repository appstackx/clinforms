/**
 * TESTS ONLY (xe06): the Xero sync end to end against the fake Xero (./fake-xero.ts) on a real migrated database –
 * the clinic's switch, connect (OAuth state: wrong, other session, expired, replayed; GBP only; one organisation),
 * tokens encrypted at rest and bound to the clinic, refresh-token rotation (single-use, one refresh at a time,
 * invalid_grant → paused), mappings, the send list (invoice + contact + payment, credit note + allocation, payment
 * removal), idempotency (links, a lost answer found by number, re-runs send nothing twice), 429 / 5xx back-off to
 * "failed", validation → blocked → Retry, Skip, 403 → paused, tenant isolation, the drain endpoint, offboarding by
 * cascade and the tenant-scope guard. Run on node:sqlite and PGlite (../xero.test.ts) and on D1 through the gateway
 * (workers/data-gateway/test/pms-xero-stack.test.ts).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import type { Database } from "../../../../db/schema";
import { runBatch } from "../../../../db/batch";
import { testCipher } from "../../../../db/testing/databases";
import { listAudit } from "../../../../repos/audit";
import type { RepoContext } from "../../../../repos/context";
import { createService, createSite } from "../../../../repos/pms/directory";
import { createPatient } from "../../../../repos/pms/patients";
import { createDraftInvoice, issueInvoice, recordPayment, reversePayment, voidInvoice } from "../../../../repos/pms/billing";
import {
  claimTokenRefresh,
  getXeroConnection,
  listSyncItems,
  openConnection,
  retryItem,
  setXeroEnabled,
  setXeroMapping,
  setXeroOptions,
  skipItem,
  syncCounts,
} from "../../../../repos/pms/integration/xero";
import { unscopedStatements, type QueryLog } from "../../../../repos/pms/testing/guarded-db";
import { countPmsRows, deletePmsQueries, exportPmsData } from "../../../offboard";
import { XeroClient } from "../client";
import { disconnectXeroAndRevoke, finishXeroConnect, startXeroConnect } from "../connect";
import { handleXeroDrain } from "../drain";
import { sendForClinic } from "../sync";
import { FakeXero, defaultOrg, type FakeOrg } from "./fake-xero";

export interface XeroSuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
  log?: QueryLog;
}

const A = "riverside-a";
const B = "harbour-b";
const OWNER = { userId: "user_owner_a", sessionId: "sess_a" };
const OWNER_B = { userId: "user_owner_b", sessionId: "sess_b" };
const CRON = "cron-secret-for-tests-".padEnd(32, "x");

export function defineXeroSuite(label: string, factory: () => Promise<XeroSuiteDb>): void {
  describe(`Xero sync on ${label}`, () => {
    let suite: XeroSuiteDb;
    let ctx: RepoContext;
    // Thursday 12 November 2026, 10:00 UTC.
    let clock = Date.parse("2026-11-12T10:00:00.000Z");
    const cipher = testCipher();
    let xero: FakeXero;
    let client: XeroClient;
    let orgA: FakeOrg;
    let orgB: FakeOrg;
    const id: Record<string, string> = {};
    const tick = (seconds: number) => {
      clock += seconds * 1000;
    };

    async function connect(tenantId: string, actor: typeof OWNER, orgIds: string[], tamper: (p: URLSearchParams) => void = () => undefined) {
      const url = await startXeroConnect(ctx, tenantId, client, actor);
      assert.ok(url, "connect started");
      const state = new URL(url).searchParams.get("state") ?? "";
      const q = new URLSearchParams({ code: xero.issueCode(orgIds), state, scope: "openid" });
      tamper(q);
      return finishXeroConnect(ctx, tenantId, client, actor, q);
    }

    async function issued(tenantId: string, actor: typeof OWNER, patientId: string, serviceId: string, pence: number): Promise<string> {
      const d = await createDraftInvoice(ctx, tenantId, { patientId, lines: [{ serviceId, serviceOn: "2026-11-10", unitPricePence: pence }] }, actor);
      const r = await issueInvoice(ctx, tenantId, d.invoice.id, d.invoice.rev, {}, actor);
      assert.ok(r.ok, JSON.stringify(r));
      return d.invoice.id;
    }

    const items = (tenantId = A) => listSyncItems(ctx, tenantId, { limit: 200 });
    const statusOf = async (itemId: string, tenantId = A) => (await items(tenantId)).find((i) => i.id === itemId);

    before(async () => {
      suite = await factory();
      ctx = { db: suite.db, cipher, now: () => new Date(clock) };
      xero = new FakeXero();
      xero.now = () => clock;
      client = new XeroClient(xero.app, { fetch: xero.fetch, urls: xero.urls, sleep: async () => undefined, inlineRetries: 0 });
      orgA = xero.addOrg(defaultOrg("Riverside Physio Ltd (fictional)"));
      orgB = xero.addOrg(defaultOrg("Harbour Clinic Ltd (fictional)"));
      id.site = (await createSite(ctx, A, { name: "Bletchley (fictional)", code: "BLE" }, OWNER)).id;
      id.svc = (await createService(ctx, A, { name: "Initial assessment", code: "IA", category: "initial", durationMinutes: 45, defaultPricePence: 7000 }, OWNER)).id;
      id.megan = (await createPatient(ctx, A, { firstName: "Megan", lastName: "Hart", dateOfBirth: "1991-11-22", email: "megan.hart@example.com", address: ["14 Willow Bank (fictional)"], postcode: "MK3 9ZZ" }, OWNER)).id;
      id.svcB = (await createService(ctx, B, { name: "Follow-up", durationMinutes: 30 }, OWNER_B)).id;
      id.patB = (await createPatient(ctx, B, { firstName: "Other", lastName: "Clinic" }, OWNER_B)).id;
    });

    after(async () => {
      if (suite.log) {
        const bad = unscopedStatements(suite.log.statements);
        assert.deepEqual(bad, [], "every clinic-system statement names tenant_id");
      }
      await suite.close();
    });

    it("is off by default: no connection row, nothing to send, the drain answers 404 while the switch is off", async () => {
      assert.equal((await getXeroConnection(ctx, A)).enabled, false);
      assert.equal(await openConnection(ctx, A), null);
      const r = await sendForClinic(ctx, A, client);
      assert.equal(r.connected, false);
      const res = await handleXeroDrain(new Request("https://clinic.example.com/api/xero/drain", { method: "POST", headers: { authorization: `Bearer ${CRON}` } }), { env: { CRON_SECRET: CRON }, ctx: () => ctx, client: () => client });
      assert.equal(res.status, 404);
      // Connect refuses while the clinic's own switch is off.
      assert.equal(await startXeroConnect(ctx, A, client, OWNER), null);
    });

    it("the clinic's switch writes its rows in one batch and is audited", async () => {
      await setXeroEnabled(ctx, A, true, OWNER);
      const c = await getXeroConnection(ctx, A);
      assert.deepEqual([c.enabled, c.status], [true, "not_connected"]);
      assert.ok((await listAudit(ctx, A, { limit: 50 })).some((e) => e.action === "pms.xero.settings"));
    });

    it("OAuth state: only the same clinic, member and session, before it expires, once", async () => {
      // A forged state, another session, another member, an expired one and a replay are all refused.
      assert.deepEqual(await connect(A, OWNER, [orgA.tenantId], (q) => q.set("state", "forged-state-value")), { ok: false, error: "state" });
      const url = await startXeroConnect(ctx, A, client, OWNER);
      const state = new URL(String(url)).searchParams.get("state") ?? "";
      assert.ok(state.length >= 40, "256 random bits");
      assert.equal(new URL(String(url)).searchParams.get("client_id"), xero.app.clientId);
      assert.equal(new URL(String(url)).searchParams.get("redirect_uri"), xero.app.redirectUri);
      assert.match(new URL(String(url)).searchParams.get("scope") ?? "", /accounting\.invoices/);
      const raw = await ctx.db.selectFrom("pms_xero_connections").select(["state_hash"]).where("tenant_id", "=", A).executeTakeFirstOrThrow();
      assert.ok(raw.state_hash && raw.state_hash !== state, "only the hash is stored");
      assert.deepEqual(await finishXeroConnect(ctx, A, client, { ...OWNER, sessionId: "sess_other" }, new URLSearchParams({ state, code: "x" })), { ok: false, error: "state" });
      assert.deepEqual(await finishXeroConnect(ctx, A, client, { userId: "user_admin_x", sessionId: "sess_a" }, new URLSearchParams({ state, code: "x" })), { ok: false, error: "state" });
      // Clinic B cannot finish A's attempt.
      await setXeroEnabled(ctx, B, true, OWNER_B);
      assert.deepEqual(await finishXeroConnect(ctx, B, client, OWNER, new URLSearchParams({ state, code: "x" })), { ok: false, error: "state" });
      tick(601);
      assert.deepEqual(await finishXeroConnect(ctx, A, client, OWNER, new URLSearchParams({ state, code: xero.issueCode([orgA.tenantId]) })), { ok: false, error: "state" }, "expired");
      // Refused in Xero: state still checked (and used) first.
      const denied = await connect(A, OWNER, [orgA.tenantId], (q) => {
        q.delete("code");
        q.set("error", "access_denied");
      });
      assert.deepEqual(denied, { ok: false, error: "denied" });
      assert.equal((await getXeroConnection(ctx, A)).status, "not_connected");
    });

    it("only one GBP organisation: two organisations or another currency are refused (and disconnected at Xero)", async () => {
      const eur = xero.addOrg(defaultOrg("Euro Clinic (fictional)", "EUR"));
      assert.deepEqual(await connect(A, OWNER, [eur.tenantId]), { ok: false, error: "currency" });
      assert.ok(!Array.from(xero.connections.values()).some((c) => c.tenantId === eur.tenantId), "its connection was removed in Xero");
      assert.deepEqual(await connect(A, OWNER, [orgA.tenantId, orgB.tenantId]), { ok: false, error: "many_orgs" });
      assert.equal((await getXeroConnection(ctx, A)).status, "not_connected");
    });

    it("connects: tokens encrypted at rest, bound to the clinic, the organisation recorded, a replay refused", async () => {
      let state = "";
      const r = await connect(A, OWNER, [orgA.tenantId], (q) => {
        state = q.get("state") ?? "";
      });
      assert.deepEqual(r, { ok: true, orgName: orgA.name });
      const c = await getXeroConnection(ctx, A);
      assert.deepEqual([c.status, c.orgName, c.baseCurrency, c.sendFrom], ["connected", orgA.name, "GBP", "2026-11-12"]);
      const raw = await ctx.db.selectFrom("pms_xero_connections").selectAll().where("tenant_id", "=", A).executeTakeFirstOrThrow();
      const open = await openConnection(ctx, A);
      assert.ok(open && open.tokens.accessToken && open.tokens.refreshToken);
      assert.ok(raw.tokens_sealed && !raw.tokens_sealed.includes(open.tokens.refreshToken) && !raw.tokens_sealed.includes(open.tokens.accessToken), "sealed, not readable");
      assert.equal(raw.state_hash, null, "the state is used up");
      // A ciphertext moved to another clinic's row cannot be opened there.
      await ctx.db.updateTable("pms_xero_connections").set({ tokens_sealed: raw.tokens_sealed, status: "connected", xero_tenant_id: orgB.tenantId }).where("tenant_id", "=", B).execute();
      await assert.rejects(openConnection(ctx, B));
      await ctx.db.updateTable("pms_xero_connections").set({ tokens_sealed: null, status: "not_connected", xero_tenant_id: null }).where("tenant_id", "=", B).execute();
      assert.deepEqual(await finishXeroConnect(ctx, A, client, OWNER, new URLSearchParams({ state, code: "again" })), { ok: false, error: "state" }, "replay");
      assert.ok((await listAudit(ctx, A, { limit: 50 })).some((e) => e.action === "pms.xero.connect"));
      // Offboarding's export never holds the tokens in clear (tokens_sealed is not an _enc column).
      const exported = JSON.stringify(await exportPmsData(ctx.db, cipher, A, { tables: ["pms_xero_connections"] }));
      assert.ok(!exported.includes(open.tokens.refreshToken));
    });

    it("a missing map blocks the invoice (nothing created in Xero); after mapping, Retry sends invoice, contact and payment", async () => {
      id.inv1 = await issued(A, OWNER, id.megan, id.svc, 7000);
      const pay = await recordPayment(ctx, A, { payerKind: "patient", patientId: id.megan, receivedOn: "2026-11-12", method: "card", amountPence: 5000, reference: "Terminal 0042", allocations: [{ invoiceId: id.inv1, amountPence: 5000 }] }, OWNER);
      id.pay1 = pay.id;
      id.alloc1 = pay.allocations[0].id;
      const r1 = await sendForClinic(ctx, A, client);
      assert.equal(r1.queued, 2);
      assert.equal(r1.blocked, 1);
      assert.equal(r1.waiting, 1, "the payment waits for its invoice");
      const blocked = await statusOf(`invoice:create:${id.inv1}`);
      assert.equal(blocked?.status, "blocked");
      assert.match(blocked?.errorMessage ?? "", /default sales account/);
      assert.equal(orgA.contacts.length + orgA.invoices.length, 0, "nothing created for an invoice that cannot go");
      // Owner maps the accounts (labels as the live list names them).
      await setXeroMapping(ctx, A, { kind: "default_account", localKey: "*", xeroValue: "200" }, "200 – Sales", OWNER);
      await setXeroMapping(ctx, A, { kind: "payment_account", localKey: "card", xeroValue: "610" }, "610 – Card clearing", OWNER);
      await assert.rejects(setXeroMapping(ctx, A, { kind: "default_account", localKey: "*", xeroValue: "2;00" }, null, OWNER));
      assert.equal(await retryItem(ctx, A, `invoice:create:${id.inv1}`, OWNER), true);
      tick(61);
      const r2 = await sendForClinic(ctx, A, client);
      assert.equal(r2.done, 2, JSON.stringify(r2));
      assert.equal(orgA.invoices.length, 1);
      const x = orgA.invoices[0];
      assert.deepEqual([x.Status, x.Type, x.LineAmountTypes, x.Total, x.AmountDue], ["AUTHORISED", "ACCREC", "NoTax", 70, 20]);
      assert.match(String(x.InvoiceNumber), /^[A-Z]*\d+$/, "the clinic's own number");
      assert.match(String(orgA.contacts[0].Name), /^Megan Hart \(P\d+\)$/);
      assert.match(String(orgA.contacts[0].ContactNumber), /^CD-P\d+$/);
      assert.equal(orgA.contacts[0].EmailAddress, undefined, "no contact details unless ticked");
      assert.equal(orgA.payments.length, 1);
      assert.deepEqual([(orgA.payments[0].Account as { Code: string }).Code, orgA.payments[0].Amount, orgA.payments[0].Reference], ["610", 50, "Terminal 0042"]);
      assert.ok(!JSON.stringify(orgA.invoices).includes("description"), "no free text");
      assert.ok((await listAudit(ctx, A, { limit: 100 })).some((e) => e.action === "pms.xero.push"));
    });

    it("never twice: re-runs send nothing; a new invoice for the same patient reuses the contact", async () => {
      const calls = xero.calls.length;
      const r = await sendForClinic(ctx, A, client);
      assert.deepEqual([r.queued, r.attempted], [0, 0]);
      assert.equal(xero.count(/^PUT /), xero.calls.slice(0, calls).filter((c) => c.startsWith("PUT ")).length, "no create");
      // A retried done item is not even possible.
      assert.equal(await retryItem(ctx, A, `invoice:create:${id.inv1}`, OWNER), false);
      id.inv2 = await issued(A, OWNER, id.megan, id.svc, 5500);
      const r2 = await sendForClinic(ctx, A, client);
      assert.equal(r2.done, 1);
      assert.equal(orgA.contacts.length, 1, "contact linked, not created again");
      assert.equal(orgA.invoices.length, 2);
    });

    it("a lost answer (Xero saved it, then 503): back-off, then found by number – one invoice in Xero", async () => {
      id.inv3 = await issued(A, OWNER, id.megan, id.svc, 4000);
      xero.fail({ match: /^PUT \/api\.xro\/2\.0\/Invoices$/, status: 503, afterSave: true });
      const r = await sendForClinic(ctx, A, client);
      assert.equal(r.retrying, 1);
      const item = await statusOf(`invoice:create:${id.inv3}`);
      assert.deepEqual([item?.status, item?.errorClass, item?.attempts], ["pending", "transient", 1]);
      assert.equal(Date.parse(item?.nextAttemptAt ?? ""), clock + 60_000, "first back-off: 1 minute");
      assert.equal((await sendForClinic(ctx, A, client)).attempted, 0, "not due yet");
      tick(61);
      const before = orgA.invoices.length;
      const r2 = await sendForClinic(ctx, A, client);
      assert.equal(r2.done, 1);
      assert.equal(orgA.invoices.length, before, "found by its number, not created again");
    });

    it("429 honours Retry-After; repeated 5xx ends as failed after the last back-off; Retry and Skip are audited", async () => {
      id.inv4 = await issued(A, OWNER, id.megan, id.svc, 3000);
      xero.fail({ match: /^GET \/api\.xro\/2\.0\/Invoices\?/, status: 429, headers: { "retry-after": "900", "x-rate-limit-problem": "minute" } });
      await sendForClinic(ctx, A, client);
      const i1 = await statusOf(`invoice:create:${id.inv4}`);
      assert.equal(Date.parse(i1?.nextAttemptAt ?? ""), clock + 900_000);
      xero.fail({ match: /^GET \/api\.xro\/2\.0\/Invoices\?/, status: 500, times: 10 });
      for (let n = 0; n < 6; n++) {
        tick(43_201);
        await sendForClinic(ctx, A, client);
      }
      const i2 = await statusOf(`invoice:create:${id.inv4}`);
      assert.equal(i2?.status, "failed");
      assert.equal((await syncCounts(ctx, A)).failed, 1);
      assert.equal(await skipItem(ctx, A, `invoice:create:${id.inv4}`, OWNER), true);
      assert.equal((await statusOf(`invoice:create:${id.inv4}`))?.status, "skipped");
      const skipped = await statusOf(`invoice:create:${id.inv4}`);
      assert.equal(await retryItem(ctx, A, `invoice:create:${id.inv4}`, OWNER), true);
      assert.equal((await statusOf(`invoice:create:${id.inv4}`))?.payloadVersion, skipped?.payloadVersion, "same Idempotency-Key after a transient failure");
      xero.clearFailures();
      const r = await sendForClinic(ctx, A, client);
      assert.ok(r.done >= 1);
      const audit = await listAudit(ctx, A, { limit: 200 });
      assert.ok(audit.some((e) => e.action === "pms.xero.retry") && audit.some((e) => e.action === "pms.xero.skip"));
    });

    it("Xero's validation errors are blocked with a redacted message", async () => {
      await setXeroMapping(ctx, A, { kind: "default_account", localKey: "*", xeroValue: "999" }, "999 – Old sales", OWNER);
      id.inv5 = await issued(A, OWNER, id.megan, id.svc, 2000);
      await sendForClinic(ctx, A, client);
      const i = await statusOf(`invoice:create:${id.inv5}`);
      assert.deepEqual([i?.status, i?.errorClass], ["blocked", "validation"]);
      assert.match(i?.errorMessage ?? "", /not a valid code/);
      await setXeroMapping(ctx, A, { kind: "default_account", localKey: "*", xeroValue: "200" }, "200 – Sales", OWNER);
      await retryItem(ctx, A, `invoice:create:${id.inv5}`, OWNER);
      assert.equal((await statusOf(`invoice:create:${id.inv5}`))?.payloadVersion, 2, "a fixed block sends a new body under a new key");
      assert.equal((await sendForClinic(ctx, A, client)).done, 1);
    });

    it("credit notes go with an allocation to their invoice; a reversed payment is deleted in Xero", async () => {
      await voidInvoice(ctx, A, id.inv2, { reason: "Booked in error" }, OWNER);
      await reversePayment(ctx, A, id.pay1, { reason: "Card charged twice" }, OWNER);
      const r = await sendForClinic(ctx, A, client);
      assert.equal(r.done, 2, JSON.stringify(r));
      assert.equal(orgA.creditNotes.length, 1);
      const cn = orgA.creditNotes[0];
      assert.deepEqual([cn.Type, cn.Status, cn.Total, cn.RemainingCredit], ["ACCRECCREDIT", "AUTHORISED", 55, 0]);
      const inv2 = orgA.invoices.find((i) => i.Total === 55);
      assert.equal(inv2?.AmountDue, 0);
      assert.equal(orgA.payments[0].Status, "DELETED");
      assert.equal(orgA.invoices.find((i) => i.Total === 70)?.AmountDue, 70, "the payment came off the invoice in Xero");
      const again = await sendForClinic(ctx, A, client);
      assert.equal(again.attempted, 0);
    });

    it("refresh-token rotation: refreshed near expiry, the old refresh token dead, one refresh at a time", async () => {
      const before = await openConnection(ctx, A);
      tick(1800);
      xero.expireAccessTokens();
      id.inv6 = await issued(A, OWNER, id.megan, id.svc, 1000);
      assert.equal((await sendForClinic(ctx, A, client)).done, 1);
      const afterOpen = await openConnection(ctx, A);
      assert.ok(before && afterOpen && afterOpen.tokens.refreshToken !== before.tokens.refreshToken);
      await assert.rejects(client.refresh(before.tokens.refreshToken), /no longer accepts/);
      // Two workers with the same rev: only one may refresh.
      assert.ok(afterOpen);
      const first = await claimTokenRefresh(ctx, A, afterOpen.rev);
      const second = await claimTokenRefresh(ctx, A, afterOpen.rev);
      assert.ok(first !== null && second === null);
      tick(31);
      const conn = await openConnection(ctx, A);
      assert.ok(conn && (await claimTokenRefresh(ctx, A, conn.rev)) !== null, "a stale lock expires");
      tick(31);
    });

    it("a refused refresh (invalid_grant) or a 403 pauses the connection; items wait untouched; reconnecting carries on", async () => {
      xero.revokeAll();
      tick(1800);
      id.inv7 = await issued(A, OWNER, id.megan, id.svc, 1200);
      const r = await sendForClinic(ctx, A, client);
      assert.equal(r.paused, true);
      const c = await getXeroConnection(ctx, A);
      assert.equal(c.status, "paused");
      assert.equal((await statusOf(`invoice:create:${id.inv7}`))?.status, "pending");
      assert.ok((await listAudit(ctx, A, { limit: 200 })).some((e) => e.action === "pms.xero.paused"));
      assert.deepEqual(await connect(A, OWNER, [orgA.tenantId]), { ok: true, orgName: orgA.name });
      assert.equal((await sendForClinic(ctx, A, client)).done, 1);
      // Removed in Xero → 403 → paused.
      Array.from(xero.connections.entries()).forEach(([k, v]) => {
        if (v.tenantId === orgA.tenantId) xero.connections.delete(k);
      });
      id.inv8 = await issued(A, OWNER, id.megan, id.svc, 1300);
      assert.equal((await sendForClinic(ctx, A, client)).paused, true);
      assert.equal((await getXeroConnection(ctx, A)).status, "paused");
      // Records were sent to orgA: another organisation is refused (its ids would not match), and given back to Xero.
      const extra = xero.addOrg(defaultOrg("Another Ltd (fictional)"));
      assert.deepEqual(await connect(A, OWNER, [extra.tenantId]), { ok: false, error: "other_org" });
      assert.ok(!Array.from(xero.connections.values()).some((c) => c.tenantId === extra.tenantId));
      assert.deepEqual(await connect(A, OWNER, [orgA.tenantId]), { ok: true, orgName: orgA.name });
    });

    it("tenant isolation: each clinic sends only its own records to its own organisation", async () => {
      assert.deepEqual(await connect(B, OWNER_B, [orgB.tenantId]), { ok: true, orgName: orgB.name });
      await setXeroMapping(ctx, B, { kind: "default_account", localKey: "*", xeroValue: "200" }, "200 – Sales", OWNER_B);
      id.invB = await issued(B, OWNER_B, id.patB, id.svcB, 4500);
      const aBefore = orgA.invoices.length;
      const ra = await sendForClinic(ctx, A, client);
      assert.ok(!(await items(A)).some((i) => i.localId === id.invB), "A never queues B's invoice");
      assert.equal(orgB.invoices.length, 0, "A's run sent nothing to B's organisation");
      assert.equal(orgA.invoices.length, aBefore + ra.done);
      const rb = await sendForClinic(ctx, B, client);
      assert.equal(rb.done, 1);
      assert.equal(orgB.invoices.length, 1);
      assert.ok(!orgA.invoices.some((i) => i.Total === 45));
      // B cannot retry or skip A's items.
      assert.equal(await retryItem(ctx, B, `invoice:create:${id.inv1}`, OWNER_B), false);
      assert.equal(await skipItem(ctx, B, `invoice:create:${id.inv8}`, OWNER_B), false);
    });

    it("the drain: refuses without the cron secret; with it, sends for every connected clinic", async () => {
      const env = { CLINFORMS_XERO: "on", CRON_SECRET: CRON };
      const deps = { env, ctx: () => ctx, client: () => client, log: () => undefined };
      const no = await handleXeroDrain(new Request("https://clinic.example.com/api/xero/drain", { method: "POST" }), deps);
      assert.equal(no.status, 401);
      const wrong = await handleXeroDrain(new Request("https://clinic.example.com/api/xero/drain", { method: "POST", headers: { authorization: "Bearer nope" } }), deps);
      assert.equal(wrong.status, 401);
      assert.equal((await handleXeroDrain(new Request("https://x/api/xero/drain", { method: "POST", headers: { authorization: `Bearer ${CRON}` } }), { ...deps, env: { CLINFORMS_XERO: "on" } })).status, 503);
      await issued(B, OWNER_B, id.patB, id.svcB, 1500);
      // The only cross-clinic read (the list of connected clinic ids) – allowed for the scheduled run.
      suite.log?.pause();
      const res = await handleXeroDrain(new Request("https://clinic.example.com/api/xero/drain", { method: "POST", headers: { authorization: `Bearer ${CRON}` } }), deps);
      suite.log?.resume();
      assert.equal(res.status, 200);
      const body = (await res.json()) as { clinics: number; sent: number };
      assert.equal(body.clinics, 2);
      assert.ok(body.sent >= 1);
    });

    it("options and disconnect: tokens wiped and revoked, history kept, nothing sent while disconnected", async () => {
      await setXeroOptions(ctx, A, { sendFrom: "2026-11-01", sendContactDetails: true }, OWNER);
      assert.deepEqual([(await getXeroConnection(ctx, A)).sendFrom, (await getXeroConnection(ctx, A)).sendContactDetails], ["2026-11-01", true]);
      const open = await openConnection(ctx, A);
      assert.equal(await disconnectXeroAndRevoke(ctx, A, client, OWNER), true);
      const raw = await ctx.db.selectFrom("pms_xero_connections").select(["status", "tokens_sealed", "org_name"]).where("tenant_id", "=", A).executeTakeFirstOrThrow();
      assert.deepEqual([raw.status, raw.tokens_sealed, raw.org_name], ["disconnected", null, orgA.name]);
      await assert.rejects(client.refresh(String(open?.tokens.refreshToken)), "revoked at Xero");
      assert.ok((await items(A)).length > 0, "the send history is kept");
      await issued(A, OWNER, id.megan, id.svc, 900);
      assert.equal((await sendForClinic(ctx, A, client)).connected, false);
      assert.equal(await disconnectXeroAndRevoke(ctx, A, client, OWNER), false, "nothing to disconnect");
      assert.ok((await listAudit(ctx, A, { limit: 300 })).some((e) => e.action === "pms.xero.disconnect"));
    });

    it("offboarding: no Xero table is named in the delete batch; every Xero row goes with the clinic's billing settings", async () => {
      const counts = await countPmsRows(ctx.db, A);
      for (const t of ["pms_xero_connections", "pms_xero_mappings", "pms_xero_links", "pms_xero_sync_items"]) assert.ok((counts[t] ?? 0) > 0, t);
      const queries = deletePmsQueries(ctx.db, A, { only: Object.keys(counts) });
      const sqls = queries.map((q) => ("compile" in q ? q.compile().sql : ""));
      assert.ok(!sqls.some((s) => /pms_xero_/.test(s)), "cascade only");
      await runBatch(ctx.db, queries);
      const left = await countPmsRows(ctx.db, A);
      for (const t of ["pms_xero_connections", "pms_xero_mappings", "pms_xero_links", "pms_xero_sync_items"]) assert.equal(left[t] ?? 0, 0, t);
      assert.ok(((await countPmsRows(ctx.db, B)).pms_xero_connections ?? 0) === 1, "the other clinic keeps its connection");
    });
  });
}
