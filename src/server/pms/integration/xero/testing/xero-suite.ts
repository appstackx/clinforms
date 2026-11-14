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
import { paymentMarker } from "../../../../../modules/pms/integration/xero-mappers";
import { createPatient } from "../../../../repos/pms/patients";
import { createCreditNote, createDraftInvoice, getInvoice, issueInvoice, recordPayment, reversePayment, voidInvoice } from "../../../../repos/pms/billing";
import {
  claimItem,
  claimTokenRefresh,
  clinicsToSend,
  finishItem,
  markClinicRun,
  storeRefreshedTokens,
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
import { mayManageXero } from "../screen";
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

    async function connect(tenantId: string, actor: typeof OWNER, orgIds: string[], tamper: (p: URLSearchParams) => void = () => undefined, user = `xero-user-of-${tenantId}`) {
      const url = await startXeroConnect(ctx, tenantId, client, actor);
      assert.ok(url, "connect started");
      const state = new URL(url).searchParams.get("state") ?? "";
      const q = new URLSearchParams({ code: xero.issueCode(orgIds, user), state, scope: "openid" });
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
        // The one allowed cross-clinic read inside a clinic's own flow: "is this Xero organisation connected to ANOTHER
        // clinic?" (xeroOrgInUseElsewhere, review item 2) – a yes/no, it returns no other clinic's data.
        const P = String.raw`(?:\?|\$\d+)`;
        const orgInUse = new RegExp(`^select "status" from "pms_xero_connections" where "xero_tenant_id" = ${P} and "tenant_id" <> ${P} and "status" in \\(${P}, ${P}\\) limit ${P}$`);
        const bad = unscopedStatements(suite.log.statements.filter((q) => !orgInUse.test(q)));
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
      assert.deepEqual(await finishXeroConnect(ctx, A, client, OWNER, new URLSearchParams({ state, code: xero.issueCode([orgA.tenantId], `xero-user-of-${A}`) })), { ok: false, error: "state" }, "expired");
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
      assert.equal(x.InvoiceNumber, (await getInvoice(ctx, A, id.inv1))?.number, "the clinic's own number, exactly as printed");
      assert.match(String(orgA.contacts[0].Name), /^Megan Hart \(P\d+\)$/);
      assert.match(String(orgA.contacts[0].ContactNumber), /^CD-P\d+$/);
      assert.equal(orgA.contacts[0].EmailAddress, undefined, "no contact details unless ticked");
      assert.equal(orgA.payments.length, 1);
      assert.deepEqual([(orgA.payments[0].Account as { Code: string }).Code, orgA.payments[0].Amount, orgA.payments[0].Reference], ["610", 50, `Terminal 0042 ${paymentMarker(id.alloc1)}`]);
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
      assert.match(i?.errorMessage ?? "", /account chosen on the Xero page/, "a fixed text, never Xero's own words");
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
      const first = await claimTokenRefresh(ctx, A, afterOpen.tokenRev);
      const second = await claimTokenRefresh(ctx, A, afterOpen.tokenRev);
      assert.ok(first !== null && second === null);
      tick(31);
      const conn = await openConnection(ctx, A);
      assert.ok(conn && (await claimTokenRefresh(ctx, A, conn.tokenRev)) !== null, "a stale lock expires");
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

    it("review 1: a credit note waits for an earlier payment on its invoice – Xero sees them in the order they happened", async () => {
      const invId = await issued(A, OWNER, id.megan, id.svc, 7000);
      const pay = await recordPayment(ctx, A, { payerKind: "patient", patientId: id.megan, receivedOn: "2026-11-12", method: "card", amountPence: 7000, allocations: [{ invoiceId: invId, amountPence: 7000 }] }, OWNER);
      tick(1);
      const full = await getInvoice(ctx, A, invId);
      const cn = await createCreditNote(ctx, A, { invoiceId: invId, lines: [{ invoiceLineId: String(full?.lines[0].id), totalPence: 2000 }], reason: "Goodwill" }, OWNER);
      const r1 = await sendForClinic(ctx, A, client);
      assert.equal(r1.blocked + r1.failed, 0, JSON.stringify(r1));
      assert.equal((await statusOf(`allocation:create:${pay.allocations[0].id}`))?.status, "done", "the payment went in full");
      const waiting = await statusOf(`credit_note:create:${cn.id}`);
      assert.equal(waiting?.status === "done" || waiting?.errorClass === "waiting", true, "the credit note went after it, or waits for it");
      tick(61);
      await sendForClinic(ctx, A, client);
      assert.equal((await statusOf(`credit_note:create:${cn.id}`))?.status, "done");
      const xInv = orgA.invoices.find((i) => i.InvoiceNumber === `${full?.number}`);
      assert.equal(xInv?.AmountPaid, 70);
      assert.equal(orgA.creditNotes.find((c) => c.CreditNoteNumber === cn.number)?.RemainingCredit, 20, "nothing left to allocate – the credit stays on the credit note");
    });

    it("review 2: a number or contact number already used in Xero by something else is never linked", async () => {
      const invId = await issued(A, OWNER, id.megan, id.svc, 6100);
      const number = String((await getInvoice(ctx, A, invId))?.number);
      orgA.invoices.push({ InvoiceID: "99999999-0000-0000-0000-000000000001", InvoiceNumber: number, Type: "ACCPAY", Status: "AUTHORISED", Total: 1, AmountDue: 1, Contact: { ContactID: "someone-else" }, Payments: [] });
      await sendForClinic(ctx, A, client);
      const i = await statusOf(`invoice:create:${invId}`);
      assert.deepEqual([i?.status, i?.errorClass], ["blocked", "validation"]);
      assert.match(i?.errorMessage ?? "", /already used by a different record/);
      orgA.invoices.pop();
      await skipItem(ctx, A, `invoice:create:${invId}`, OWNER);
      // A contact number taken by a different contact.
      const brooks = await createPatient(ctx, A, { firstName: "Daniel", lastName: "Brooks", dateOfBirth: "1980-01-19" }, OWNER);
      const pn = (await ctx.db.selectFrom("pms_patients").select("patient_number").where("tenant_id", "=", A).where("id", "=", brooks.id).executeTakeFirstOrThrow()).patient_number;
      orgA.contacts.push({ ContactID: "88888888-0000-0000-0000-000000000001", Name: "A Different Person (fictional)", ContactNumber: `CD-P${pn}`, ContactStatus: "ACTIVE" });
      const inv2 = await issued(A, OWNER, brooks.id, id.svc, 6200);
      await sendForClinic(ctx, A, client);
      const j = await statusOf(`invoice:create:${inv2}`);
      assert.equal(j?.status, "blocked");
      assert.match(j?.errorMessage ?? "", /different Xero contact already uses contact number/);
      await skipItem(ctx, A, `invoice:create:${inv2}`, OWNER);
    });

    it("review 3: a payment whose answer was lost (or unreadable) is found by its marker – never posted twice", async () => {
      const invId = await issued(A, OWNER, id.megan, id.svc, 3300);
      await sendForClinic(ctx, A, client);
      const pay = await recordPayment(ctx, A, { payerKind: "patient", patientId: id.megan, receivedOn: "2026-11-12", method: "card", amountPence: 3300, allocations: [{ invoiceId: invId, amountPence: 3300 }] }, OWNER);
      const allocId = pay.allocations[0].id;
      // 200 with no record in the answer: transient (same key), not "blocked".
      xero.fail({ match: /^PUT \/api\.xro\/2\.0\/Payments$/, status: 200, body: { Payments: [] } });
      await sendForClinic(ctx, A, client);
      assert.deepEqual([(await statusOf(`allocation:create:${allocId}`))?.status, (await statusOf(`allocation:create:${allocId}`))?.errorClass], ["pending", "transient"]);
      // Saved in Xero, answer lost.
      tick(61);
      xero.fail({ match: /^PUT \/api\.xro\/2\.0\/Payments$/, status: 503, afterSave: true });
      await sendForClinic(ctx, A, client);
      tick(301);
      await sendForClinic(ctx, A, client);
      assert.equal((await statusOf(`allocation:create:${allocId}`))?.status, "done");
      assert.equal(orgA.payments.filter((p) => String(p.Reference).includes(paymentMarker(allocId))).length, 1, "one payment in Xero");
    });

    it("review 7: only the lease holder records an outcome; a run never starts a Xero call past its deadline", async () => {
      const invId = await issued(A, OWNER, id.megan, id.svc, 1700);
      const itemId = `invoice:create:${invId}`;
      await sendForClinic(ctx, A, client, { maxItems: 0 });
      const first = await claimItem(ctx, A, itemId);
      assert.ok(first);
      tick(301);
      const second = await claimItem(ctx, A, itemId);
      assert.ok(second && second !== first, "an expired lease is taken over");
      const item = (await statusOf(itemId))!;
      await finishItem(ctx, A, item, first!, { kind: "validation", message: "late worker" });
      assert.equal((await statusOf(itemId))?.status, "in_flight", "the old holder recorded nothing");
      await finishItem(ctx, A, item, second!, { kind: "deferred" });
      assert.equal((await statusOf(itemId))?.status, "pending");
      // Deadline: budget 1 s, no grace – the first call would end past it, so nothing is sent and nothing counted.
      let t = 0;
      const before = xero.calls.length;
      const r = await sendForClinic(ctx, A, client, { budgetMs: 1000, graceMs: 0, nowMs: () => (t += 1) });
      assert.equal(r.deferred, 1);
      assert.equal(xero.calls.length, before, "no Xero call started");
      const after = await statusOf(itemId);
      assert.deepEqual([after?.status, after?.attempts], ["pending", 0]);
      await sendForClinic(ctx, A, client);
      assert.equal((await statusOf(itemId))?.status, "done");
    });

    it("review 9: a payment on a blocked invoice is listed as waiting; once the invoice is skipped, it is skipped too", async () => {
      await setXeroMapping(ctx, A, { kind: "default_account", localKey: "*", xeroValue: "999" }, "999 – Old sales", OWNER);
      const invId = await issued(A, OWNER, id.megan, id.svc, 1900);
      const pay = await recordPayment(ctx, A, { payerKind: "patient", patientId: id.megan, receivedOn: "2026-11-12", method: "card", amountPence: 1900, allocations: [{ invoiceId: invId, amountPence: 1900 }] }, OWNER);
      await sendForClinic(ctx, A, client);
      const p = await statusOf(`allocation:create:${pay.allocations[0].id}`);
      assert.deepEqual([p?.status, p?.errorClass], ["pending", "waiting"]);
      assert.match(p?.errorMessage ?? "", /needs a fix first/);
      const listed = await listSyncItems(ctx, A, { statuses: ["failed", "blocked"], withWaiting: true, limit: 200 });
      assert.ok(listed.some((x) => x.id === p?.id), "shown on the screen, not silently pending");
      await skipItem(ctx, A, `invoice:create:${invId}`, OWNER);
      tick(61);
      await sendForClinic(ctx, A, client);
      const q = await statusOf(`allocation:create:${pay.allocations[0].id}`);
      assert.equal(q?.status, "skipped");
      assert.match(q?.errorMessage ?? "", /invoice was skipped/);
      await setXeroMapping(ctx, A, { kind: "default_account", localKey: "*", xeroValue: "200" }, "200 – Sales", OWNER);
    });

    it("review 11: saving a setting while a refresh is in flight never discards the new tokens", async () => {
      const conn = await openConnection(ctx, A);
      assert.ok(conn);
      const claimed = await claimTokenRefresh(ctx, A, conn.tokenRev);
      assert.ok(claimed !== null);
      await setXeroOptions(ctx, A, { sendFrom: "2026-11-12", sendContactDetails: false }, OWNER);
      assert.equal(await storeRefreshedTokens(ctx, A, claimed, conn.tokens, new Date(clock + 1800_000).toISOString()), true);
    });

    it("review 12: a lost answer to a credit-note allocation is not allocated again after a retry", async () => {
      const invId = await issued(A, OWNER, id.megan, id.svc, 5000);
      await sendForClinic(ctx, A, client);
      const full = await getInvoice(ctx, A, invId);
      const cn = await createCreditNote(ctx, A, { invoiceId: invId, lines: [{ invoiceLineId: String(full?.lines[0].id), totalPence: 1500 }], reason: "Goodwill" }, OWNER);
      xero.fail({ match: /^PUT \/api\.xro\/2\.0\/CreditNotes\/[^/]+\/Allocations$/, status: 503, afterSave: true });
      await sendForClinic(ctx, A, client);
      assert.equal((await statusOf(`credit_note:create:${cn.id}`))?.status, "pending");
      tick(61);
      await sendForClinic(ctx, A, client);
      assert.equal((await statusOf(`credit_note:create:${cn.id}`))?.status, "done");
      const x = orgA.creditNotes.find((c) => c.CreditNoteNumber === cn.number);
      assert.equal((x?.Allocations as unknown[]).length, 1, "allocated once");
      assert.equal(orgA.invoices.find((i) => i.InvoiceNumber === full?.number)?.AmountDue, 35);
    });

    it("review 5: site-limited admins cannot manage Xero (clinic-wide); owners and all-site admins can", () => {
      const can = () => true;
      assert.equal(mayManageXero({ role: "admin", can, siteIds: new Set(["site_x"]) }), false);
      assert.equal(mayManageXero({ role: "owner", can, siteIds: null }), true);
      assert.equal(mayManageXero({ role: "admin", can, siteIds: null }), true);
      assert.equal(mayManageXero({ role: "clinician", can, siteIds: null }), false);
    });

    it("tenant isolation: each clinic sends only its own records to its own organisation", async () => {
      // Review 2: an organisation already connected to another clinic is refused – and that clinic's connection survives.
      assert.deepEqual(await connect(B, OWNER_B, [orgA.tenantId]), { ok: false, error: "org_in_use" });
      assert.equal((await getXeroConnection(ctx, A)).status, "connected");
      assert.ok(Array.from(xero.connections.values()).some((c) => c.tenantId === orgA.tenantId && c.user === `xero-user-of-${A}`), "A's connection untouched");
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

    it("review 8: the scheduled run takes clinics oldest-run first", async () => {
      // A was disconnected above: connected again here (row only) to compare two clinics.
      await ctx.db.updateTable("pms_xero_connections").set({ status: "connected" }).where("tenant_id", "=", A).execute();
      suite.log?.pause();
      await markClinicRun(ctx, A);
      tick(1);
      await markClinicRun(ctx, B);
      assert.deepEqual(await clinicsToSend(ctx), [A, B]);
      tick(1);
      await markClinicRun(ctx, A);
      assert.deepEqual(await clinicsToSend(ctx), [B, A], "B waited longest");
      suite.log?.resume();
      await ctx.db.updateTable("pms_xero_connections").set({ status: "disconnected" }).where("tenant_id", "=", A).execute();
    });

    it("review 4: disconnecting one clinic never revokes another clinic's connection of the same Xero user; no auth event = refused", async () => {
      const C = "cove-c";
      const orgC = xero.addOrg(defaultOrg("Cove Clinic (fictional)"));
      const orgD = xero.addOrg(defaultOrg("Dune Clinic (fictional)"));
      const OWNER_C = { userId: "user_owner_c", sessionId: "sess_c" };
      await setXeroEnabled(ctx, C, true, OWNER_C);
      // The same Xero user connects C (orgC) and, through another ClinDesk clinic, also orgD (modelled by a 2nd code).
      assert.deepEqual(await connect(C, OWNER_C, [orgC.tenantId], undefined, "shared-xero-user"), { ok: true, orgName: orgC.name });
      xero.issueCode([orgD.tenantId], "shared-xero-user");
      assert.equal(await disconnectXeroAndRevoke(ctx, C, client, OWNER_C), true);
      assert.ok(!xero.revoked.includes("shared-xero-user"), "not revoked while the user has another connection");
      assert.ok(Array.from(xero.connections.values()).some((c) => c.tenantId === orgD.tenantId), "the other connection survives");
      assert.ok(!Array.from(xero.connections.values()).some((c) => c.tenantId === orgC.tenantId), "only C's own connection was removed");
      // A token without the authentication_event_id claim: refused, nothing touched at Xero.
      const conns = xero.connections.size;
      xero.omitAuthEventOnce = true;
      assert.deepEqual(await connect(C, OWNER_C, [orgC.tenantId], undefined, "shared-xero-user"), { ok: false, error: "error" });
      assert.equal(xero.connections.size, conns + 1, "nothing deleted – the new sign-in's connection stays for the user to remove");
      assert.ok(!xero.revoked.includes("shared-xero-user"));
    });

    it("review 10: offboarding's export pages the links by key – every row, however many", async () => {
      const at = new Date(clock).toISOString();
      const rows = Array.from({ length: 250 }, (_, n) => ({ tenant_id: B, id: `invoice:inv_fake_${String(n).padStart(4, "0")}`, local_type: "invoice", local_id: `inv_fake_${String(n).padStart(4, "0")}`, xero_id: `x-${n}`, xero_number: null, sent_hash: null, pushed_at: at, created_at: at, updated_at: at }));
      for (let n = 0; n < rows.length; n += 10) await ctx.db.insertInto("pms_xero_links").values(rows.slice(n, n + 10)).execute();
      const total = Number((await ctx.db.selectFrom("pms_xero_links").select((eb) => eb.fn.countAll().as("n")).where("tenant_id", "=", B).executeTakeFirstOrThrow()).n);
      const exported = await exportPmsData(ctx.db, cipher, B, { tables: ["pms_xero_links"] });
      assert.equal(exported.pms_xero_links?.length, total);
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
