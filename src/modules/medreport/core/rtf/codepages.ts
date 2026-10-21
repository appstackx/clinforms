/**
 * Character decoding for the RTF reader (core/rtf/reader.ts): Windows code pages for `\'hh` bytes and
 * raw 8-bit text, and the symbol fonts (Symbol, Wingdings, Wingdings 2) whose bytes are pictures rather
 * than letters.
 *
 * Windows-1252 (what Word writes for UK English) is built in, so the result is the same in every browser
 * and in Node. Other single-byte code pages and the East Asian double-byte ones use the platform's
 * TextDecoder (WHATWG encodings: the same tables in browsers and Node) and fall back to Windows-1252
 * when a platform lacks one. Word writes every character outside the document's code page as `\uN`
 * anyway, so these paths are rarely used.
 *
 * Browser-safe and pure (no Node built-ins).
 */

/** Windows-1252 0x80–0x9F (the only range that differs from Latin-1). 0 = undefined in the code page. */
const CP1252_HIGH: readonly number[] = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
];

/** One Windows-1252 byte as a character ("" for the five bytes the code page leaves undefined). */
export function cp1252Char(byte: number): string {
  if (byte < 0x80 || byte > 0x9f) return String.fromCharCode(byte);
  const code = CP1252_HIGH[byte - 0x80];
  return code ? String.fromCharCode(code) : "";
}

/** RTF \fcharset → Windows code page (0 = use the document's \ansicpg). */
const CHARSET_CODEPAGES: Record<number, number> = {
  0: 1252,
  1: 0,
  2: 42, // symbol
  77: 10000,
  128: 932,
  129: 949,
  130: 1361,
  134: 936,
  136: 950,
  161: 1253,
  162: 1254,
  163: 1258,
  177: 1255,
  178: 1256,
  186: 1257,
  204: 1251,
  222: 874,
  238: 1250,
  254: 437,
  255: 850,
};

export function codepageForCharset(charset: number): number {
  return CHARSET_CODEPAGES[charset] ?? 0;
}

/** WHATWG encoding labels for the code pages TextDecoder may know. */
const CODEPAGE_LABELS: Record<number, string> = {
  874: "windows-874",
  932: "shift_jis",
  936: "gbk",
  949: "euc-kr",
  950: "big5",
  1250: "windows-1250",
  1251: "windows-1251",
  1253: "windows-1253",
  1254: "windows-1254",
  1255: "windows-1255",
  1256: "windows-1256",
  1257: "windows-1257",
  1258: "windows-1258",
  10000: "macintosh",
  437: "ibm866", // nearest WHATWG single-byte table; DOS code pages are very rare in RTF
  850: "windows-1252",
};

/** Double-byte (lead + trail byte) code pages. */
const DBCS = new Set([932, 936, 949, 950, 1361]);

export function isDoubleByteCodepage(cp: number): boolean {
  return DBCS.has(cp);
}

/** Whether a byte starts a two-byte character in this double-byte code page. */
export function isLeadByte(cp: number, byte: number): boolean {
  switch (cp) {
    case 932:
      return (byte >= 0x81 && byte <= 0x9f) || (byte >= 0xe0 && byte <= 0xfc);
    case 936:
    case 949:
    case 950:
    case 1361:
      return byte >= 0x81 && byte <= 0xfe;
    default:
      return false;
  }
}

const decoders = new Map<number, TextDecoder | null>();

function decoderFor(cp: number): TextDecoder | null {
  if (decoders.has(cp)) return decoders.get(cp) ?? null;
  let decoder: TextDecoder | null = null;
  const label = CODEPAGE_LABELS[cp];
  if (label && typeof TextDecoder !== "undefined") {
    try {
      decoder = new TextDecoder(label, { fatal: false });
    } catch {
      decoder = null;
    }
  }
  decoders.set(cp, decoder);
  return decoder;
}

/**
 * Decode bytes of one code page. Returns the text and how many characters could not be decoded
 * (replacement characters are dropped, never written into the form).
 */
