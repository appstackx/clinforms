/** CLINFORMS_EMAIL_PROVIDER=mailpit (local testing only) – and the existing values are unchanged by it. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_MAILPIT_URL, mailpitBaseUrl, mailpitRefusal, mailpitSend, type MailpitSendBody } from "./mailpit";
import { EmailConfigError, MAILPIT_DEFAULT_FROM, SENDER_NAME, createEmailProvider, mailpitProviderFor, resolveEmailProviderName } from "./providers";
import { invitationEmail } from "./templates";

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response | Promise<Response>): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input instanceof Request ? input.url : input), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const invite = () =>
  invitationEmail({
    to: { email: "new.member@riverside-physio.co.uk", name: "New Member" },
    clinicName: "Riverside Physio",
    role: "clinician",
    inviterName: "Olivia Owner",
    link: "http://localhost:3300/accept-invite?token=abc",
    expiresAt: "2026-10-16T13:05:00.000Z",
  });

describe("mailpit: local-only rules", () => {
  it("URL: default, custom, refuses non-http and credentials", () => {
    assert.equal(mailpitBaseUrl({})?.href, `${DEFAULT_MAILPIT_URL}/`);
    assert.equal(mailpitBaseUrl({ MAILPIT_URL: "http://127.0.0.1:9025" })?.host, "127.0.0.1:9025");
    assert.equal(mailpitBaseUrl({ MAILPIT_URL: "ftp://localhost" }), null);
    assert.equal(mailpitBaseUrl({ MAILPIT_URL: "http://u:p@localhost:8026" }), null);
    assert.equal(mailpitBaseUrl({ MAILPIT_URL: "not a url" }), null);
  });
  it("refused on any VERCEL_ENV, and on NODE_ENV=production unless the URL is localhost", () => {
    assert.equal(mailpitRefusal({}), null);
    assert.equal(mailpitRefusal({ NODE_ENV: "development", MAILPIT_URL: "http://mailpit:8025" }), null);
    for (const VERCEL_ENV of ["production", "preview", "development"]) assert.match(mailpitRefusal({ VERCEL_ENV }) ?? "", /Vercel/);
    assert.match(mailpitRefusal({ VERCEL_ENV: "production", MAILPIT_URL: "http://localhost:8026" }) ?? "", /Vercel/);
    assert.equal(mailpitRefusal({ NODE_ENV: "production" }), null, "local next start, default localhost URL");
    assert.equal(mailpitRefusal({ NODE_ENV: "production", MAILPIT_URL: "http://127.0.0.1:8026" }), null);
    assert.equal(mailpitRefusal({ NODE_ENV: "production", MAILPIT_URL: "http://[::1]:8026" }), null);
    assert.match(mailpitRefusal({ NODE_ENV: "production", MAILPIT_URL: "https://mail.example.com" }) ?? "", /localhost/);
    assert.match(mailpitRefusal({ NODE_ENV: "production", MAILPIT_URL: "http://localhost.example.com" }) ?? "", /localhost/);
    assert.ok(!(mailpitRefusal({ NODE_ENV: "production", MAILPIT_URL: "https://secret-host.example.com" }) ?? "").includes("secret-host"), "URL never echoed");
  });
});

describe("CLINFORMS_EMAIL_PROVIDER=mailpit", () => {
  it("resolves locally; treated as none wherever it is refused", () => {
    assert.equal(resolveEmailProviderName({ CLINFORMS_EMAIL_PROVIDER: "mailpit" }), "mailpit");
    assert.equal(resolveEmailProviderName({ CLINFORMS_EMAIL_PROVIDER: "MailPit" }), "mailpit");
    assert.equal(resolveEmailProviderName({ CLINFORMS_EMAIL_PROVIDER: "mailpit", NODE_ENV: "production" }), "mailpit");
    assert.equal(resolveEmailProviderName({ CLINFORMS_EMAIL_PROVIDER: "mailpit", VERCEL_ENV: "production" }), "none");
    assert.equal(resolveEmailProviderName({ CLINFORMS_EMAIL_PROVIDER: "mailpit", VERCEL_ENV: "preview" }), "none");
    assert.equal(resolveEmailProviderName({ CLINFORMS_EMAIL_PROVIDER: "mailpit", VERCEL_ENV: "development" }), "none");
    assert.equal(resolveEmailProviderName({ CLINFORMS_EMAIL_PROVIDER: "mailpit", NODE_ENV: "production", MAILPIT_URL: "https://mail.example.com" }), "none");
    assert.equal(createEmailProvider({ CLINFORMS_EMAIL_PROVIDER: "mailpit", VERCEL_ENV: "production" }).name, "none");
    assert.equal(createEmailProvider({ CLINFORMS_EMAIL_PROVIDER: "mailpit" }).name, "mailpit");
    assert.throws(() => mailpitProviderFor({ VERCEL_ENV: "preview" }), EmailConfigError, "cannot be built by mistake");
  });
  it("existing values behave exactly as before", () => {
    assert.equal(resolveEmailProviderName({}), "none");
    assert.equal(resolveEmailProviderName({ CLINFORMS_EMAIL_PROVIDER: "none" }), "none");
    assert.equal(resolveEmailProviderName({ CLINFORMS_EMAIL_PROVIDER: "mailersend", VERCEL_ENV: "production" }), "mailersend");
    assert.equal(resolveEmailProviderName({ CLINFORMS_EMAIL_PROVIDER: "log", VERCEL_ENV: "production" }), "none");
    assert.equal(resolveEmailProviderName({ CLINFORMS_EMAIL_PROVIDER: "log" }), "log");
    assert.throws(() => resolveEmailProviderName({ CLINFORMS_EMAIL_PROVIDER: "smtp" }), /mailersend, log or none/);
  });
  it("posts the whole message to /api/v1/send and reports sent", async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response(JSON.stringify({ ID: "abc123" }), { status: 200 }));
    const provider = mailpitProviderFor({ MAILPIT_URL: "http://localhost:8026", CLINFORMS_EMAIL_REPLY_TO: "help@riverside-physio.co.uk" }, fetchImpl);
    const message = invite();
    assert.deepEqual(await provider.send(message), { status: "sent", provider: "mailpit" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://localhost:8026/api/v1/send");
    assert.equal(calls[0].init.method, "POST");
    const body = JSON.parse(String(calls[0].init.body)) as MailpitSendBody;
    assert.deepEqual(body.From, { Email: MAILPIT_DEFAULT_FROM, Name: SENDER_NAME });
    assert.deepEqual(body.To, [{ Email: "new.member@riverside-physio.co.uk", Name: "New Member" }]);
    assert.deepEqual(body.ReplyTo, [{ Email: "help@riverside-physio.co.uk", Name: SENDER_NAME }]);
    assert.equal(body.Subject, message.subject);
    assert.ok(body.Text.includes(message.link!) && body.HTML!.includes("accept-invite"));
    assert.deepEqual(body.Tags, ["clinforms", "invitation"]);
  });
  it("uses the MailerSend sender when one is set; a path in MAILPIT_URL is kept", async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response(JSON.stringify({ ID: "x" })));
    await mailpitProviderFor({ MAILPIT_URL: "http://localhost:9000/mailpit", MAILERSEND_FROM_EMAIL: "no-reply@clinforms.co.uk" }, fetchImpl).send(invite());
    assert.equal(calls[0].url, "http://localhost:9000/mailpit/api/v1/send");
    assert.equal((JSON.parse(String(calls[0].init.body)) as MailpitSendBody).From.Email, "no-reply@clinforms.co.uk");
  });
  it("failed when Mailpit refuses or is not running (never throws)", async () => {
    const refused = fakeFetch(() => new Response(JSON.stringify({ Error: "bad" }), { status: 400 }));
    assert.deepEqual(await mailpitProviderFor({}, refused.fetchImpl).send(invite()), { status: "failed", provider: "mailpit" });
    const down = fakeFetch(() => Promise.reject(new TypeError("fetch failed")));
    assert.deepEqual(await mailpitProviderFor({}, down.fetchImpl).send(invite()), { status: "failed", provider: "mailpit" });
    const result = await mailpitSend(new URL("http://localhost:8026"), { From: { Email: "a@b.local" }, To: [], Subject: "s", Text: "t" }, { fetchImpl: down.fetchImpl });
    assert.deepEqual(result, { ok: false, status: null });
  });
});
