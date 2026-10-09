/**
 * Encryption at rest for patient data (docs/production-architecture.md §2).
 *
 * - AES-256-GCM, 96-bit random IV, 128-bit tag.
 * - Master keys: CLINFORMS_DATA_KEYS = JSON {"k1": "<base64 32 bytes>", …}; CLINFORMS_DATA_KEY_ID = the
 *   active kid (new ciphertext). Every listed key can still decrypt (rotation = add a kid, switch the active
 *   one, re-encrypt in the background with `rotate()`).
 * - Per-tenant subkey = HKDF-SHA256(master, salt = tenantId, info = "clinforms:data:v1").
 * - Ciphertext string: v1.<kid>.<iv b64url>.<ciphertext+tag b64url>
 * - AAD = "<tenantId>:<table>:<rowId>", so a ciphertext cannot be moved to another row, table or tenant.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

export const ENVELOPE_VERSION = "v1";
export const HKDF_INFO = "clinforms:data:v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const KID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const B64URL = /^[A-Za-z0-9_-]*$/;

export type DataCryptoErrorCode = "BAD_KEYRING" | "BAD_AAD" | "MALFORMED" | "UNKNOWN_KID" | "DECRYPT_FAILED";

export class DataCryptoError extends Error {
  readonly code: DataCryptoErrorCode;
  constructor(code: DataCryptoErrorCode, message: string) {
    super(message);
    this.name = "DataCryptoError";
    this.code = code;
  }
}

/** Where a ciphertext lives. tenantId and table may not contain ":"; rowId may. */
export interface CipherContext {
  tenantId: string;
  table: string;
  rowId: string;
}

export interface Keyring {
  readonly keys: ReadonlyMap<string, Buffer>;
  readonly activeKid: string;
}

/** Parses CLINFORMS_DATA_KEYS (JSON) + CLINFORMS_DATA_KEY_ID. Errors never include key material. */
export function parseKeyring(keysJson: string | undefined, activeKid: string | undefined): Keyring {
  if (!keysJson) throw new DataCryptoError("BAD_KEYRING", "CLINFORMS_DATA_KEYS is not set.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(keysJson);
  } catch {
    throw new DataCryptoError("BAD_KEYRING", "CLINFORMS_DATA_KEYS is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DataCryptoError("BAD_KEYRING", 'CLINFORMS_DATA_KEYS must be a JSON object {"kid": "<base64 32 bytes>"}.');
  }
  const keys = new Map<string, Buffer>();
  for (const [kid, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!KID_PATTERN.test(kid)) throw new DataCryptoError("BAD_KEYRING", `Key id "${kid.slice(0, 40)}" is invalid (A-Z a-z 0-9 _ -).`);
    if (typeof value !== "string") throw new DataCryptoError("BAD_KEYRING", `Key "${kid}" must be a base64 string.`);
    const key = Buffer.from(value, "base64");
    if (key.length !== KEY_BYTES || key.toString("base64").replace(/=+$/, "") !== value.trim().replace(/=+$/, "")) {
      throw new DataCryptoError("BAD_KEYRING", `Key "${kid}" must be exactly 32 bytes, base64-encoded.`);
    }
    keys.set(kid, key);
  }
  if (keys.size === 0) throw new DataCryptoError("BAD_KEYRING", "CLINFORMS_DATA_KEYS holds no keys.");
  const kid = (activeKid ?? "").trim();
  if (!kid) throw new DataCryptoError("BAD_KEYRING", "CLINFORMS_DATA_KEY_ID is not set.");
  if (!keys.has(kid)) throw new DataCryptoError("BAD_KEYRING", `CLINFORMS_DATA_KEY_ID "${kid}" is not in CLINFORMS_DATA_KEYS.`);
  return { keys, activeKid: kid };
}

export function keyringFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): Keyring {
  return parseKeyring(env.CLINFORMS_DATA_KEYS, env.CLINFORMS_DATA_KEY_ID);
}

