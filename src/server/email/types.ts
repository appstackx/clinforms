/** Transactional email: message and provider types (src/server/email). */
import type { BrandId } from "../../lib/brand";

export type EmailKind = "invitation" | "password_reset" | "two_factor_enabled";

export type EmailProviderName = "mailersend" | "log" | "mailpit" | "none";

export interface EmailRecipient {
  email: string;
  name?: string | null;
}

export interface EmailMessage {
  kind: EmailKind;
  to: EmailRecipient;
  subject: string;
  /** Plain-text body. */
  text: string;
  /** HTML body (every dynamic value escaped). */
  html: string;
  /** The action link in the message (invitation / reset), so an admin can be shown it when email is off. */
  link?: string;
  /** When the link stops working (ISO). */
  linkExpiresAt?: string;
  /**
   * The brand the message speaks for, when it is not ClinForms ("clinic": a clinic with the clinic package). The
   * sender follows it only when that brand's own sender address is configured (providers.ts senderFor).
   */
  brand?: BrandId;
}

export interface DeliveryResult {
  /**
   * sent – handed to the provider (or printed by `log`); not_sent – email is off (`none`) or the address can never
   * receive mail; failed – the provider refused it; withheld – not sent on purpose: the caller only wanted the link
   * (captureOutbox with send: false, e.g. the admin script, or a platform reset link).
   */
  status: "sent" | "not_sent" | "failed" | "withheld";
  provider: EmailProviderName;
}

export interface EmailProvider {
  readonly name: EmailProviderName;
  send(message: EmailMessage): Promise<DeliveryResult>;
}
