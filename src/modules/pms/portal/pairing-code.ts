/**
 * The short code that pairs a clinic device with a form handed to the patient (M10 H3): 8 characters from an
 * alphabet without look-alikes (no 0/O, 1/I/L, U/V), shown "ABCD-EFGH" on the staff screen and typed on the device.
 * About 10^11 codes – one is valid for 10 minutes and used once, and the device page limits attempts. Pure.
 */
export const PAIRING_ALPHABET = "ABCDEFGHJKMNPQRSTWXYZ23456789";
export const PAIRING_CODE_LENGTH = 8;

/** A new code from random bytes (each byte below the largest multiple of the alphabet's size, so no bias). */
export function pairingCodeFrom(randomBytes: (n: number) => Uint8Array): string {
  const n = PAIRING_ALPHABET.length;
  const limit = 256 - (256 % n);
  let out = "";
  while (out.length < PAIRING_CODE_LENGTH) {
    const bytes = randomBytes(16);
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b < limit && out.length < PAIRING_CODE_LENGTH) out += PAIRING_ALPHABET[b % n];
    }
  }
  return out;
}

/** "abcd efgh" / "ABCD-EFGH" → "ABCDEFGH"; null when it cannot be a code. */
export function normalisePairingCode(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 40) return null;
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== PAIRING_CODE_LENGTH) return null;
  for (const ch of code) if (!PAIRING_ALPHABET.includes(ch)) return null;
  return code;
}

/** "ABCDEFGH" → "ABCD-EFGH". */
export function formatPairingCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
