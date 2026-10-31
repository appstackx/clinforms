/**
 * The comms module's HTTP handlers and settings: provider selection (no live keys, no live provider), stop-email
 * links, the cron run, the SMS webhook (not live: test provider only, signed) and the unsubscribe page.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { testCipher } from "../../db/testing/databases";
import { listAudit } from "../../repos/audit";
import type { RepoContext } from "../../repos/context";
import { listConsentEvents } from "../../repos/pms/comms/consent";
import { getMessagingContact } from "../../repos/pms/comms/contacts";
import { listMessages } from "../../repos/pms/comms/messages";
import { syncAppointmentMessages } from "../../repos/pms/comms/schedule";
import { createSite } from "../../repos/pms/directory";
import { setEntitlement } from "../../repos/pms/entitlements";
import { createPatient } from "../../repos/pms/patients";
import { createGuardedSqliteDb, unscopedStatements, type GuardedDb } from "../../repos/pms/testing/guarded-db";
import { clinicsWithClinicSystem, handleCommsCron } from "./cron";
import type { DispatchDeps } from "./dispatch";
import { commsLinkOrigin, commsLinkSecret, signStopToken, stopLinkUrl, verifyStopToken } from "./links";
import { assertNoLiveKeys, providerStatus, resolveCommsProviders } from "./providers";
import { outboxEmail, outboxSms } from "./providers/outbox";
import { MAILPIT_SMS_SUBJECT, mailpitEmailProvider, mailpitSmsProvider } from "./providers/mailpit";
import { handleUnsubscribe } from "./unsubscribe";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, handleSmsWebhook, signWebhook } from "./webhook";

const A = "riverside-a";
const OFF = "harbour-off";
const STAFF = { userId: "user_owner", sessionId: "sess_1" };
const CRON = "cron-secret-for-tests-0123456789";
const HOOK = "webhook-secret-for-tests-0123456789abcdef";
const LINK = "link-secret-for-tests-".padEnd(43, "q");

describe("providers: outbox by default, test on request, nothing live", () => {
  it("chooses by env and refuses anything else", () => {
    assert.deepEqual(Object.values(resolveCommsProviders({})).map((p) => p.mode), ["outbox", "outbox"]);
    assert.deepEqual(Object.values(resolveCommsProviders({ CLINIC_SMS_PROVIDER: "test", CLINIC_EMAIL_PROVIDER: "outbox" })).map((p) => p.mode), ["test", "outbox"]);
    assert.throws(() => resolveCommsProviders({ CLINIC_SMS_PROVIDER: "gateway-x" }), /must be outbox or test/);
    assert.throws(() => resolveCommsProviders({ CLINIC_EMAIL_PROVIDER: "test", VERCEL_ENV: "production" }), /refused on production/);
    assert.equal(resolveCommsProviders({ CLINIC_EMAIL_PROVIDER: "test", VERCEL_ENV: "production", CLINIC_ALLOW_TEST_PROVIDER: "1" }).email.mode, "test");
    assert.deepEqual(providerStatus({ CLINIC_SMS_PROVIDER: "nope" }), { sms: "misconfigured", email: "misconfigured" });
  });
  it("refuses a key that does not look like a test key", () => {
    assert.doesNotThrow(() => assertNoLiveKeys({ CLINIC_SMS_API_KEY: "test_abc" }));
    assert.throws(() => assertNoLiveKeys({ CLINIC_SMS_API_KEY: "live_abc" }), /live keys are refused/);
    assert.throws(() => resolveCommsProviders({ CLINIC_EMAIL_API_KEY: "sk_123" }), /live keys are refused/);
  });
});

describe("providers: mailpit (local testing only)", () => {
  const fake = (respond: () => Response | Promise<Response>) => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return respond();
    }) as typeof fetch;
    return { fetchImpl, calls };
  };
  it("chosen by env; refused on any Vercel environment and on a non-local production run", () => {
    const p = resolveCommsProviders({ CLINIC_SMS_PROVIDER: "test", CLINIC_EMAIL_PROVIDER: "mailpit" });
    assert.deepEqual([p.sms.mode, p.email.mode, p.email.id], ["test", "mailpit", "mailpit"]);
    assert.equal(resolveCommsProviders({ CLINIC_SMS_PROVIDER: "MAILPIT" }).sms.mode, "mailpit");
    assert.equal(resolveCommsProviders({ CLINIC_EMAIL_PROVIDER: "mailpit", NODE_ENV: "production" }).email.mode, "mailpit", "local next start");
    for (const VERCEL_ENV of ["production", "preview", "development"]) {
      assert.throws(() => resolveCommsProviders({ CLINIC_EMAIL_PROVIDER: "mailpit", VERCEL_ENV }), /CLINIC_EMAIL_PROVIDER=mailpit is refused.*Vercel/);
      assert.throws(() => resolveCommsProviders({ CLINIC_SMS_PROVIDER: "mailpit", VERCEL_ENV, CLINIC_ALLOW_TEST_PROVIDER: "1" }), /refused/);
    }
    assert.throws(() => resolveCommsProviders({ CLINIC_EMAIL_PROVIDER: "mailpit", NODE_ENV: "production", MAILPIT_URL: "https://mail.example.com" }), /localhost/);
    assert.deepEqual(providerStatus({ CLINIC_EMAIL_PROVIDER: "mailpit", CLINIC_SMS_PROVIDER: "mailpit" }), { sms: "mailpit", email: "mailpit" });
    assert.deepEqual(providerStatus({ CLINIC_EMAIL_PROVIDER: "mailpit", VERCEL_ENV: "production" }), { sms: "misconfigured", email: "misconfigured" });
    assert.throws(() => resolveCommsProviders({ CLINIC_EMAIL_PROVIDER: "mailpit", CLINIC_EMAIL_API_KEY: "live_abc" }), /live keys are refused/);
    assert.throws(() => resolveCommsProviders({ CLINIC_EMAIL_PROVIDER: "smtp" }), /must be outbox or test/);
  });
  it("email: the real message (links, headers) to /api/v1/send; reported sent", async () => {
    const { fetchImpl, calls } = fake(() => new Response(JSON.stringify({ ID: "Zx81" })));
    const provider = mailpitEmailProvider({}, fetchImpl);
    const outcome = await provider.send({
      messageId: "msg_1",
      to: "pat@example.com",
      fromName: "Riverside Physio",
      replyTo: "hello@riverside.example",
      subject: "Sign in to your portal",
      text: "Sign in: http://localhost:3300/portal/k/abc",
      html: "<p>http://localhost:3300/portal/k/abc</p>",
      headers: { "List-Unsubscribe": "<http://localhost:3300/u/1>" },
    });
    assert.deepEqual(outcome, { status: "sent", providerMessageId: "mailpit_Zx81" });
    assert.equal(calls[0].url, "http://localhost:8026/api/v1/send");
    const body = calls[0].body;
    assert.deepEqual(body.To, [{ Email: "pat@example.com" }]);
    assert.deepEqual(body.ReplyTo, [{ Email: "hello@riverside.example", Name: "Riverside Physio" }]);
    assert.equal((body.From as { Name: string }).Name, "Riverside Physio");
    assert.ok(String(body.Text).includes("/portal/k/abc"));
    assert.deepEqual(body.Headers, { "List-Unsubscribe": "<http://localhost:3300/u/1>" });
  });
  it("sms: shown as a labelled email to <phone>@sms.local; Mailpit down = failed", async () => {
    const { fetchImpl, calls } = fake(() => new Response(JSON.stringify({ ID: "s1" })));
    const outcome = await mailpitSmsProvider({}, fetchImpl).send({ messageId: "m2", to: "+447700900123", from: "Riverside", body: "See you at 10:00" });
    assert.deepEqual(outcome, { status: "sent", providerMessageId: "mailpit_s1" });
    assert.deepEqual(calls[0].body.To, [{ Email: "447700900123@sms.local" }]);
    assert.equal(calls[0].body.Subject, MAILPIT_SMS_SUBJECT);
    assert.match(String(calls[0].body.Text), /^\(Local test: a text message to \+447700900123 from "Riverside", caught by Mailpit\. Nothing was texted\.\)\n\nSee you at 10:00$/);
    const down = fake(() => Promise.reject(new TypeError("fetch failed")));
    assert.deepEqual(await mailpitEmailProvider({}, down.fetchImpl).send({ messageId: "m3", to: "a@b.c", fromName: "C", replyTo: null, subject: "s", text: "t", html: "", headers: {} }), { status: "failed", errorCode: "mailpit_unavailable" });
  });
});

describe("stop-email links", () => {
  it("signed, bound to their contents, expire", () => {
    const now = Date.parse("2026-10-24T09:00:00.000Z");
    const token = signStopToken({ tenantId: A, patientId: "pat_01JABCDEFGHJKMNPQRSTVWXYZ0", channel: "email", purpose: "service" }, LINK, now);
    const link = verifyStopToken(token, LINK, now);
    assert.equal(link?.patientId, "pat_01JABCDEFGHJKMNPQRSTVWXYZ0");
    assert.equal(verifyStopToken(token, LINK, now + 401 * 86_400_000), null, "expired");
    assert.equal(verifyStopToken(token, "another-secret-".padEnd(43, "z"), now), null);
    const [v, body, sig] = token.split(".");
    const forged = Buffer.from(Buffer.from(body, "base64url").toString("utf8").replace('"service"', '"marketing"')).toString("base64url");
    assert.equal(verifyStopToken(`${v}.${forged}.${sig}`, LINK, now), null, "contents cannot be changed");
    assert.equal(verifyStopToken("rubbish", LINK, now), null);
    assert.equal(commsLinkSecret({ BETTER_AUTH_SECRET: "short" }), null);
    assert.notEqual(commsLinkSecret({ BETTER_AUTH_SECRET: "x".repeat(40) }), "x".repeat(40), "a derived key, not the sign-in secret");
    assert.equal(commsLinkOrigin({ APP_ORIGIN: "https://clinforms.co.uk/app" }), "https://clinforms.co.uk");
    assert.equal(stopLinkUrl("https://a.example", "v1.x.y"), "https://a.example/api/clinic-messages/unsubscribe?t=v1.x.y");
  });
});

describe("cron, webhook and unsubscribe handlers", () => {
  let g: GuardedDb;
  let ctx: RepoContext;
  let clock = Date.parse("2026-10-24T09:00:00.000Z");
  const ids: Record<string, string> = {};
  const deps: DispatchDeps = { providers: { sms: outboxSms, email: outboxEmail }, linkSecret: LINK, linkOrigin: "https://clinic.example.com" };

  before(async () => {
    g = createGuardedSqliteDb();
    ctx = { db: g.db, cipher: testCipher(), now: () => new Date(clock) };
    await setEntitlement(ctx, A, "clinic", { status: "trial" }, STAFF);
    const site = await createSite(ctx, A, { name: "Bletchley (fictional)" }, STAFF);
    const megan = await createPatient(ctx, A, { firstName: "Megan", lastName: "Hart", phoneMobile: "07700 900123", email: "megan.hart@example.com" }, STAFF);
    Object.assign(ids, { site: site.id, megan: megan.id });
    await syncAppointmentMessages(ctx, A, { id: "appt_1", patientId: megan.id, startsAt: "2026-10-28T10:00:00.000Z", siteId: site.id, active: true }, STAFF, { notify: "confirmation" });
  });
  after(async () => {
    await g?.close();
  });

  const cronReq = (auth?: string) => new Request("http://localhost/api/clinic-messages/cron", { headers: auth ? { authorization: auth } : {} });

  it("cron: refuses without CRON_SECRET or with the wrong one; runs every clinic with the clinic system", async () => {
    const quiet = () => undefined;
    assert.equal((await handleCommsCron(cronReq(`Bearer ${CRON}`), { secret: undefined, ctx: () => ctx, dispatch: () => deps, log: quiet })).status, 503);
    assert.equal((await handleCommsCron(cronReq("Bearer wrong"), { secret: CRON, ctx: () => ctx, dispatch: () => deps, log: quiet })).status, 401);
    assert.equal(
      (await handleCommsCron(cronReq(`Bearer ${CRON}`), { secret: CRON, ctx: () => ctx, dispatch: () => resolveCommsProviders({ CLINIC_SMS_PROVIDER: "x" }) as never, log: quiet })).status,
      503,
      "a bad provider setting stops the run",
    );
    g.log.pause(); // the run's one cross-clinic read: which clinics have the clinic system
    assert.deepEqual(await clinicsWithClinicSystem(ctx), [A]);
    g.log.resume();
    const events: string[] = [];
    g.log.pause();
    const res = await handleCommsCron(cronReq(`Bearer ${CRON}`), { secret: CRON, ctx: () => ctx, dispatch: () => deps, log: (e) => events.push(e) });
    g.log.resume();
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, number>;
    assert.deepEqual([body.clinics, body.claimed, body.outbox, body.sent], [1, 2, 2, 0]);
    assert.deepEqual(events, ["cron.clinic_messages.done"]);
    assert.equal((await listMessages(ctx, A)).length, 2);
  });

  const hook = (payload: unknown, opts: { secret?: string; ts?: number } = {}) => {
    const raw = JSON.stringify(payload);
    const ts = String(Math.floor((opts.ts ?? clock) / 1000));
    return new Request("http://localhost/api/clinic-messages/sms", { method: "POST", body: raw, headers: { "content-type": "application/json", [TIMESTAMP_HEADER]: ts, [SIGNATURE_HEADER]: signWebhook(opts.secret ?? HOOK, ts, raw) } });
  };

  it("webhook: off unless the test provider is on; signed and fresh only; stores replies once", async () => {
    const d = { secret: HOOK, providerMode: "test" as const, ctx: () => ctx, nowMs: () => clock };
    const reply = { type: "reply", clinic: A, from: "+447700900123", text: "YES", id: "in_hook_1" };
    assert.equal((await handleSmsWebhook(hook(reply), { ...d, providerMode: "outbox" })).status, 404);
    assert.equal((await handleSmsWebhook(hook(reply), { ...d, secret: "short" })).status, 503);
    assert.equal((await handleSmsWebhook(hook(reply, { secret: "w".repeat(40) }), d)).status, 401);
    assert.equal((await handleSmsWebhook(hook(reply, { ts: clock - 10 * 60_000 }), d)).status, 401, "older than 5 minutes");
    assert.equal((await handleSmsWebhook(hook({ ...reply, clinic: OFF }), d)).status, 404, "a clinic without the clinic system");
    const ok = await handleSmsWebhook(hook(reply), d);
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, duplicate: false });
    assert.deepEqual(await (await handleSmsWebhook(hook(reply), d)).json(), { ok: true, duplicate: true });
    const inbound = await listMessages(ctx, A, { direction: "inbound" });
    assert.deepEqual(inbound.map((m) => [m.replyIntent, m.appointmentId, m.provider]), [["confirm", "appt_1", "test"]]);
    assert.equal((await handleSmsWebhook(hook({ type: "status", clinic: A, id: "unknown", status: "delivered" }), d)).status, 200);
    assert.equal((await handleSmsWebhook(hook({ type: "status", clinic: A, id: "x", status: "lost" }), d)).status, 400);
    assert.equal((await handleSmsWebhook(hook({ type: "other", clinic: A }), d)).status, 400);
  });

  it("unsubscribe: GET asks and changes nothing; POST and one-click stop the emails, with a record", async () => {
    const token = signStopToken({ tenantId: A, patientId: ids.megan, channel: "email", purpose: "service" }, LINK, clock);
    const url = `http://localhost/api/clinic-messages/unsubscribe?t=${encodeURIComponent(token)}`;
    const d = { secret: LINK, ctx: () => ctx, nowMs: () => clock };
    const get = await handleUnsubscribe(new Request(url), d);
    assert.equal(get.status, 200);
    const html = await get.text();
    assert.match(html, /Stop appointment emails from the clinic\?/, "no clinic profile in this test: the neutral name");
    assert.match(html, /<button type="submit">Stop these emails<\/button>/);
    assert.ok(!html.includes("Megan") && !html.includes("example.com"), "no personal details on the page");
    assert.equal(get.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal((await getMessagingContact(ctx, A, ids.megan))?.reminderEmail, true, "GET changes nothing");
    assert.equal((await handleUnsubscribe(new Request(`${url}x`), d)).status, 400, "an altered link");
    assert.equal((await handleUnsubscribe(new Request(url, { method: "POST", body: "nothing=1", headers: { "content-type": "application/x-www-form-urlencoded" } }), d)).status, 400);
    const post = await handleUnsubscribe(new Request(url, { method: "POST", body: "confirm=1", headers: { "content-type": "application/x-www-form-urlencoded" } }), d);
    assert.equal(post.status, 200);
    assert.match(await post.text(), /You will no longer receive appointment emails/);
    assert.equal((await getMessagingContact(ctx, A, ids.megan))?.reminderEmail, false);
    const events = await listConsentEvents(ctx, A, ids.megan);
    assert.deepEqual(events.map((e) => [e.channel, e.purpose, e.action, e.source, e.createdBy]), [["email", "service", "opt_out", "email_link", null]]);
    const marketing = signStopToken({ tenantId: A, patientId: ids.megan, channel: "email", purpose: "marketing" }, LINK, clock);
    const oneClick = await handleUnsubscribe(
      new Request(`http://localhost/api/clinic-messages/unsubscribe?t=${encodeURIComponent(marketing)}`, { method: "POST", body: "List-Unsubscribe=One-Click", headers: { "content-type": "application/x-www-form-urlencoded" } }),
      d,
    );
    assert.equal(oneClick.status, 200, "one-click (RFC 8058) answers plainly; marketing was already off, nothing to change");
    const gone = signStopToken({ tenantId: A, patientId: "pat_01JZZZZZZZZZZZZZZZZZZZZZZZ", channel: "email", purpose: "service" }, LINK, clock);
    const missing = await handleUnsubscribe(new Request(`http://localhost/api/clinic-messages/unsubscribe?t=${encodeURIComponent(gone)}`, { method: "POST", body: "confirm=1" }), d);
    assert.equal(missing.status, 200, "a record that does not exist answers the same");
    const audit = await listAudit(ctx, A, { action: "pms.consent.change" });
    assert.equal(audit.length, 1);
    assert.deepEqual(audit[0].detail, { channel: "email", purpose: "service", action: "opt_out", source: "email_link" });
  });

  it("tenant-scope guard over the handlers", () => {
    assert.deepEqual(unscopedStatements(g.log.statements), []);
  });
});
