/**
 * Transactional email for the identity layer (invitations, password resets, the two-step verification
 * notice). See docs/auth.md §Email.
 *
 * deliverEmail() sends through the configured provider (CLINFORMS_EMAIL_PROVIDER = mailersend | log | none)
 * and also records the message in the current "outbox capture", if one is open. Server actions that act for
 * an administrator open one with captureOutbox(): when email is off ("none") or a send failed, the action can
 * show the administrator the invitation or reset link to pass on. captureOutbox(fn, { send: false }) records the
 * messages WITHOUT sending them (status "withheld"): for a link that is only to be shown once to the person who
 * asked for it (a platform reset link).
 *
 * Links never go into a log line, an audit row or analytics: logAuthEvent() takes ids, codes and counts only, the
 * audit trail records invitationRef() (a one-way reference), and the analytics filter drops the query string of
 * /accept-invite and /reset-password. The `log` provider (development only, never on a Vercel deployment) is the
 * one exception: it prints the whole message so a developer can follow the link.
 */
import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { logAuthEvent } from "./log";
import { EmailConfigError, createEmailProvider, resolveEmailProviderName } from "./providers";
import type { DeliveryResult, EmailMessage, EmailProvider, EmailProviderName } from "./types";

export type { DeliveryResult, EmailKind, EmailMessage, EmailProviderName, EmailRecipient } from "./types";
export { EmailConfigError, resolveEmailProviderName } from "./providers";
export { invitationEmail, passwordResetEmail, twoFactorEnabledEmail } from "./templates";

export interface CapturedEmail {
  message: EmailMessage;
  result: DeliveryResult;
}

interface Outbox {
  items: CapturedEmail[];
  /** false: record only, never send. */
  send: boolean;
}

const outboxStorage = new AsyncLocalStorage<Outbox>();

let providerOverride: EmailProvider | null = null;

/** TESTS ONLY: send through this provider instead of the configured one (null restores). */
export function setEmailProviderForTests(provider: EmailProvider | null): void {
  providerOverride = provider;
}

export function emailProviderName(): EmailProviderName {
  return providerOverride?.name ?? resolveEmailProviderName();
}

function providerNameOrNone(): EmailProviderName {
  try {
    return emailProviderName();
  } catch {
    return "none";
  }
}

/** Addresses that can never receive mail (the platform's own system user uses one). */
function undeliverable(address: string): boolean {
  return /\.invalid$/i.test(address.trim());
}

export async function deliverEmail(message: EmailMessage): Promise<DeliveryResult> {
  const outbox = outboxStorage.getStore();
  let result: DeliveryResult;
  if (outbox && !outbox.send) {
    result = { status: "withheld", provider: "none" };
  } else if (undeliverable(message.to.email)) {
    result = { status: "not_sent", provider: providerNameOrNone() };
  } else {
    let provider: EmailProvider | null = providerOverride;
    try {
      provider ??= createEmailProvider();
    } catch (err) {
      // A configuration mistake (e.g. a missing key or a malformed CLINFORMS_EMAIL_REPLY_TO) must not fail the action
      // that sends – the clinic or invitation already exists: report "failed", so the link is shown to pass on.
      if (!(err instanceof EmailConfigError)) throw err;
      logAuthEvent("email.not_configured", { kind: message.kind });
    }
    result = provider ? await provider.send(message) : { status: "failed", provider: providerNameOrNone() };
  }
  outbox?.items.push({ message, result });
  return result;
}

/**
 * Runs `fn` and returns what it tried to send (and how each send went). With `send: false` nothing is sent: every
 * message is only recorded, as "withheld".
 */
export async function captureOutbox<T>(fn: () => Promise<T>, options: { send?: boolean } = {}): Promise<{ result: T; outbox: CapturedEmail[] }> {
  const outbox: Outbox = { items: [], send: options.send ?? true };
  const result = await outboxStorage.run(outbox, fn);
  return { result, outbox: outbox.items };
}

/** The link an administrator should pass on by hand: email is off, the send did not go through, or it was withheld. */
export function linkToShare(captured: CapturedEmail | undefined): string | null {
  if (!captured?.message.link) return null;
  return captured.result.status === "sent" ? null : captured.message.link;
}

/** How an invitation went, as the screens say it (src/lib/account-copy.ts INVITE_COPY). */
export function inviteDeliveryOf(result: DeliveryResult | undefined): "sent" | "failed" | "off" | "withheld" {
  if (!result) return "off";
  if (result.status === "not_sent") return "off";
  return result.status;
}
