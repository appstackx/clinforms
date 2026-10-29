/**
 * Links that act as a key (a portal sign-in link, a "manage this booking" link) go to the patient only (M10 C1).
 * The provider gets the email with the real link; the copy kept in the message log (and shown on the outbox, the
 * record's Messages tab and reply threads) has the link replaced by HIDDEN_LINK. Only the link's hash is stored
 * (src/server/pms/portal/tokens.ts), so nobody at the clinic can sign in as the patient from Messages.
 *
 * `redactSecretLinks` is also applied when a stored text is shown, so copies written before this change are hidden
 * too. Pure – no server imports.
 */

/** What staff see in place of a sign-in or manage link. */
export const HIDDEN_LINK = "[Sign-in link – only in the email sent to the patient]";

/** A clinic public link whose last part is a 43-character secret (portal sign-in, manage booking), with its query. */
const SECRET_LINK = /(?:https?:\/\/[^\s/]+)?\/clinics\/[^\s/]+\/(?:portal\/link|booking)\/[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])(?:\/[^\s?]*)?(?:\?[^\s]*)?/g;

/** The text with every secret link (and each value of `secrets`) replaced by HIDDEN_LINK. */
export function redactSecretLinks(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join(HIDDEN_LINK);
  return out.replace(SECRET_LINK, HIDDEN_LINK);
}

/** True when the text still holds a link secret (for tests and guards). */
export function hasSecretLink(text: string | null | undefined): boolean {
  if (!text) return false;
  return new RegExp(SECRET_LINK.source).test(text);
}

/** Kinds whose stored copy has a hidden link – never sent again from the log (the patient asks for a new link). */
export function canResendKind(kind: string): boolean {
  return kind !== "portal_link";
}

export const NO_RESEND_MESSAGE = "A sign-in email cannot be sent again – the patient can ask for a new link, or staff can send the form again.";
