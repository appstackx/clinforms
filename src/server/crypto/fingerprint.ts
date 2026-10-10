/**
 * Key fingerprints: a short, one-way identifier of each data master key, so two holders of a keyring (the deployed
 * app and the offline secrets file) can prove they hold the same key bytes without either side showing them.
 *
 *   fingerprint = first 16 hex characters (64 bits) of HMAC-SHA256(key = the raw 32 key bytes,
 *                                                                  message = "clinforms:key-fingerprint:v1")
 *
 * Domain separation: the data subkeys are HKDF-SHA256(master, salt = tenantId, info = "clinforms:data:v1"), a
 * different construction with a different label, so a fingerprint says nothing about any subkey or ciphertext.
 * HMAC is a PRF: 64 bits of one output reveal nothing usable about the key, and two different keys collide with
 * probability 2^-64. Pure (no "server-only"): GET /api/ops/key-fingerprint and scripts/db/key-fingerprint.ts both
 * use it, with keyrings parsed by the same parseKeyring as the data cipher.
 */
import { createHmac } from "node:crypto";
import type { Keyring } from "./envelope";

export const KEY_FINGERPRINT_LABEL = "clinforms:key-fingerprint:v1";
export const KEY_FINGERPRINT_HEX_CHARS = 16;
export const KEY_FINGERPRINT_PATTERN = /^[0-9a-f]{16}$/;

export interface KeyFingerprint {
  kid: string;
  fingerprint: string;
}

/** What GET /api/ops/key-fingerprint returns and the script prints: kids sorted, never key bytes. */
export interface KeyringFingerprints {
  activeKid: string;
  keys: KeyFingerprint[];
}

/** First 16 hex characters of HMAC-SHA256(rawKeyBytes, KEY_FINGERPRINT_LABEL). */
export function keyFingerprint(rawKey: Uint8Array): string {
  return createHmac("sha256", rawKey).update(KEY_FINGERPRINT_LABEL, "utf8").digest("hex").slice(0, KEY_FINGERPRINT_HEX_CHARS);
}

/** Fingerprints of every key in a keyring (sorted by kid) plus the active kid. */
export function keyringFingerprints(keyring: Keyring): KeyringFingerprints {
  const keys = Array.from(keyring.keys.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([kid, key]) => ({ kid, fingerprint: keyFingerprint(key) }));
  return { activeKid: keyring.activeKid, keys };
}
