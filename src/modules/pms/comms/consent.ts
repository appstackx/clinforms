/**
 * Who may be sent what (pure). The preference flags live on the shared patient record (pms_patients):
 *
 * - Service messages (appointment confirmations, reminders, notices, messages staff write about the patient's
 *   care) go unless the patient said no for that channel (reminderSms / reminderEmail – on by default).
 * - Marketing (news, offers) only with a recorded opt-in for that channel (marketingSms / marketingEmail – never
 *   pre-ticked; PECR regulation 22). Every marketing email carries a stop-emails link and every marketing text
 *   "Reply STOP".
 * - Nobody is messaged once their record says they have died. Automatic messages skip archived records.
 * - Texts need a number that can receive them (a mobile), emails an address.
 */
import { isSmsCapable } from "./sms";
import type { MessageChannel, MessagePurpose, MessagingContact, SkipReason } from "./types";

/**
 * Messages that answer something the patient did or asked for (their booking's confirmation, a change the clinic
 * made to it, an invoice or receipt they are owed): by EMAIL these go even after the patient used the stop-emails
 * link, which stops reminder and follow-up emails (design round 3: "Stop reminder emails (booking confirmations will
 * still be sent)"). By TEXT, "STOP" means no texts at all.
 */
export const TRANSACTIONAL_KINDS: ReadonlySet<string> = new Set(["confirmation", "moved", "cancelled", "late_cancelled", "invoice", "receipt", "statement", "letter", "portal_link"]);

export function messageBlock(contact: MessagingContact, channel: MessageChannel, purpose: MessagePurpose, options: { automatic: boolean; kind?: string }): SkipReason | null {
  if (contact.status === "deceased") return "deceased";
  if (options.automatic && contact.status === "archived") return "archived";
  if (channel === "sms" && !isSmsCapable(contact.phoneMobile)) return "no_mobile";
  if (channel === "email" && !contact.email) return "no_email";
  if (purpose === "marketing") {
    const ok = channel === "sms" ? contact.marketingSms : contact.marketingEmail;
    return ok ? null : "no_marketing_consent";
  }
  if (channel === "email" && options.kind && TRANSACTIONAL_KINDS.has(options.kind)) return null;
  const ok = channel === "sms" ? contact.reminderSms : contact.reminderEmail;
  return ok ? null : "opted_out";
}

/** The name a message greets the patient by. */
export function greetingName(contact: Pick<MessagingContact, "firstName" | "preferredName">): string {
  return (contact.preferredName ?? "").trim() || contact.firstName;
}

/** Where a message to this contact goes on a channel (null when it cannot). */
export function addressFor(contact: Pick<MessagingContact, "phoneMobile" | "email">, channel: MessageChannel): string | null {
  return channel === "sms" ? (isSmsCapable(contact.phoneMobile) ? (contact.phoneMobile as string) : null) : contact.email;
}
