import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { captureOutbox, deliverEmail, inviteDeliveryOf, linkToShare, setEmailProviderForTests } from "./index";
import { EmailConfigError, createEmailProvider, logProviderFor, mailerSendProvider, replyToAddress, resolveEmailProviderName, SENDER_NAME } from "./providers";
import { escapeHtml, invitationEmail, passwordResetEmail, twoFactorEnabledEmail, ukDateTime } from "./templates";

describe("email templates", () => {
  it("invitation: clinic, role label, link and UK expiry in both parts; HTML escaped", () => {
    const m = invitationEmail({
      to: { email: "new@clinic.example" },
      clinicName: "Riverside <Physio> & Co",
      role: "clinician",
      inviterName: "Olivia \"Owner\"",
      link: "https://clinforms.co.uk/accept-invite?token=abc",
      expiresAt: "2026-10-16T13:05:00.000Z",
    });
    assert.equal(m.kind, "invitation");
    assert.equal(m.link, "https://clinforms.co.uk/accept-invite?token=abc");
    assert.match(m.text, /as Clinician/);
    assert.match(m.text, /16 October 2026 at 14:05 \(UK time\)/);
    assert.ok(m.text.includes(m.link!));
    assert.ok(m.html.includes("Riverside &lt;Physio&gt; &amp; Co"));
    assert.ok(!m.html.includes("<Physio>"));
    assert.ok(m.html.includes("Olivia &quot;Owner&quot;"));
  });
  it("password reset and two-step notice", () => {
    const r = passwordResetEmail({ to: { email: "a@b.example", name: "Ann" }, link: "https://x.example/reset-password?token=t", expiresAt: "2026-01-10T09:00:00.000Z" });
    assert.match(r.subject, /Reset your ClinForms password/);
    assert.match(r.text, /10 January 2026 at 09:00 \(UK time\)/);
    const n = twoFactorEnabledEmail({ to: { email: "a@b.example" }, at: "2026-10-09T10:00:00.000Z" });
    assert.equal(n.link, undefined);
    assert.match(n.text, /If this was not you/);
  });
  it("helpers", () => {
    assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    assert.equal(ukDateTime("2026-07-01T11:30:00.000Z"), "1 July 2026 at 12:30 (UK time)");
  });
});

describe("email providers", () => {
  afterEach(() => setEmailProviderForTests(null));

  it("CLINFORMS_EMAIL_PROVIDER: default none, log refused on production, unknown refused", () => {
    assert.equal(resolveEmailProviderName({}), "none");
    assert.equal(resolveEmailProviderName({ CLINFORMS_EMAIL_PROVIDER: "MailerSend" }), "mailersend");
    assert.equal(resolveEmailProviderName({ CLINFORMS_EMAIL_PROVIDER: "log" }), "log");
    assert.equal(resolveEmailProviderName({ CLINFORMS_EMAIL_PROVIDER: "log", VERCEL_ENV: "production" }), "none");
    // 24/10: also on a preview deployment (its logs must never hold a link); a pulled local env is not a deployment
    assert.equal(resolveEmailProviderName({ CLINFORMS_EMAIL_PROVIDER: "log", VERCEL_ENV: "preview" }), "none");
    assert.equal(resolveEmailProviderName({ CLINFORMS_EMAIL_PROVIDER: "log", VERCEL_ENV: "development" }), "log");
    assert.throws(() => resolveEmailProviderName({ CLINFORMS_EMAIL_PROVIDER: "cloudflare" }), /mailersend, log or none/);
  });

  it("mailersend: needs a key and a from address; sends as ClinForms; a failure is reported, not thrown", async () => {
    assert.throws(() => mailerSendProvider({ MAILERSEND_FROM_EMAIL: "no-reply@clinforms.co.uk" }), /MAILERSEND_API_KEY/);
    const calls: unknown[] = [];
    const ok = mailerSendProvider({ MAILERSEND_FROM_EMAIL: "no-reply@clinforms.co.uk" }, { email: { send: async (p: unknown) => (calls.push(p), {}) } } as never);
    const message = twoFactorEnabledEmail({ to: { email: "a@b.example", name: "Ann" }, at: new Date().toISOString() });
    assert.deepEqual(await ok.send(message), { status: "sent", provider: "mailersend" });
    const params = calls[0] as { from: { email: string; name: string }; to: { email: string }[]; subject: string; text: string };
    assert.equal(params.from.email, "no-reply@clinforms.co.uk");
    assert.equal(params.from.name, SENDER_NAME);
    assert.equal(params.to[0].email, "a@b.example");
    assert.equal(params.subject, message.subject);
    const failing = mailerSendProvider({ MAILERSEND_FROM_EMAIL: "x@y.example" }, { email: { send: async () => Promise.reject({ statusCode: 422 }) } } as never);
    assert.deepEqual(await failing.send(message), { status: "failed", provider: "mailersend" });
  });

  it("outbox capture: the link is shared only when the email did not go out; .invalid addresses never send", async () => {
    let sends = 0;
    setEmailProviderForTests({ name: "mailersend", send: async () => (sends++, { status: "sent", provider: "mailersend" }) });
    const message = invitationEmail({ to: { email: "x@clinic.example" }, clinicName: "C", role: "staff", link: "https://l.example/accept-invite?token=1", expiresAt: new Date().toISOString() });
    const sent = await captureOutbox(() => deliverEmail(message));
    assert.equal(linkToShare(sent.outbox[0]), null);
    setEmailProviderForTests({ name: "none", send: async () => ({ status: "not_sent", provider: "none" }) });
    const off = await captureOutbox(() => deliverEmail(message));
    assert.equal(linkToShare(off.outbox[0]), "https://l.example/accept-invite?token=1");
    setEmailProviderForTests({ name: "mailersend", send: async () => (sends++, { status: "sent", provider: "mailersend" }) });
    const invalid = await deliverEmail({ ...message, to: { email: "platform@clinforms.invalid" } });
    assert.equal(invalid.status, "not_sent");
    assert.equal(sends, 1);
  });
});

