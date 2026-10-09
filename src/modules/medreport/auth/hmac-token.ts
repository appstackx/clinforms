import "server-only";

/**
 * Compact HMAC-SHA256 tokens: `v1.<base64url(JSON payload)>.<base64url(HMAC)>`.
 * The payload carries a `typ` so a launch token can never be used as a session token (or vice versa).
 * Expiry (`exp`, seconds since epoch) is enforced on verify.
 *
 * Owner: integration agent. (Implemented by the foundation.)
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { z } from "zod";

export type TokenType = "medreport.launch" | "medreport.session";

export type TokenFailureReason = "malformed" | "bad_signature" | "wrong_type" | "expired" | "invalid_claims";

export type TokenVerifyResult<T> = { ok: true; claims: T } | { ok: false; reason: TokenFailureReason };

const VERSION = "v1";

export function base64UrlEncode(input: string | Uint8Array): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  return buf.toString("base64url");
}

export function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

function mac(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data, "utf8").digest();
}

/** Sign `{typ, ...claims}`. Claims must already include `iat`/`exp`. */
export function signHmacToken(typ: TokenType, claims: object, secret: string): string {
  const body = `${VERSION}.${base64UrlEncode(JSON.stringify({ typ, ...claims }))}`;
  return `${body}.${base64UrlEncode(mac(secret, body))}`;
}

/** Verify signature, type, expiry and claim shape (schema). `typ` is stripped from the returned claims. */
export function verifyHmacToken<T>(
  token: string,
  typ: TokenType,
  secret: string,
  schema: z.ZodType<T>,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): TokenVerifyResult<T> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION || !parts[1] || !parts[2]) return { ok: false, reason: "malformed" };
  const body = `${parts[0]}.${parts[1]}`;
  const expected = mac(secret, body);
  let given: Buffer;
  try {
    given = base64UrlDecode(parts[2]);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "bad_signature" };

  let payload: unknown;
  try {
    payload = JSON.parse(base64UrlDecode(parts[1]).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof payload !== "object" || payload === null) return { ok: false, reason: "malformed" };
  const { typ: payloadTyp, ...rest } = payload as Record<string, unknown>;
  if (payloadTyp !== typ) return { ok: false, reason: "wrong_type" };
  const parsed = schema.safeParse(rest);
  if (!parsed.success) return { ok: false, reason: "invalid_claims" };
  const exp = (rest as { exp?: unknown }).exp;
  if (typeof exp !== "number" || exp <= nowSeconds) return { ok: false, reason: "expired" };
  return { ok: true, claims: parsed.data };
}