export function decodeBytes(bytes: readonly number[], cp: number): { text: string; undecoded: number } {
  if (bytes.length === 0) return { text: "", undecoded: 0 };
  if (cp === 1252 || cp === 0) {
    let text = "";
    let undecoded = 0;
    for (const b of bytes) {
      const ch = cp1252Char(b);
      if (ch) text += ch;
      else undecoded += 1;
    }
    return { text, undecoded };
  }
  const decoder = decoderFor(cp);
  if (!decoder) return decodeBytes(bytes, 1252);
  const raw = decoder.decode(new Uint8Array(bytes));
  const text = raw.replace(/\ufffd/g, "");
  return { text, undecoded: raw.length - text.length };
}

/* ------------------------------------------------------------------------------------------------
 * Symbol fonts
 * ----------------------------------------------------------------------------------------------*/

export const UNCHECKED_BOX = "☐";
export const CHECKED_BOX = "☒";

export type SymbolFontKind = "symbol" | "wingdings" | "wingdings2" | "wingdings3" | "webdings" | "other-symbol";

/** The symbol-font family of a font, or null for an ordinary text font. */
export function symbolFontKind(name: string | null | undefined, charset: number | null | undefined): SymbolFontKind | null {
  const n = (name ?? "").trim().toLowerCase();
  if (n === "symbol") return "symbol";
  if (n === "wingdings" || n === "wingdings 1") return "wingdings";
  if (n === "wingdings 2") return "wingdings2";
  if (n === "wingdings 3") return "wingdings3";
  if (n === "webdings") return "webdings";
  if (charset === 2) return "other-symbol";
  return null;
}

/**
 * Wingdings / Wingdings 2 codes the Word engine (forms/docx-dom.ts symCheckbox) also reads as tick boxes,
 * so a converted form and a Word form with the same boxes are read alike.
 */
const WINGDINGS_BOXES: Record<number, string> = { 0x6f: UNCHECKED_BOX, 0xa8: UNCHECKED_BOX, 0x71: UNCHECKED_BOX, 0x72: UNCHECKED_BOX, 0xfe: CHECKED_BOX, 0xfd: CHECKED_BOX, 0x78: CHECKED_BOX };
const WINGDINGS2_BOXES: Record<number, string> = { 0xa3: UNCHECKED_BOX, 0xa2: UNCHECKED_BOX, 0x2a: UNCHECKED_BOX, 0x54: CHECKED_BOX, 0x53: CHECKED_BOX, 0x52: CHECKED_BOX, 0x51: CHECKED_BOX, 0x50: CHECKED_BOX };
/** Other unambiguous Wingdings marks. */
const WINGDINGS_TEXT: Record<number, string> = { 0xfc: "✓", 0xfb: "✗", 0x9f: "•", 0xa7: "▪", 0x6c: "●", 0x6e: "■", 0xd8: "➢", 0xe0: "→", 0xe8: "➔" };
const WINGDINGS2_TEXT: Record<number, string> = { 0x50: CHECKED_BOX, 0x97: "•", 0x98: "•" };

