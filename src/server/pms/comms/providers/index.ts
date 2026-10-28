/**
 * Which providers send texts and emails (env, read per call so tests can switch):
 *
 *   CLINIC_SMS_PROVIDER   = outbox (default) | test
 *   CLINIC_EMAIL_PROVIDER = outbox (default) | test
 *
 * Anything else is refused (CommsConfigError) – there is no live provider in this build. A live-looking key in
 * CLINIC_SMS_API_KEY / CLINIC_EMAIL_API_KEY (anything not starting "test_") is refused too, so a real key can
 * never be used by accident. The test provider is refused on a production deployment (VERCEL_ENV=production)
 * unless CLINIC_ALLOW_TEST_PROVIDER=1, so production stays on the outbox.
 */
import { outboxEmail, outboxSms } from "./outbox";
import { testEmail, testSms } from "./test";
import { CommsConfigError, type CommsProviders, type EmailProvider, type SmsProvider } from "./types";

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

function pick(name: string, env: Env): "outbox" | "test" {
  const raw = (env[name] ?? "").trim().toLowerCase();
  if (!raw || raw === "outbox") return "outbox";
  if (raw === "test") {
    if (env.VERCEL_ENV === "production" && env.CLINIC_ALLOW_TEST_PROVIDER !== "1") throw new CommsConfigError(`${name}=test is refused on production (use the outbox).`);
    return "test";
  }
  throw new CommsConfigError(`${name} must be outbox or test (got "${raw.slice(0, 20)}").`);
}

export function resolveCommsProviders(env: Env = process.env): CommsProviders {
  assertNoLiveKeys(env);
  const sms: SmsProvider = pick("CLINIC_SMS_PROVIDER", env) === "test" ? testSms : outboxSms;
  const email: EmailProvider = pick("CLINIC_EMAIL_PROVIDER", env) === "test" ? testEmail : outboxEmail;
  return { sms, email };
}

/** For the screens: what happens to messages right now ("outbox", "test" or a configuration problem). */
export function providerStatus(env: Env = process.env): { sms: "outbox" | "test" | "misconfigured"; email: "outbox" | "test" | "misconfigured" } {
  try {
    const p = resolveCommsProviders(env);
    return { sms: p.sms.mode, email: p.email.mode };
  } catch {
    return { sms: "misconfigured", email: "misconfigured" };
  }
}
