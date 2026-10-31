/**
 * Which providers send texts and emails (env, read per call so tests can switch):
 *
 *   CLINIC_SMS_PROVIDER   = outbox (default) | test | mailpit | smsworks (LIVE texts – The SMS Works, ./smsworks.ts;
 *                           only with SMSWORKS_API_KEY set: without the key texts stay in the OUTBOX)
 *   CLINIC_EMAIL_PROVIDER = outbox (default) | test | mailpit
 *
 * mailpit is LOCAL TESTING ONLY (./mailpit.ts): messages go to a local Mailpit inbox (MAILPIT_URL, default
 * http://localhost:8026). It is refused (CommsConfigError) on any Vercel environment, and with NODE_ENV=production
 * unless MAILPIT_URL points at localhost / 127.0.0.1.
 *
 * Anything else is refused (CommsConfigError). A live-looking key in
 * CLINIC_SMS_API_KEY / CLINIC_EMAIL_API_KEY (anything not starting "test_") is refused too, so a real key can
 * never be used by accident. The test provider is refused on a production deployment (VERCEL_ENV=production)
 * unless CLINIC_ALLOW_TEST_PROVIDER=1, so production stays on the outbox.
 */
import { mailpitEmailProvider, mailpitSmsProvider } from "./mailpit";
import { outboxEmail, outboxSms } from "./outbox";
import { testEmail, testSms } from "./test";
import { createSmsWorks, smsWorksConfig } from "./smsworks";
import { commsLinkOrigin } from "../links";
import { CommsConfigError, type CommsProviders, type EmailProvider, type ProviderMode, type SmsProvider } from "./types";

export { CommsConfigError } from "./types";
export type { CommsProviders, EmailProvider, OutboundEmail, OutboundSms, ProviderMode, SmsProvider } from "./types";

type Env = Readonly<Record<string, string | undefined>>;

const KEY_NAMES = ["CLINIC_SMS_API_KEY", "CLINIC_EMAIL_API_KEY"] as const;

/** Refuses any key that does not look like a test key. */
export function assertNoLiveKeys(env: Env = process.env): void {
  for (const name of KEY_NAMES) {
    const value = env[name];
    if (value && !/^test_/.test(value.trim())) throw new CommsConfigError(`${name} does not look like a test key: live keys are refused in this build.`);
  }
}

function pick(name: string, env: Env): ProviderMode {
  const raw = (env[name] ?? "").trim().toLowerCase();
  if (!raw || raw === "outbox") return "outbox";
  // The SMS Works: texts only, and only with its key – else the outbox (nothing sent, nothing charged).
  if (raw === "smsworks" && name === "CLINIC_SMS_PROVIDER") return smsWorksConfig(env) ? "live" : "outbox";
  if (raw === "test") {
    if (env.VERCEL_ENV === "production" && env.CLINIC_ALLOW_TEST_PROVIDER !== "1") throw new CommsConfigError(`${name}=test is refused on production (use the outbox).`);
    return "test";
  }
  if (raw === "mailpit") return "mailpit"; // refused outside local runs when the provider is built (./mailpit.ts)
  throw new CommsConfigError(`${name} must be outbox${name === "CLINIC_SMS_PROVIDER" ? ", smsworks" : ""} or test (or mailpit, local only) (got "${raw.slice(0, 20)}").`);
}

export function resolveCommsProviders(env: Env = process.env): CommsProviders {
  assertNoLiveKeys(env);
  const smsMode = pick("CLINIC_SMS_PROVIDER", env);
  const emailMode = pick("CLINIC_EMAIL_PROVIDER", env);
  const live = smsMode === "live" ? smsWorksConfig(env, commsLinkOrigin(env)) : null;
  const sms: SmsProvider = live ? createSmsWorks(live) : smsMode === "test" ? testSms : smsMode === "mailpit" ? mailpitSmsProvider(env) : outboxSms;
  const email: EmailProvider = emailMode === "test" ? testEmail : emailMode === "mailpit" ? mailpitEmailProvider(env) : outboxEmail;
  return { sms, email };
}

/** For the screens: what happens to messages right now ("outbox", "test", "mailpit" or a configuration problem). */
export function providerStatus(env: Env = process.env): { sms: ProviderMode | "misconfigured"; email: ProviderMode | "misconfigured" } {
  try {
    const p = resolveCommsProviders(env);
    return { sms: p.sms.mode, email: p.email.mode };
  } catch {
    return { sms: "misconfigured", email: "misconfigured" };
  }
}
