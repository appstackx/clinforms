/**
 * Request authentication (docs/production-architecture.md §2):
 *   x-clinforms-ts  = unix ms, within ±60 s of the Worker's clock
 *   x-clinforms-sig = hex HMAC-SHA256(GATEWAY_SECRET, ts + "\n" + METHOD + "\n" + path + "\n" + sha256hex(body))
 * The signature is checked with crypto.subtle.verify (constant time).
 */
export const TS_HEADER = "x-clinforms-ts";
export const SIG_HEADER = "x-clinforms-sig";
export const MAX_SKEW_MS = 60_000;

const encoder = new TextEncoder();
let cachedKey: { secret: string; key: Promise<CryptoKey> } | undefined;

function hmacKey(secret: string): Promise<CryptoKey> {
  if (cachedKey?.secret !== secret) {
    cachedKey = {
      secret,
      key: crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]),
    };
  }
  return cachedKey.key;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function sha256Hex(body: Uint8Array<ArrayBuffer>): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", body));
}

export type AuthFailure = "MISSING_HEADERS" | "STALE_TIMESTAMP" | "BAD_SIGNATURE";

/** Cheap checks before the body is read: header shape and the time window. */
export function checkAuthHeaders(ts: string | null, sig: string | null, now: number): AuthFailure | null {
  if (!ts || !/^\d{13}$/.test(ts) || !sig || !/^[0-9a-f]{64}$/i.test(sig)) return "MISSING_HEADERS";
  if (Math.abs(now - Number(ts)) > MAX_SKEW_MS) return "STALE_TIMESTAMP";
  return null;
}

export async function verifySignature(
  secret: string,
  ts: string,
  method: string,
  path: string,
  body: Uint8Array<ArrayBuffer>,
  sigHex: string,
): Promise<boolean> {
  const message = encoder.encode(`${ts}\n${method.toUpperCase()}\n${path}\n${await sha256Hex(body)}`);
  return crypto.subtle.verify("HMAC", await hmacKey(secret), fromHex(sigHex.toLowerCase()), message);
}

/** Used by tests and tools to produce a valid signature. */
export async function signRequest(secret: string, ts: string, method: string, path: string, body: Uint8Array<ArrayBuffer>): Promise<string> {
  const message = encoder.encode(`${ts}\n${method.toUpperCase()}\n${path}\n${await sha256Hex(body)}`);
  return toHex(await crypto.subtle.sign("HMAC", await hmacKey(secret), message));
}
