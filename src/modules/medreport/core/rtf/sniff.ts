/**
 * Whether a file is RTF, from its first bytes – a tiny module of its own so the Studio can check a
 * picked file without loading the converter (which it imports only for an RTF file).
 *
 * Browser-safe and pure.
 */

/** Whether the bytes are an RTF file ("{\rtf" after an optional byte-order mark and white space). */
export function isRtfBytes(bytes: Uint8Array): boolean {
  let i = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (i < bytes.length && i < 64 && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0d || bytes[i] === 0x0a)) i++;
  return bytes[i] === 0x7b && bytes[i + 1] === 0x5c && bytes[i + 2] === 0x72 && bytes[i + 3] === 0x74 && bytes[i + 4] === 0x66;
}
