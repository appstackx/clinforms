/**
 * RTF size check before conversion (10/2026). RTF writes pictures (logos), embedded objects and the theme/data
 * stores as hex text – a clinic system's letter template with two logos is often 3–6 MB, of which a few hundred
 * KB is the form itself. So a template may be up to MAX_RTF_FILE_BYTES (12 MB) raw as long as what remains after
 * removing that payload – the text and layout the reader actually works through – stays within
 * MAX_FORM_FILE_BYTES (2.5 MB, the same bound as before for every byte).
 *
 * prescanRtf(bytes) is ONE linear pass that allocates nothing per byte: it counts braces (a depth number, no
 * stack), steps over control words and control symbols, and measures the payload exactly as the reader skips it –
 * a group from the payload control word to the group's end (\pict, \shppict, \nonshppict, \object, \objdata,
 * \themedata, \colorschememapping, \datastore, \fontemb, \fontfile, \blipuid; the reader's skip destinations, so
 * nothing counted as payload is ever read as text) and the bytes of every \binN run (the reader jumps over them).
 * A payload group that never closes counts to the end of the file (the reader skips it the same way, then reports
 * the file as incomplete). Nothing about a hostile file can make it slower than linear: the reader's own limits
 * (depth, blocks, inlines, cell definitions, output size) still apply to the text part.
 *
 * Browser-safe and pure.
 */

/** Control words whose group is picture / object / binary payload (all of them reader skip destinations). */
const PAYLOAD_WORDS = new Set(["pict", "shppict", "nonshppict", "object", "objdata", "themedata", "colorschememapping", "datastore", "fontemb", "fontfile", "blipuid"]);

const WORDS_BY_LENGTH = new Map<number, string[]>();
for (const w of Array.from(PAYLOAD_WORDS).concat(["bin"])) WORDS_BY_LENGTH.set(w.length, [...(WORDS_BY_LENGTH.get(w.length) ?? []), w]);

/** "bin", or a payload word (when `payloadToo`), at bytes[from, to) – else "". */
function wordAt(bytes: Uint8Array, from: number, to: number, payloadToo: boolean): string {
  const candidates = WORDS_BY_LENGTH.get(to - from);
  if (!candidates) return "";
  for (const w of candidates) {
    if (!payloadToo && w !== "bin") continue;
    let same = true;
    for (let k = 0; k < w.length; k++) {
      if (bytes[from + k] !== w.charCodeAt(k)) {
        same = false;
        break;
      }
    }
    if (same) return w;
  }
  return "";
}

export interface RtfPrescan {
  totalBytes: number;
  /** Picture, object and binary data (skipped by the reader). */
  payloadBytes: number;
  /** Everything else: what the reader works through. */
  textBytes: number;
}

const isLetter = (b: number) => (b >= 0x61 && b <= 0x7a) || (b >= 0x41 && b <= 0x5a);
const isDigit = (b: number) => b >= 0x30 && b <= 0x39;
const isHex = (b: number | undefined) => b !== undefined && (isDigit(b) || (b >= 0x61 && b <= 0x66) || (b >= 0x41 && b <= 0x46));

export function prescanRtf(bytes: Uint8Array): RtfPrescan {
  const n = bytes.length;
  let depth = 0;
  /** Depth of the group that holds the current payload, or -1. */
  let payloadDepth = -1;
  let payloadFrom = 0;
  let payload = 0;
  let i = 0;
  while (i < n) {
    const c = bytes[i];
    if (c === 0x7b) {
      depth += 1;
      i += 1;
      continue;
    }
    if (c === 0x7d) {
      if (payloadDepth >= 0 && depth === payloadDepth) {
        payload += i + 1 - payloadFrom;
        payloadDepth = -1;
      }
      if (depth > 0) depth -= 1;
      i += 1;
      continue;
    }
    if (c !== 0x5c) {
      i += 1;
      continue;
    }
    // A control word (\letters, optional -digits, optional space) or a control symbol (\x, \'hh).
    const start = i;
    let j = i + 1;
    if (j < n && isLetter(bytes[j])) {
      let k = j;
      while (k < n && isLetter(bytes[k]) && k - j < 32) k++;
      // The word is compared byte by byte, and only outside payload (or for \bin): no string per control word.
      const word = wordAt(bytes, j, k, payloadDepth < 0);
      while (k < n && isLetter(bytes[k])) k++; // over-long words: the rest is ignored, as the reader does
      if (bytes[k] === 0x2d && k + 1 < n && isDigit(bytes[k + 1])) k++;
      let param = 0;
      let digits = 0;
      while (k < n && isDigit(bytes[k])) {
        if (digits < 10) param = Math.min(2147483647, param * 10 + (bytes[k] - 0x30));
        digits++;
        k++;
      }
      if (k < n && bytes[k] === 0x20) k++;
      if (word === "bin") {
        const len = digits > 0 && bytes[j + 3] !== 0x2d ? Math.min(param, n - k) : 0;
        if (payloadDepth < 0) payload += len;
        i = k + len;
        continue;
      }
      if (payloadDepth < 0 && depth > 0 && PAYLOAD_WORDS.has(word)) {
        payloadDepth = depth;
        payloadFrom = start;
      }
      i = k;
      continue;
    }
    // \'hh is four bytes when both are hex digits – exactly as the reader reads it (otherwise only "\'" is taken and
    // the next byte, even a brace, is read on its own); any other control symbol is two bytes.
    if (j < n && bytes[j] === 0x27 && isHex(bytes[j + 1]) && isHex(bytes[j + 2])) i = j + 3;
    else i = Math.min(n, j + 1);
  }
  if (payloadDepth >= 0) payload += n - payloadFrom;
  return { totalBytes: n, payloadBytes: payload, textBytes: n - payload };
}
