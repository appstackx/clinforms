/**
 * Stop-emails links ("unsubscribe"): every email to a patient carries one; a marketing email's stops marketing
 * emails, any other's stops appointment emails. The link holds a signed token – clinic, patient, channel, purpose
 * and an expiry – so it works without signing in and cannot be made up or changed.
 *
 * Key: derived from BETTER_AUTH_SECRET with its own label (HMAC-SHA256, "clinic-comms:stop-links:v1"), so no new
 * secret is needed and the sign-in secret itself is never used for anything else. Links last 400 days.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { MessageChannel, MessagePurpose } from "../../../modules/pms/comms/types";

type Env = Readonly<Record<string, string | undefined>>;

export const STOP_LINK_DAYS = 400;
export const STOP_LINK_PATH = "/api/clinic-messages/unsubscribe";

export interface StopLink {
  tenantId: string;
  patientId: string;
  channel: MessageChannel;
  purpose: MessagePurpose;
  /** Expiry, seconds since 1970. */
  exp: number;
}

/** The signing key for stop links (null when BETTER_AUTH_SECRET is missing or short – links are then left out). */
export function commsLinkSecret(env: Env = process.env): string | null {
  const base = env.BETTER_AUTH_SECRET;
  if (!base || base.length < 32) return null;
  return createHmac("sha256", base).update("clinic-comms:stop-links:v1").digest("base64url");
}

/** Where links in messages point (the app's public origin). */
export function commsLinkOrigin(env: Env = process.env): string {
  const raw = env.APP_ORIGIN || env.BETTER_AUTH_URL || `http://localhost:${env.PORT ?? "3180"}`;
  try {
    return new URL(raw).origin;
  } catch {
    return "http://localhost:3180";
  }
}

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(`v1.${body}`).digest("base64url");
}

export function signStopToken(link: Omit<StopLink, "exp">, secret: string, nowMs: number = Date.now()): string {
  const payload: StopLink = { ...link, exp: Math.floor(nowMs / 1000) + STOP_LINK_DAYS * 86_400 };
  const body = Buffer.from(JSON.stringify({ t: payload.tenantId, p: payload.patientId, c: payload.channel, u: payload.purpose, e: payload.exp }), "utf8").toString("base64url");
  return `v1.${body}.${sign(secret, body)}`;
}

/** The link's contents, or null when it is malformed, altered or expired. */
export function verifyStopToken(token: string | null | undefined, secret: string | null, nowMs: number = Date.now()): StopLink | null {
  if (!token || !secret || token.length > 600) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const expected = Buffer.from(sign(secret, parts[1]), "utf8");
  const given = Buffer.from(parts[2], "utf8");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const v = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
    const link: StopLink = { tenantId: String(v.t), patientId: String(v.p), channel: v.c as MessageChannel, purpose: v.u as MessagePurpose, exp: Number(v.e) };
    if (!["sms", "email"].includes(link.channel) || !["service", "marketing"].includes(link.purpose)) return null;
    if (!Number.isFinite(link.exp) || link.exp * 1000 < nowMs) return null;
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(link.tenantId) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(link.patientId)) return null;
    return link;
  } catch {
    return null;
  }
}

export function stopLinkUrl(origin: string, token: string): string {
  return `${origin}${STOP_LINK_PATH}?t=${encodeURIComponent(token)}`;
}
