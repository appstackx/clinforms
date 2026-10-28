/**
 * The test provider: accepts messages in memory and never contacts anyone. Deterministic failures for showing
 * them: texts to numbers ending 999 ("07700 900999") and emails to addresses starting "bounce@". Tests read what
 * was "sent" from testOutbox (cleared with clearTestOutbox()).
 */
import { randomBytes } from "node:crypto";
import type { EmailProvider, OutboundEmail, OutboundSms, SmsProvider } from "./types";

export const TEST_PROVIDER_ID = "test";

export const testOutbox: { sms: OutboundSms[]; email: OutboundEmail[] } = { sms: [], email: [] };

export function clearTestOutbox(): void {
  testOutbox.sms.length = 0;
  testOutbox.email.length = 0;
}

const providerId = () => `test_${randomBytes(9).toString("base64url")}`;

export const testSms: SmsProvider = {
  id: TEST_PROVIDER_ID,
  mode: "test",
  async send(message) {
    if (/999$/.test(message.to)) return { status: "failed", errorCode: "test_undeliverable" };
    if (testOutbox.sms.length < 1000) testOutbox.sms.push(message);
    return { status: "sent", providerMessageId: providerId() };
  },
};

export const testEmail: EmailProvider = {
  id: TEST_PROVIDER_ID,
  mode: "test",
  async send(message) {
    if (/^bounce@/i.test(message.to)) return { status: "failed", errorCode: "test_bounced" };
    if (testOutbox.email.length < 1000) testOutbox.email.push(message);
    return { status: "sent", providerMessageId: providerId() };
  },
};
