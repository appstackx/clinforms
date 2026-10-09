/**
 * Report fingerprint: canonical JSON + SHA-256 via WebCrypto (works in browsers and Node 22).
 *
 * The fingerprint covers the report's CONTENT – what the signer signs. Fields that change at or after
 * signing, or that are derived, are excluded so that a signed report re-hashes to the same value:
 * `receipt`, `status`, `updatedAt`, `activity` and `flags` (see FINGERPRINT_EXCLUDED_KEYS).
 *
 * Owner: forms-engine agent (formerly docgen) (implemented by the foundation; signature is final).
 */
import type { Report } from "./types";

/** Top-level Report keys left out of the fingerprint. */
export const FINGERPRINT_EXCLUDED_KEYS = ["receipt", "status", "updatedAt", "activity", "flags"] as const;

/**
 * Deterministic JSON: object keys sorted (code-point order), `undefined` members dropped,
 * array order preserved (`undefined` array items become `null`, as JSON.stringify does).
 * Throws on non-finite numbers, bigint, functions and symbols, which have no canonical form.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonicalize: non-finite number");
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v) => (v === undefined ? "null" : canonicalize(v))).join(",")}]`;
      }
      if (value instanceof Date) return JSON.stringify(value.toISOString());
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
    }
    default:
      throw new TypeError(`canonicalize: unsupported type ${typeof value}`);
  }
}

/** Canonical JSON of the signable content of a report (FINGERPRINT_EXCLUDED_KEYS removed). */
export function canonicalJson(report: Report): string {
  const content: Record<string, unknown> = { ...report };
  for (const key of FINGERPRINT_EXCLUDED_KEYS) delete content[key];
  return canonicalize(content);
}

/** SHA-256 of a UTF-8 string as 64 lower-case hex characters (WebCrypto). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 of raw bytes (e.g. a rendered .docx) as hex. */
export async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** `sha256Hex(canonicalJson(report))` – the value stored in SignReceipt.contentSha256. */
export async function reportFingerprint(report: Report): Promise<string> {
  return sha256Hex(canonicalJson(report));
}

/** Short display form of a fingerprint, e.g. "3F9C 2A7B 1D4E". */
export function shortFingerprint(hex: string, groups = 3): string {
  const upper = hex.toUpperCase();
  const out: string[] = [];
  for (let i = 0; i < groups; i++) out.push(upper.slice(i * 4, i * 4 + 4));
  return out.filter(Boolean).join(" ");
}
