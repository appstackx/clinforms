/**
 * TESTS ONLY: an independent RFC 6238 TOTP (SHA-1, 6 digits, 30 s) computed from the otpauth:// URI the
 * setup screen shows – the same thing an authenticator app does – so the tests prove interoperability
 * rather than reusing Better Auth's own code.
 */
import { createHmac } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean.split("")) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error(`Invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export interface OtpAuth {
  secret: Buffer;
  issuer: string | null;
  account: string;
  digits: number;
  period: number;
  algorithm: string;
}

export function parseOtpAuthUri(uri: string): OtpAuth {
  const url = new URL(uri);
  if (url.protocol !== "otpauth:" || url.hostname !== "totp") throw new Error("Not an otpauth://totp URI");
  const label = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const secret = url.searchParams.get("secret");
  if (!secret) throw new Error("otpauth URI without a secret");
  return {
    secret: base32Decode(secret),
    issuer: url.searchParams.get("issuer"),
    account: label.includes(":") ? label.slice(label.indexOf(":") + 1) : label,
    digits: Number(url.searchParams.get("digits") ?? 6),
    period: Number(url.searchParams.get("period") ?? 30),
    algorithm: (url.searchParams.get("algorithm") ?? "SHA1").toUpperCase(),
  };
}

export function totp(auth: OtpAuth, at: number = Date.now()): string {
  const counter = Math.floor(at / 1000 / auth.period);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const algo = auth.algorithm.replace("-", "").toLowerCase();
  const hmac = createHmac(algo === "sha1" ? "sha1" : algo, auth.secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(code % 10 ** auth.digits).padStart(auth.digits, "0");
}

/** A 6-digit code that is NOT valid now (nor in the ±1 step window). */
export function wrongTotp(auth: OtpAuth, at: number = Date.now()): string {
  const valid = new Set([-1, 0, 1].map((d) => totp(auth, at + d * auth.period * 1000)));
  for (let n = 0; ; n++) {
    const candidate = String((123456 + n * 7919) % 1_000_000).padStart(6, "0");
    if (!valid.has(candidate)) return candidate;
  }
}
