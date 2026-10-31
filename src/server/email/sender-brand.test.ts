/**
 * Sender per brand (31/10/2026): the clinic brand's messages come from MAILERSEND_FROM_EMAIL_CLINIC with the clinic
 * brand's name ONLY when that variable is set; without it every message comes from the current sender, unchanged.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BRANDS } from "../../lib/brand";
import { CLINIC_BRAND_FROM_VAR, EmailConfigError, SENDER_NAME, mailerSendProvider, mailpitProviderFor, senderFor } from "./providers";
import { invitationEmail } from "./templates";

const invite = (brand?: "clinforms" | "clinic") =>
  invitationEmail({ to: { email: "new@riverside.example" }, clinicName: "Riverside (fictional)", role: "staff", link: "https://x.example/accept-invite?token=t", expiresAt: new Date().toISOString(), brand });

describe("email sender per brand", () => {
  it("default: the current sender for every brand", () => {
    assert.equal(CLINIC_BRAND_FROM_VAR, "MAILERSEND_FROM_EMAIL_CLINIC");
    assert.deepEqual(senderFor(invite(), "no-reply@clinforms.co.uk", {}), { email: "no-reply@clinforms.co.uk", name: SENDER_NAME });
    assert.deepEqual(senderFor(invite("clinic"), "no-reply@clinforms.co.uk", {}), { email: "no-reply@clinforms.co.uk", name: SENDER_NAME });
  });

  it("with MAILERSEND_FROM_EMAIL_CLINIC: the clinic brand's messages only", () => {
    const env = { MAILERSEND_FROM_EMAIL_CLINIC: " no-reply@clindesk.co.uk " };
    assert.deepEqual(senderFor(invite("clinic"), "no-reply@clinforms.co.uk", env), { email: "no-reply@clindesk.co.uk", name: BRANDS.clinic.productName });
    assert.deepEqual(senderFor(invite(), "no-reply@clinforms.co.uk", env), { email: "no-reply@clinforms.co.uk", name: SENDER_NAME });
    assert.throws(() => senderFor(invite("clinic"), "x@y.example", { MAILERSEND_FROM_EMAIL_CLINIC: "not an address" }), EmailConfigError);
  });

  it("MailerSend sends from the brand's sender (reply-to name too); a malformed value fails the send, never throws", async () => {
    const calls: { from: { email: string; name: string }; reply_to?: { email: string; name?: string } }[] = [];
    const client = { email: { send: async (p: unknown) => (calls.push(p as never), {}) } } as never;
    const env = { MAILERSEND_FROM_EMAIL: "no-reply@clinforms.co.uk", MAILERSEND_FROM_EMAIL_CLINIC: "no-reply@clindesk.co.uk", CLINFORMS_EMAIL_REPLY_TO: "khuram@appstackx.example" };
    const provider = mailerSendProvider(env, client);
    assert.equal((await provider.send(invite("clinic"))).status, "sent");
    assert.equal((await provider.send(invite())).status, "sent");
    assert.deepEqual({ ...calls[0].from }, { email: "no-reply@clindesk.co.uk", name: BRANDS.clinic.productName });
    assert.equal(calls[0].reply_to?.name, BRANDS.clinic.productName);
    assert.deepEqual({ ...calls[1].from }, { email: "no-reply@clinforms.co.uk", name: SENDER_NAME });
    assert.equal(calls[1].reply_to?.name, SENDER_NAME);
    const bad = mailerSendProvider({ MAILERSEND_FROM_EMAIL: "no-reply@clinforms.co.uk", MAILERSEND_FROM_EMAIL_CLINIC: "nope" }, client);
    assert.deepEqual(await bad.send(invite("clinic")), { status: "failed", provider: "mailersend" });
    assert.equal((await bad.send(invite())).status, "sent", "ClinForms' messages are not affected by the clinic brand's setting");
  });

  it("Mailpit (local) follows the same rule", async () => {
    const bodies: { From: { Email: string; Name: string } }[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ID: "x" }), { status: 200 });
    }) as typeof fetch;
    const provider = mailpitProviderFor({ MAILPIT_URL: "http://localhost:8026", MAILERSEND_FROM_EMAIL_CLINIC: "no-reply@clinic.localhost.example" }, fetchImpl);
    await provider.send(invite("clinic"));
    await provider.send(invite());
    assert.deepEqual(bodies[0].From, { Email: "no-reply@clinic.localhost.example", Name: BRANDS.clinic.productName });
    assert.equal(bodies[1].From.Name, SENDER_NAME);
  });
});
