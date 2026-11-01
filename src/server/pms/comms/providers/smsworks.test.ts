/**
 * The SMS Works adapter and its delivery receipts (31/10/2026) – HTTP MOCKED (no account exists yet; nothing real is
 * ever called): provider selection (off without the key), the request (auth header, sender, destination, metadata,
 * receipt URL), the answers (sent / refused / unknown), and receipts settling the credits (delivered keeps, not
 * delivered refunds once, a timed-out send found by its metadata), with the token check and the re-read.
 * Fictional data only. Run by test:pms / test:db.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { testCipher } from "../../../db/testing/databases";
import type { RepoContext } from "../../../repos/context";
import { adjustSmsCredits, getSmsCreditAccount, ledgerCheck } from "../../../repos/pms/comms/credits";
import { listMessages } from "../../../repos/pms/comms/messages";
import { createPatient } from "../../../repos/pms/patients";
import { setEntitlement } from "../../../repos/pms/entitlements";
import { createGuardedSqliteDb, type GuardedDb } from "../../../repos/pms/testing/guarded-db";
import { billingLiveRequired } from "../credits/card-payments";
import { PROVIDER_UNKNOWN, sendPatientMessage, type DispatchDeps } from "../dispatch";
import { handleSmsWorksReceipt } from "../sms-receipts";
import { providerStatus, resolveCommsProviders } from "./index";
import { createSmsWorks, smsWorksConfig, smsWorksDestination, smsWorksSender, type Fetch } from "./smsworks";
import { testEmail } from "./test";

const T = "smsworks-clinic";
const OWNER = { userId: "user_owner_sw", sessionId: "sess_sw" };
/** A made-up token shape (never a real one). */
const TOKEN = ["JWT", "eyJmYWtlIjoidG9rZW4ifQ.fake-payload.fake-signature"].join(" ");
const RECEIPT_SECRET = "r".repeat(40);

/** A stand-in for the provider's API: records requests, answers as told. */
function mockApi() {
  const calls: { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | null }[] = [];
  const reports = new Map<string, Record<string, unknown>>();
  let next: (() => Response) | null = null;
  let n = 0;
  const fetchImpl: Fetch = async (url, init) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ url, method: String(init.method), headers, body });
    if (next) {
      const answer = next;
      next = null;
      return answer();
    }
    if (url.endsWith("/message/send")) {
      const id = `swmsg${++n}abcdef`;
      reports.set(id, { messageid: id, status: "SENT", metadata: body?.metadata });
      return new Response(JSON.stringify({ messageid: id, status: "SENT", credits: 1 }), { status: 201 });
    }
    const m = /\/message\/([^/?]+)$/.exec(url);
    if (m) {
      const r = reports.get(decodeURIComponent(m[1]));
      return r ? new Response(JSON.stringify(r), { status: 200 }) : new Response("{}", { status: 404 });
    }
    return new Response("{}", { status: 404 });
  };
  return { calls, reports, fetchImpl, answerNext: (r: () => Response) => void (next = r) };
}