function aadOf(ctx: CipherContext): Buffer {
  const { tenantId, table, rowId } = ctx;
  if (!tenantId || tenantId.includes(":")) throw new DataCryptoError("BAD_AAD", "tenantId must be non-empty without ':'.");
  if (!table || table.includes(":")) throw new DataCryptoError("BAD_AAD", "table must be non-empty without ':'.");
  if (!rowId) throw new DataCryptoError("BAD_AAD", "rowId must be non-empty.");
  return Buffer.from(`${tenantId}:${table}:${rowId}`, "utf8");
}

const MAX_CACHED_SUBKEYS = 2048;

export class DataCipher {
  private readonly _keyring: Keyring;
  private readonly _subkeys = new Map<string, Buffer>();

  constructor(keyring: Keyring) {
    this._keyring = keyring;
  }

  get activeKid(): string {
    return this._keyring.activeKid;
  }

  private _subkey(kid: string, tenantId: string): Buffer {
    const cacheKey = `${kid}\u0000${tenantId}`;
    const hit = this._subkeys.get(cacheKey);
    if (hit) return hit;
    const master = this._keyring.keys.get(kid);
    if (!master) throw new DataCryptoError("UNKNOWN_KID", `No data key with id "${kid}" is configured.`);
    const key = Buffer.from(hkdfSync("sha256", master, Buffer.from(tenantId, "utf8"), Buffer.from(HKDF_INFO, "utf8"), KEY_BYTES));
    if (this._subkeys.size >= MAX_CACHED_SUBKEYS) this._subkeys.clear();
    this._subkeys.set(cacheKey, key);
    return key;
  }

  /** Encrypts with the active key. */
  encrypt(plaintext: string | Uint8Array, ctx: CipherContext): string {
    const aad = aadOf(ctx);
    const kid = this._keyring.activeKid;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this._subkey(kid, ctx.tenantId), iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(aad);
    const data = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;
    const body = Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);
    return `${ENVELOPE_VERSION}.${kid}.${iv.toString("base64url")}.${body.toString("base64url")}`;
  }

  decryptBytes(ciphertext: string, ctx: CipherContext): Buffer {
    const { kid, iv, body } = parseEnvelope(ciphertext);
    const aad = aadOf(ctx);
    const decipher = createDecipheriv("aes-256-gcm", this._subkey(kid, ctx.tenantId), iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
    try {
      return Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]);
    } catch {
      throw new DataCryptoError("DECRYPT_FAILED", `Decryption failed for ${ctx.table} (wrong key, row or tenant, or tampered data).`);
    }
  }

  decryptString(ciphertext: string, ctx: CipherContext): string {
    return this.decryptBytes(ciphertext, ctx).toString("utf8");
  }

  /** True when the ciphertext was made with a key other than the active one. */
  needsRotation(ciphertext: string): boolean {
    return parseEnvelope(ciphertext).kid !== this._keyring.activeKid;
  }

  /** Re-encrypts with the active key (unchanged when it already uses it). */
  rotate(ciphertext: string, ctx: CipherContext): string {
    if (!this.needsRotation(ciphertext)) return ciphertext;
    return this.encrypt(this.decryptBytes(ciphertext, ctx), ctx);
  }
}

export function kidOf(ciphertext: string): string {
  return parseEnvelope(ciphertext).kid;
}

function parseEnvelope(ciphertext: string): { kid: string; iv: Buffer; body: Buffer } {
  if (typeof ciphertext !== "string") throw new DataCryptoError("MALFORMED", "Ciphertext must be a string.");
  const parts = ciphertext.split(".");
  if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
    throw new DataCryptoError("MALFORMED", "Ciphertext is not in the v1.<kid>.<iv>.<data> format.");
  }
  const [, kid, ivText, bodyText] = parts;
  if (!KID_PATTERN.test(kid) || !B64URL.test(ivText) || !B64URL.test(bodyText)) {
    throw new DataCryptoError("MALFORMED", "Ciphertext has invalid characters.");
  }
  const iv = Buffer.from(ivText, "base64url");
  const body = Buffer.from(bodyText, "base64url");
  if (iv.length !== IV_BYTES || body.length < TAG_BYTES) throw new DataCryptoError("MALFORMED", "Ciphertext is truncated.");
  return { kid, iv, body };
}
