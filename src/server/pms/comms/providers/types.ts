/**
 * Message providers (contract §11): the comms module hands texts and emails to a provider behind these
 * interfaces. Only two exist in this build, both safe:
 *
 *   outbox – the DEFAULT: nothing leaves the system; the message is kept in the outbox (status "outbox") and shown
 *            on the Messages screen as "In the outbox – not sent";
 *   test   – a test service in memory: it "accepts" messages (provider ids test_…), fails numbers ending 999 and
 *            addresses starting "bounce@" (so failures can be shown), and never contacts anyone.
 *
 * A real provider (a UK SMS gateway, a transactional email service) is added later as another implementation,
 * with the clinic's DPA in place and a key that is NOT kept in git.
 */
import type { SendOutcome } from "../../../repos/pms/comms/messages";

export type ProviderMode = "outbox" | "test";

export interface OutboundSms {
  messageId: string;
  /** E.164: "+447700900123". */
  to: string;
  /** Alphanumeric sender name, or null for the provider's number. */
  from: string | null;
  body: string;
}

export interface OutboundEmail {
  messageId: string;
  to: string;
  fromName: string;
  replyTo: string | null;
  subject: string;
  text: string;
  html: string;
  /** e.g. List-Unsubscribe and List-Unsubscribe-Post (RFC 8058). */
  headers: Readonly<Record<string, string>>;
}

export interface SmsProvider {
  readonly id: string;
  readonly mode: ProviderMode;
  send(message: OutboundSms): Promise<SendOutcome>;
}

export interface EmailProvider {
  readonly id: string;
  readonly mode: ProviderMode;
  send(message: OutboundEmail): Promise<SendOutcome>;
}

export interface CommsProviders {
  sms: SmsProvider;
  email: EmailProvider;
}

export class CommsConfigError extends Error {
  readonly code = "COMMS_NOT_CONFIGURED";
  constructor(message: string) {
    super(message);
    this.name = "CommsConfigError";
  }
}