describe("The SMS Works – adapter", () => {
  it("stays off (outbox) unless its key is set; live requires live billing", () => {
    assert.equal(providerStatus({ CLINIC_SMS_PROVIDER: "smsworks" }).sms, "outbox");
    assert.equal(resolveCommsProviders({ CLINIC_SMS_PROVIDER: "smsworks" }).sms.id, "outbox");
    assert.equal(providerStatus({ CLINIC_SMS_PROVIDER: "smsworks", SMSWORKS_API_KEY: TOKEN }).sms, "live");
    assert.equal(resolveCommsProviders({ CLINIC_SMS_PROVIDER: "smsworks", SMSWORKS_API_KEY: TOKEN }).sms.id, "smsworks");
    assert.equal(providerStatus({ CLINIC_SMS_PROVIDER: "outbox", SMSWORKS_API_KEY: TOKEN }).sms, "outbox", "the key alone switches nothing on");
    assert.equal(billingLiveRequired({ CLINIC_SMS_PROVIDER: "smsworks" }), true, "real texts: test-mode credits never pay for them");
    assert.throws(() => smsWorksConfig({ SMSWORKS_API_KEY: TOKEN, SMSWORKS_API_BASE: "https://evil.example.com/v1" }), /Refused/);
  });

  it("sender and destination in the network's format", () => {
    assert.equal(smsWorksSender("Riverside Physio"), "ClinDesk", "15 letters without the space is too long: the default");
    assert.equal(smsWorksSender("RED Physio"), "REDPhysio", "spaces are dropped");
    assert.equal(smsWorksSender("Riverside"), "Riverside");
    assert.equal(smsWorksSender(null), "ClinDesk");
    assert.equal(smsWorksSender(null, { SMSWORKS_SENDER: "BlueHeart" }), "BlueHeart");
    assert.equal(smsWorksSender("RP"), "ClinDesk", "too short");
    assert.equal(smsWorksDestination("+447700900123"), "447700900123");
  });

  it("sends with the token, the sender, our ids as metadata and the receipt URL; maps the answers", async () => {
    const api = mockApi();
    const p = createSmsWorks({ token: TOKEN, apiBase: "http://127.0.0.1:9/v1", receiptUrl: "https://app.example.com/api/clinic-messages/sms-receipts?token=x" }, api.fetchImpl);
    assert.equal(p.mode, "live");
    const sent = await p.send({ messageId: "msg_01", to: "+447700900123", from: "Riverside", body: "See you at 10:00.", tenantId: T });
    assert.equal(sent.status, "sent");
    const call = api.calls[0];
    assert.equal(call.url, "http://127.0.0.1:9/v1/message/send");
    assert.equal(call.headers.authorization, TOKEN);
    assert.deepEqual([call.body?.sender, call.body?.destination, call.body?.content, call.body?.deliveryreporturl], ["Riverside", "447700900123", "See you at 10:00.", "https://app.example.com/api/clinic-messages/sms-receipts?token=x"]);
    assert.deepEqual(call.body?.metadata, [{ key: "message", value: "msg_01" }, { key: "clinic", value: T }]);
    api.answerNext(() => new Response(JSON.stringify({ message: "Invalid destination" }), { status: 400 }));
    assert.deepEqual(await p.send({ messageId: "msg_02", to: "+447700900123", from: null, body: "x" }), { status: "failed", errorCode: "smsworks_400" });
    api.answerNext(() => new Response("{}", { status: 503 }));
    await assert.rejects(p.send({ messageId: "msg_03", to: "+447700900123", from: null, body: "x" }), /may or may not/);
  });
});

