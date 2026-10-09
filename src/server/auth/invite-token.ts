/**
 * Invitation links. The link token is `<invitation id>.<MAC>`, where the MAC is an HMAC-SHA256 of the
 * invitation id under a key derived from BETTER_AUTH_SECRET. An invitation id on its own is NOT enough to
 * accept an invitation: ids are visible to Better Auth's own code paths and to the clinic's managers, so they
 * must never act as a bearer secret. Nothing is stored – the server can rebuild a pending invitation's link
 * (Settings → Members "Copy link") and check one, and rotating BETTER_AUTH_SECRET invalidates open links.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const LABEL = "clinforms:invite-link:v1";
/** Better Auth ids (and the platform's authId()) are 32 alphanumerics; accept a little more, nothing odd. */
const INVITATION_ID = /^[A-Za-z0-9_-]{8,128}$/;
/** base64url of a 32-byte HMAC, unpadded. */
const MAC = /^[A-Za-z0-9_-]{43}$/;

function macOf(secret: string, invitationId: string): string {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("The invitation-link secret must be 32+ characters.");
  const key = createHmac("sha256", secret).update(LABEL, "utf8").digest();
  return createHmac("sha256", key).update(invitationId, "utf8").digest("base64url");
}

/** The token that goes into an invitation link for this invitation. */
export function inviteToken(secret: string, invitationId: string): string {
  if (!INVITATION_ID.test(invitationId)) throw new Error("Not an invitation id.");
  return `${invitationId}.${macOf(secret, invitationId)}`;
}

/** The invitation id a link token vouches for, or null when the token is malformed or its MAC is wrong. */
export function invitationIdFromToken(secret: string, token: unknown): string | null {
  if (typeof token !== "string" || token.length > 200) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const id = token.slice(0, dot);
  const given = token.slice(dot + 1);
  if (!INVITATION_ID.test(id) || !MAC.test(given)) return null;
  const expected = Buffer.from(macOf(secret, id), "utf8");
  const got = Buffer.from(given, "utf8");
  return expected.length === got.length && timingSafeEqual(expected, got) ? id : null;
}

/** The full invitation link (`<origin>/accept-invite?token=…`). */
export function inviteLink(appOrigin: string, invitationId: string, secret: string): string {
  return `${appOrigin.replace(/\/+$/, "")}/accept-invite?token=${encodeURIComponent(inviteToken(secret, invitationId))}`;
}
