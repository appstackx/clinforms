/**
 * Transactional email for the identity layer (invitations, password resets, the two-step verification
 * notice). See docs/auth.md §Email.
 *
 * deliverEmail() sends through the configured provider (CLINFORMS_EMAIL_PROVIDER = mailersend | log | none)
 * and also records the message in the current "outbox capture", if one is open. Server actions that act for
 * an administrator open one with captureOutbox(): when email is off ("none") or a send failed, the action can
 * show the administrator the invitation or reset link to pass on.
 */
import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createEmailProvider, resolveEmailProviderName } from "./providers";
import type { DeliveryResult, EmailMessage, EmailProvider, EmailProviderName } from "./types";

export type { DeliveryResult, EmailKind, EmailMessage, EmailProviderName, EmailRecipient } from "./types";
export { EmailConfigError, resolveEmailProviderName } from "./providers";
export { invitationEmail, passwordResetEmail, twoFactorEnabledEmail } from "./templates";

export interface CapturedEmail {
  message: EmailMessage;
  result: DeliveryResult;
}

const outboxStorage = new AsyncLocalStorage<CapturedEmail[]>();

let providerOverride: EmailProvider | null = null;

/** TESTS ONLY: send through this provider instead of the configured one (null restores). */
export function setEmailProviderForTests(provider: EmailProvider | null): void {
  providerOverride = provider;
}

export function emailProviderName(): EmailProviderName {
  return providerOverride?.name ?? resolveEmailProviderName();
}

/** Addresses that can never receive mail (the platform's own system user uses one). */
function undeliverable(address: string): boolean {
  return /\.invalid$/i.test(address.trim());
}

export async function deliverEmail(message: EmailMessage): Promise<DeliveryResult> {
  let result: DeliveryResult;
  if (undeliverable(message.to.email)) {
    result = { status: "not_sent", provider: emailProviderName() };
  } else {
    const provider = providerOverride ?? createEmailProvider();
    result = await provider.send(message);
  }
  outboxStorage.getStore()?.push({ message, result });
  return result;
}

/** Runs `fn` and returns what it tried to send (and how each send went). */
export async function captureOutbox<T>(fn: () => Promise<T>): Promise<{ result: T; outbox: CapturedEmail[] }> {
  const outbox: CapturedEmail[] = [];
  const result = await outboxStorage.run(outbox, fn);
  return { result, outbox };
}

/** The link an administrator should pass on by hand: email is off, or the send did not go through. */
export function linkToShare(captured: CapturedEmail | undefined): string | null {
  if (!captured?.message.link) return null;
  return captured.result.status === "sent" ? null : captured.message.link;
}