describe("The SMS Works – receipts settle the credits", () => {
  let g: GuardedDb;
  let ctx: RepoContext;
  let clock = Date.parse("2026-10-31T12:00:00.000Z");
  let patient = "";
  const api = mockApi();
  const provider = createSmsWorks({ token: TOKEN, apiBase: "http://127.0.0.1:9/v1", receiptUrl: null }, api.fetchImpl);
  const deps: DispatchDeps = { providers: { sms: provider, email: testEmail }, linkSecret: null, linkOrigin: "https://clinic.example.com", credits: {} };
  const balance = async () => (await getSmsCreditAccount(ctx, T)).balance;
  const receipt = (body: Record<string, unknown>, token = RECEIPT_SECRET) =>
    handleSmsWorksReceipt(new Request(`https://app.example.com/api/clinic-messages/sms-receipts?token=${token}`, { method: "POST", body: JSON.stringify(body) }), {
      secret: RECEIPT_SECRET,
      client: () => provider,
      ctx: () => ctx,
    });

  before(async () => {
    g = createGuardedSqliteDb();
    ctx = { db: g.db, cipher: testCipher(), now: () => new Date((clock += 1)) };
    await setEntitlement(ctx, T, "clinic", { status: "active" }, OWNER);
    patient = (await createPatient(ctx, T, { firstName: "Megan", lastName: "Hart", phoneMobile: "07700 900123" }, OWNER)).id;
    await adjustSmsCredits(ctx, T, { credits: 10, reason: "Test credits (fictional)" }, OWNER);
  });
  after(async () => {
    await g?.close();
  });

  it("refuses a wrong token; off without the live provider; 503 without the secret", async () => {
    assert.equal((await receipt({ messageid: "swmsg1abcdef", status: "DELIVERED" }, "w".repeat(40))).status, 401);
    const off = await handleSmsWorksReceipt(new Request("https://app.example.com/x?token=" + RECEIPT_SECRET, { method: "POST", body: "{}" }), { secret: RECEIPT_SECRET, client: () => null, ctx: () => ctx });
    assert.equal(off.status, 404);
    const noSecret = await handleSmsWorksReceipt(new Request("https://app.example.com/x", { method: "POST", body: "{}" }), { secret: undefined, client: () => provider, ctx: () => ctx });
    assert.equal(noSecret.status, 503);
  });

  it("delivered keeps the debit; the body alone is not trusted (re-read)", async () => {
    const r = await sendPatientMessage(ctx, T, { patientId: patient, channel: "sms", body: "Delivered one." }, OWNER, deps);
    assert.equal(r.ok && r.status, "sent");
    assert.equal(await balance(), 9);
    const id = Array.from(api.reports.keys()).pop() as string;
    // The body claims UNDELIVERABLE, the provider's own copy says SENT: nothing changes.
    assert.equal(((await (await receipt({ messageid: id, status: "UNDELIVERABLE" })).json()) as { result: string }).result, "pending");
    assert.equal(await balance(), 9);
    api.reports.set(id, { ...api.reports.get(id), status: "DELIVERED" });
    assert.equal(((await (await receipt({ messageid: id, status: "DELIVERED" })).json()) as { result: string }).result, "delivered");
    assert.equal(await balance(), 9);
    assert.equal((await listMessages(ctx, T, { limit: 1 }))[0].status, "delivered");
  });

  it("not delivered refunds once", async () => {
    await sendPatientMessage(ctx, T, { patientId: patient, channel: "sms", body: "Undeliverable one." }, OWNER, deps);
    assert.equal(await balance(), 8);
    const id = Array.from(api.reports.keys()).pop() as string;
    api.reports.set(id, { ...api.reports.get(id), status: "UNDELIVERABLE", failurereason: { code: 5, details: "unknown number", permanent: true } });
    assert.equal(((await (await receipt({ messageid: id })).json()) as { result: string }).result, "refunded");
    assert.equal(await balance(), 9);
    assert.equal(((await (await receipt({ messageid: id })).json()) as { result: string }).result, "already", "a repeated receipt refunds nothing");
    assert.equal(await balance(), 9);
    const m = (await listMessages(ctx, T, { limit: 1 }))[0];
    assert.deepEqual([m.status, m.errorCode], ["failed", "smsworks_5"]);
  });

  it("a timed-out send keeps its credits until the receipt: delivered keeps, found by our metadata", async () => {
    api.answerNext(() => {
      // The provider took the text but the answer never came back.
      api.reports.set("swlost1abcdef", { messageid: "swlost1abcdef", status: "DELIVERED", metadata: [] });
      throw new Error("socket hang up (simulated)");
    });
    const r = await sendPatientMessage(ctx, T, { patientId: patient, channel: "sms", body: "Lost answer." }, OWNER, deps);
    assert.equal(r.ok && r.status, "failed");
    const m = (await listMessages(ctx, T, { limit: 1 }))[0];
    assert.equal(m.errorCode, PROVIDER_UNKNOWN);
    assert.equal(await balance(), 8, "no refund on a timeout");
    api.reports.set("swlost1abcdef", { messageid: "swlost1abcdef", status: "DELIVERED", metadata: [{ key: "message", value: m.id }, { key: "clinic", value: T }] });
    const lost = (await (await receipt({ messageid: "swlost1abcdef" })).json()) as { result: string };
    assert.equal(lost.result, "delivered", JSON.stringify(lost));
    const after = (await listMessages(ctx, T, { limit: 1 }))[0];
    assert.equal(after.status, "delivered");
    assert.equal(await balance(), 8);
    assert.equal((await ledgerCheck(ctx, T)).ok, true);
  });
});