/** Adobe Symbol encoding → Unicode for the characters that turn up in forms (bullets, maths, Greek). */
const SYMBOL_TEXT: Record<number, string> = {
  0x20: " ", 0x21: "!", 0x22: "∀", 0x23: "#", 0x24: "∃", 0x25: "%", 0x26: "&", 0x27: "∋", 0x28: "(", 0x29: ")",
  0x2a: "∗", 0x2b: "+", 0x2c: ",", 0x2d: "−", 0x2e: ".", 0x2f: "/", 0x3a: ":", 0x3b: ";", 0x3c: "<", 0x3d: "=",
  0x3e: ">", 0x3f: "?", 0x40: "≅", 0x41: "Α", 0x42: "Β", 0x43: "Χ", 0x44: "Δ", 0x45: "Ε", 0x46: "Φ", 0x47: "Γ",
  0x48: "Η", 0x49: "Ι", 0x4a: "ϑ", 0x4b: "Κ", 0x4c: "Λ", 0x4d: "Μ", 0x4e: "Ν", 0x4f: "Ο", 0x50: "Π", 0x51: "Θ",
  0x52: "Ρ", 0x53: "Σ", 0x54: "Τ", 0x55: "Υ", 0x56: "ς", 0x57: "Ω", 0x58: "Ξ", 0x59: "Ψ", 0x5a: "Ζ", 0x5b: "[",
  0x5c: "∴", 0x5d: "]", 0x5e: "⊥", 0x5f: "_", 0x61: "α", 0x62: "β", 0x63: "χ", 0x64: "δ", 0x65: "ε", 0x66: "φ",
  0x67: "γ", 0x68: "η", 0x69: "ι", 0x6a: "ϕ", 0x6b: "κ", 0x6c: "λ", 0x6d: "μ", 0x6e: "ν", 0x6f: "ο", 0x70: "π",
  0x71: "θ", 0x72: "ρ", 0x73: "σ", 0x74: "τ", 0x75: "υ", 0x76: "ϖ", 0x77: "ω", 0x78: "ξ", 0x79: "ψ", 0x7a: "ζ",
  0x7b: "{", 0x7c: "|", 0x7d: "}", 0x7e: "∼", 0xa1: "ϒ", 0xa2: "′", 0xa3: "≤", 0xa4: "⁄", 0xa5: "∞", 0xa6: "ƒ",
  0xa7: "♣", 0xa8: "♦", 0xa9: "♥", 0xaa: "♠", 0xab: "↔", 0xac: "←", 0xad: "↑", 0xae: "→", 0xaf: "↓", 0xb0: "°",
  0xb1: "±", 0xb2: "″", 0xb3: "≥", 0xb4: "×", 0xb5: "∝", 0xb6: "∂", 0xb7: "•", 0xb8: "÷", 0xb9: "≠", 0xba: "≡",
  0xbb: "≈", 0xbc: "…", 0xc4: "⊗", 0xc5: "⊕", 0xc6: "∅", 0xc7: "∩", 0xc8: "∪", 0xd0: "∠", 0xd1: "∇", 0xd2: "®",
  0xd3: "©", 0xd4: "™", 0xd5: "∏", 0xd6: "√", 0xd7: "⋅", 0xd8: "¬", 0xd9: "∧", 0xda: "∨", 0xdb: "⇔", 0xdc: "⇐",
  0xdd: "⇑", 0xde: "⇒", 0xdf: "⇓", 0xe0: "◊", 0xe1: "〈", 0xe2: "®", 0xe3: "©", 0xe4: "™", 0xe5: "∑", 0xf1: "〉",
  0xf2: "∫",
};

export type SymbolGlyph = { text: string; box: boolean } | { sym: { font: string; char: number } };

/**
 * A character of a symbol font (byte 0x20–0xFF, or its private-use form U+F020–U+F0FF) as Unicode text
 * when the meaning is obvious (tick boxes, bullets, arrows, Greek), else as a Word symbol (w:sym) in the
 * same font so it still prints the same.
 */
export function symbolGlyph(kind: SymbolFontKind, fontName: string, code: number): SymbolGlyph | null {
  const c = code >= 0xf000 && code <= 0xf0ff ? code - 0xf000 : code;
  if (c < 0x20 || c > 0xff) return null;
  if (kind === "wingdings") {
    const box = WINGDINGS_BOXES[c];
    if (box) return { text: box, box: true };
    const text = WINGDINGS_TEXT[c];
    if (text) return { text, box: false };
  } else if (kind === "wingdings2") {
    const box = WINGDINGS2_BOXES[c];
    if (box) return { text: box, box: true };
    const text = WINGDINGS2_TEXT[c];
    if (text) return { text, box: false };
  } else if (kind === "symbol") {
    const text = SYMBOL_TEXT[c];
    if (text) return { text, box: false };
  }
  if (c === 0x20) return { text: " ", box: false };
  return { sym: { font: fontName || "Symbol", char: 0xf000 + c } };
}
