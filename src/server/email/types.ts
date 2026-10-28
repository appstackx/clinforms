/** Transactional email: message and provider types (src/server/email). */

export type EmailKind = "invitation" | "password_reset" | "two_factor_enabled";

export type EmailProviderName = "mailersend" | "log" | "none";

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
