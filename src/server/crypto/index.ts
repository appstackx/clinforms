import "server-only";
import { DataCipher, keyringFromEnv } from "./envelope";

export {
  DataCipher,
  DataCryptoError,
  ENVELOPE_VERSION,
  HKDF_INFO,
  keyringFromEnv,
  kidOf,
  parseKeyring,
  type CipherContext,
  type DataCryptoErrorCode,
  type Keyring,
} from "./envelope";

let cached: { keys: string | undefined; kid: string | undefined; cipher: DataCipher } | undefined;

/** The process-wide cipher from CLINFORMS_DATA_KEYS / CLINFORMS_DATA_KEY_ID (rebuilt if they change). */
export function getDataCipher(): DataCipher {
  const keys = process.env.CLINFORMS_DATA_KEYS;
  const kid = process.env.CLINFORMS_DATA_KEY_ID;
  if (cached && cached.keys === keys && cached.kid === kid) return cached.cipher;
  const cipher = new DataCipher(keyringFromEnv());
  cached = { keys, kid, cipher };
  return cipher;
}