/** Captures console.info lines written while `fn` runs (the identity layer's structured logs go there). */
async function capturedLogs(fn: () => Promise<unknown>): Promise<string> {
  const lines: string[] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.info = original;
  }
  return lines.join("\n");
}

describe("email: reply-to, withheld sends, links never logged (24/10/2026)", () => {
  afterEach(() => setEmailProviderForTests(null));
  const LINK = "https://clinforms.example/accept-invite?token=inv123.MACMACMAC";
  const invite = () => invitationEmail({ to: { email: "new@clinic.example" }, clinicName: "C (fictional)", role: "clinician", link: LINK, expiresAt: new Date().toISOString() });

  it("CLINFORMS_EMAIL_REPLY_TO: one plain address, or unset; anything else is refused without echoing the value", () => {
    assert.equal(replyToAddress({}), null);
    assert.equal(replyToAddress({ CLINFORMS_EMAIL_REPLY_TO: "  " }), null);
    assert.equal(replyToAddress({ CLINFORMS_EMAIL_REPLY_TO: " support@appstackx.example " }), "support@appstackx.example");
    for (const bad of ["support", "a@b", "Support <a@b.example>", "a@b.example, c@d.example", "a@b.example;c@d.example", "a b@c.example", `${"x".repeat(250)}@b.example`]) {
      assert.throws(
        () => replyToAddress({ CLINFORMS_EMAIL_REPLY_TO: bad }),
        (err: unknown) => err instanceof EmailConfigError && /CLINFORMS_EMAIL_REPLY_TO must be a single email address/.test(err.message) && !err.message.includes(bad),
        bad,
      );
    }
  });

  it("mailersend: the reply-to goes on every message kind; none without the setting", async () => {
    const calls: { reply_to?: { email: string; name?: string } }[] = [];
    const client = { email: { send: async (p: unknown) => (calls.push(p as never), {}) } } as never;
    const withReply = mailerSendProvider({ MAILERSEND_FROM_EMAIL: "hello@clinforms.example", CLINFORMS_EMAIL_REPLY_TO: "support@appstackx.example" }, client);
    const messages = [
      invite(),
      passwordResetEmail({ to: { email: "a@b.example" }, link: "https://x.example/reset-password?token=t", expiresAt: new Date().toISOString() }),
      twoFactorEnabledEmail({ to: { email: "a@b.example" }, at: new Date().toISOString() }),
    ];
    for (const m of messages) assert.equal((await withReply.send(m)).status, "sent");
    assert.deepEqual(
      calls.map((c) => c.reply_to?.email),
      ["support@appstackx.example", "support@appstackx.example", "support@appstackx.example"],
    );
    assert.equal(calls[0].reply_to?.name, SENDER_NAME);
    calls.length = 0;
    await mailerSendProvider({ MAILERSEND_FROM_EMAIL: "hello@clinforms.example" }, client).send(messages[0]);
    assert.equal(calls[0].reply_to, undefined);
    assert.throws(() => mailerSendProvider({ MAILERSEND_FROM_EMAIL: "hello@clinforms.example", CLINFORMS_EMAIL_REPLY_TO: "not an address" }, client), EmailConfigError);
    // the development provider shows it too (and is still the only one that prints a message)
    const printed = await capturedLogs(() => logProviderFor({ CLINFORMS_EMAIL_REPLY_TO: "support@appstackx.example" }).send(messages[2]));
    assert.match(printed, /reply-to=support@appstackx\.example/);
    assert.equal(createEmailProvider({ CLINFORMS_EMAIL_PROVIDER: "log", VERCEL_ENV: "preview" }).name, "none");
  });

  it("captureOutbox({ send: false }) records the message as withheld and never calls the provider", async () => {
    let sends = 0;
    setEmailProviderForTests({ name: "mailersend", send: async () => (sends++, { status: "sent", provider: "mailersend" }) });
    const held = await captureOutbox(() => deliverEmail(invite()), { send: false });
    assert.equal(sends, 0);
    assert.deepEqual(held.outbox[0].result, { status: "withheld", provider: "none" });
    assert.equal(linkToShare(held.outbox[0]), LINK);
    assert.equal(inviteDeliveryOf(held.outbox[0].result), "withheld");
    // the next capture sends again: the flag belongs to that one capture only
    const sent = await captureOutbox(() => deliverEmail(invite()));
    assert.equal(sends, 1);
    assert.equal(inviteDeliveryOf(sent.outbox[0].result), "sent");
    assert.equal(inviteDeliveryOf({ status: "not_sent", provider: "none" }), "off");
    assert.equal(inviteDeliveryOf({ status: "failed", provider: "mailersend" }), "failed");
    assert.equal(inviteDeliveryOf(undefined), "off");
  });

  it("a configuration mistake is a failed send (the link is shown), never a thrown error; nothing logged holds the link", async () => {
    const saved = { p: process.env.CLINFORMS_EMAIL_PROVIDER, k: process.env.MAILERSEND_API_KEY, f: process.env.MAILERSEND_FROM_EMAIL, r: process.env.CLINFORMS_EMAIL_REPLY_TO };
    try {
      process.env.CLINFORMS_EMAIL_PROVIDER = "mailersend";
      delete process.env.MAILERSEND_API_KEY;
      process.env.MAILERSEND_FROM_EMAIL = "hello@clinforms.example";
      let result: Awaited<ReturnType<typeof captureOutbox<unknown>>> | null = null;
      const logged = await capturedLogs(async () => {
        result = await captureOutbox(() => deliverEmail(invite()));
      });
      assert.deepEqual(result!.outbox[0].result, { status: "failed", provider: "mailersend" });
      assert.equal(linkToShare(result!.outbox[0]), LINK);
      assert.match(logged, /"event":"email.not_configured"/);
      assert.ok(!logged.includes("token") && !logged.includes("inv123"), "no link in the log line");
    } finally {
      for (const [name, value] of [["CLINFORMS_EMAIL_PROVIDER", saved.p], ["MAILERSEND_API_KEY", saved.k], ["MAILERSEND_FROM_EMAIL", saved.f], ["CLINFORMS_EMAIL_REPLY_TO", saved.r]] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("the sending providers log the kind and status only – never the address, the link or its token", async () => {
    const ok = mailerSendProvider({ MAILERSEND_FROM_EMAIL: "hello@clinforms.example" }, { email: { send: async () => ({}) } } as never);
    const failing = mailerSendProvider({ MAILERSEND_FROM_EMAIL: "hello@clinforms.example" }, { email: { send: async () => Promise.reject({ statusCode: 422, body: LINK }) } } as never);
    const logged = await capturedLogs(async () => {
      await ok.send(invite());
      await failing.send(invite());
      await createEmailProvider({}).send(invite()); // none
    });
    assert.match(logged, /"event":"email.sent"/);
    assert.match(logged, /"event":"email.failed"/);
    assert.match(logged, /"event":"email.not_sent"/);
    for (const secret of ["inv123", "token", "accept-invite", "new@clinic.example"]) assert.ok(!logged.includes(secret), secret);
  });
});
