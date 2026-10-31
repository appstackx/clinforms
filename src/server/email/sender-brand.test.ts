/**
 * Sender per brand (31/10/2026): the clinic brand's (ClinDesk's) messages go through its OWN MailerSend account – its
 * API key, sender address and reply-to, as "ClinDesk" – only when both MAILERSEND_API_KEY_CLINIC and
 * MAILERSEND_FROM_EMAIL_CLINIC are set. One without the other never half-switches: ClinForms' account and sender,
 * logged once. ClinForms' messages are unchanged whatever the clinic brand's settings. Mailpit (local, no account)
 * follows MAILERSEND_FROM_EMAIL_CLINIC alone.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { BRANDS } from "../../lib/brand";
import {
  CLINIC_BRAND_FROM_VAR,
  CLINIC_BRAND_KEY_VAR,
  CLINIC_BRAND_REPLY_TO_VAR,
  EmailConfigError,
  NO_TRACKING,
  SENDER_NAME,
  clinicMailAccount,
  mailerSendProvider,
  mailpitProviderFor,
  resetClinicAccountLogForTests,
  senderFor,
} from "./providers";
import { invitationEmail } from "./templates";

const invite = (brand?: "clinforms" | "clinic") =>
  invitationEmail({ to: { email: "new@riverside.example" }, clinicName: "Riverside (fictional)", role: "staff", link: "https://x.example/accept-invite?token=t", expiresAt: new Date().toISOString(), brand });

interface SentParams {
  from: { email: string; name: string };
  reply_to?: { email: string; name?: string };
  settings?: Record<string, unknown>;
}

function recordingClient() {
  const calls: SentParams[] = [];
  const client = { email: { send: async (p: unknown) => (calls.push(p as SentParams), {}) } } as never;
  return { calls, client };
}

async function capturedLogs(fn: () => Promise<unknown> | unknown): Promise<string> {
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

const CLINFORMS_ENV = { MAILERSEND_API_KEY: "mlsn.clinforms-key", MAILERSEND_FROM_EMAIL: "no-reply@clinforms.co.uk", CLINFORMS_EMAIL_REPLY_TO: "khuram@appstackx.example" };
const CLINIC_ENV = {
  ...CLINFORMS_ENV,
  MAILERSEND_API_KEY_CLINIC: " mlsn.clindesk-key ",
  MAILERSEND_FROM_EMAIL_CLINIC: " no-reply@clindesk.co.uk ",
  CLINFORMS_EMAIL_REPLY_TO_CLINIC: "hello@clindesk.co.uk",
};

describe("email sender per brand", () => {
  beforeEach(() => resetClinicAccountLogForTests());

  it("variable names", () => {
    assert.equal(CLINIC_BRAND_KEY_VAR, "MAILERSEND_API_KEY_CLINIC");
    assert.equal(CLINIC_BRAND_FROM_VAR, "MAILERSEND_FROM_EMAIL_CLINIC");
    assert.equal(CLINIC_BRAND_REPLY_TO_VAR, "CLINFORMS_EMAIL_REPLY_TO_CLINIC");
    assert.equal(BRANDS.clinic.productName, "ClinDesk");
  });

  it("clinicMailAccount: key, sender and reply-to only when key AND from are set", () => {
    assert.deepEqual(clinicMailAccount("khuram@appstackx.example", CLINIC_ENV), {
      apiKey: "mlsn.clindesk-key",
      sender: { email: "no-reply@clindesk.co.uk", name: "ClinDesk" },
      replyTo: "hello@clindesk.co.uk",
    });
    // no clinic reply-to: replies go where ClinForms' do (as before)
    const { CLINFORMS_EMAIL_REPLY_TO_CLINIC: _r, ...noReply } = CLINIC_ENV;
    assert.equal(clinicMailAccount("khuram@appstackx.example", noReply)?.replyTo, "khuram@appstackx.example");
    assert.equal(clinicMailAccount(null, noReply)?.replyTo, null);
    assert.equal(clinicMailAccount(null, CLINFORMS_ENV), null);
    assert.equal(clinicMailAccount(null, { ...CLINFORMS_ENV, MAILERSEND_API_KEY_CLINIC: "mlsn.k" }), null);
    assert.equal(clinicMailAccount(null, { ...CLINFORMS_ENV, MAILERSEND_FROM_EMAIL_CLINIC: "no-reply@clindesk.co.uk" }), null);
    assert.equal(clinicMailAccount(null, { ...CLINFORMS_ENV, MAILERSEND_API_KEY_CLINIC: "  ", MAILERSEND_FROM_EMAIL_CLINIC: "no-reply@clindesk.co.uk" }), null);
  });

  it("clinicMailAccount: malformed addresses are configuration errors that never echo the value or the key", () => {
    for (const bad of [{ MAILERSEND_FROM_EMAIL_CLINIC: "not an address" }, { CLINFORMS_EMAIL_REPLY_TO_CLINIC: "a@b.example, c@d.example" }]) {
      const value = Object.values(bad)[0];
      assert.throws(
        () => clinicMailAccount(null, { ...CLINIC_ENV, ...bad }),
        (err: unknown) => err instanceof EmailConfigError && !err.message.includes(value) && !err.message.includes("clindesk-key"),
      );
    }
  });

  it("MailerSend, both set: clinic brand → the clinic account, ClinDesk sender and reply-to; ClinForms unchanged; tracking off", async () => {
    const cf = recordingClient();
    const cd = recordingClient();
    const provider = mailerSendProvider(CLINIC_ENV, cf.client, { clinicClient: cd.client });
    assert.deepEqual(await provider.send(invite("clinic")), { status: "sent", provider: "mailersend" });
    assert.deepEqual(await provider.send(invite()), { status: "sent", provider: "mailersend" });
    assert.deepEqual(await provider.send(invite("clinforms")), { status: "sent", provider: "mailersend" });
    assert.equal(cd.calls.length, 1, "only the clinic brand's message goes through the clinic account");
    assert.equal(cf.calls.length, 2);
    assert.deepEqual({ ...cd.calls[0].from }, { email: "no-reply@clindesk.co.uk", name: "ClinDesk" });
    assert.deepEqual({ ...cd.calls[0].reply_to }, { email: "hello@clindesk.co.uk", name: "ClinDesk" });
    for (const call of cf.calls) {
      assert.deepEqual({ ...call.from }, { email: "no-reply@clinforms.co.uk", name: SENDER_NAME });
      assert.deepEqual({ ...call.reply_to }, { email: "khuram@appstackx.example", name: SENDER_NAME });
    }
    for (const call of [...cd.calls, ...cf.calls]) assert.deepEqual(call.settings, { ...NO_TRACKING });
  });

  it("MailerSend, neither set: every brand through ClinForms' account and sender, nothing logged", async () => {
    const cf = recordingClient();
    const cd = recordingClient();
    const logs = await capturedLogs(async () => {
      const provider = mailerSendProvider(CLINFORMS_ENV, cf.client, { clinicClient: cd.client });
      await provider.send(invite("clinic"));
      await provider.send(invite());
    });
    assert.equal(cd.calls.length, 0);
    assert.equal(cf.calls.length, 2);
    for (const call of cf.calls) assert.deepEqual({ ...call.from }, { email: "no-reply@clinforms.co.uk", name: SENDER_NAME });
    assert.doesNotMatch(logs, /clinic_account_incomplete/);
  });

  for (const [label, partial, missing] of [
    ["key only", { MAILERSEND_API_KEY_CLINIC: "mlsn.clindesk-key" }, "MAILERSEND_FROM_EMAIL_CLINIC"],
    ["from only", { MAILERSEND_FROM_EMAIL_CLINIC: "no-reply@clindesk.co.uk" }, "MAILERSEND_API_KEY_CLINIC"],
  ] as const) {
    it(`MailerSend, ${label}: no half-switch – ClinForms' account, sender and reply-to; logged once, without the key`, async () => {
      const cf = recordingClient();
      const cd = recordingClient();
      const logs = await capturedLogs(async () => {
        for (let i = 0; i < 3; i++) {
          // a provider per send, as deliverEmail builds them: still one line per process
          const provider = mailerSendProvider({ ...CLINFORMS_ENV, ...partial, CLINFORMS_EMAIL_REPLY_TO_CLINIC: "hello@clindesk.co.uk" }, cf.client, { clinicClient: cd.client });
          assert.equal((await provider.send(invite("clinic"))).status, "sent");
        }
      });
      assert.equal(cd.calls.length, 0);
      assert.equal(cf.calls.length, 3);
      for (const call of cf.calls) {
        assert.deepEqual({ ...call.from }, { email: "no-reply@clinforms.co.uk", name: SENDER_NAME });
        assert.deepEqual({ ...call.reply_to }, { email: "khuram@appstackx.example", name: SENDER_NAME });
      }
      const lines = logs.split("\n").filter((l) => l.includes("clinic_account_incomplete"));
      assert.equal(lines.length, 1);
      assert.equal(JSON.parse(lines[0]).missing, missing);
      assert.doesNotMatch(logs, /mlsn\./, "the key is never logged");
    });
  }

  it("MailerSend, both set but a malformed clinic address: only the clinic brand's sends fail (reported, not thrown)", async () => {
    const cf = recordingClient();
    const cd = recordingClient();
    for (const bad of [{ MAILERSEND_FROM_EMAIL_CLINIC: "nope" }, { CLINFORMS_EMAIL_REPLY_TO_CLINIC: "nope" }]) {
      const logs = await capturedLogs(async () => {
        const provider = mailerSendProvider({ ...CLINIC_ENV, ...bad }, cf.client, { clinicClient: cd.client });
        assert.deepEqual(await provider.send(invite("clinic")), { status: "failed", provider: "mailersend" });
        assert.equal((await provider.send(invite())).status, "sent", "ClinForms' messages are not affected by the clinic brand's settings");
      });
      assert.doesNotMatch(logs, /mlsn\.|nope/);
    }
    assert.equal(cd.calls.length, 0);
  });

  it("senderFor (no account): the clinic brand's from address alone", () => {
    assert.deepEqual(senderFor(invite("clinic"), "no-reply@clinforms.co.uk", {}), { email: "no-reply@clinforms.co.uk", name: SENDER_NAME });
    const env = { MAILERSEND_FROM_EMAIL_CLINIC: " no-reply@clindesk.co.uk " };
    assert.deepEqual(senderFor(invite("clinic"), "no-reply@clinforms.co.uk", env), { email: "no-reply@clindesk.co.uk", name: BRANDS.clinic.productName });
    assert.deepEqual(senderFor(invite(), "no-reply@clinforms.co.uk", env), { email: "no-reply@clinforms.co.uk", name: SENDER_NAME });
    assert.throws(() => senderFor(invite("clinic"), "x@y.example", { MAILERSEND_FROM_EMAIL_CLINIC: "not an address" }), EmailConfigError);
  });

  it("Mailpit (local) follows MAILERSEND_FROM_EMAIL_CLINIC, with the clinic reply-to", async () => {
    const bodies: { From: { Email: string; Name: string }; ReplyTo?: { Email: string; Name: string }[] }[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ID: "x" }), { status: 200 });
    }) as typeof fetch;
    const provider = mailpitProviderFor(
      { MAILPIT_URL: "http://localhost:8026", MAILERSEND_FROM_EMAIL_CLINIC: "no-reply@clinic.localhost.example", CLINFORMS_EMAIL_REPLY_TO: "help@clinforms.example", CLINFORMS_EMAIL_REPLY_TO_CLINIC: "hello@clinic.localhost.example" },
      fetchImpl,
    );
    await provider.send(invite("clinic"));
    await provider.send(invite());
    assert.deepEqual(bodies[0].From, { Email: "no-reply@clinic.localhost.example", Name: BRANDS.clinic.productName });
    assert.deepEqual(bodies[0].ReplyTo, [{ Email: "hello@clinic.localhost.example", Name: BRANDS.clinic.productName }]);
    assert.equal(bodies[1].From.Name, SENDER_NAME);
    assert.deepEqual(bodies[1].ReplyTo, [{ Email: "help@clinforms.example", Name: SENDER_NAME }]);
  });
});
