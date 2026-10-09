import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { captureOutbox, deliverEmail, linkToShare, setEmailProviderForTests } from "./index";
import { mailerSendProvider, resolveEmailProviderName, SENDER_NAME } from "./providers";
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
