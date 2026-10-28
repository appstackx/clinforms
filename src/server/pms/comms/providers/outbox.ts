/** The outbox provider (default): keeps the message in the outbox, sends nothing. */
import type { EmailProvider, SmsProvider } from "./types";

export const OUTBOX_PROVIDER_ID = "outbox";

export const outboxSms: SmsProvider = {
  id: OUTBOX_PROVIDER_ID,
  mode: "outbox",
  async send() {
    return { status: "outbox" };
  },
};

export const outboxEmail: EmailProvider = {
  id: OUTBOX_PROVIDER_ID,
  mode: "outbox",
  async send() {
    return { status: "outbox" };
  },
};
