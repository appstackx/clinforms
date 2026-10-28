/**
 * Text message rules: which numbers can receive texts, character sets and how many parts (segments) a text
 * takes – networks bill per segment. Pure.
 *
 * GSM-7 (the standard text alphabet): 160 characters in one segment, 153 per segment when split; the extension
 * characters ^ { } \ [ ~ ] | € count twice. Anything outside GSM-7 (most emoji, curly quotes) switches the whole
 * text to UCS-2: 70 characters, 67 per segment. normaliseSmsText() swaps the usual typographic characters for
 * plain ones so ordinary copy stays GSM-7.
 */
import { phoneDigits } from "../core/text";

const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENSION = "^{}\\[~]|€\f";
const BASIC = new Set(Array.from(GSM7_BASIC));
const EXTENSION = new Set(Array.from(GSM7_EXTENSION));

export interface SmsInfo {
  encoding: "gsm7" | "ucs2";
  /** Characters as the network counts them (GSM-7 extension characters count 2; UCS-2 counts UTF-16 units). */
  units: number;
  segments: number;
  /** Units per segment for this text (160/153 or 70/67). */
  perSegment: number;
}

export function isGsm7(text: string): boolean {
  for (const ch of Array.from(text)) if (!BASIC.has(ch) && !EXTENSION.has(ch)) return false;
  return true;
}

export function smsInfo(text: string): SmsInfo {
  if (isGsm7(text)) {
    let units = 0;
    for (const ch of Array.from(text)) units += EXTENSION.has(ch) ? 2 : 1;
    if (units <= 160) return { encoding: "gsm7", units, segments: units === 0 ? 0 : 1, perSegment: 160 };
    return { encoding: "gsm7", units, segments: Math.ceil(units / 153), perSegment: 153 };
  }
  const units = text.length; // UTF-16 code units
  if (units <= 70) return { encoding: "ucs2", units, segments: 1, perSegment: 70 };
  return { encoding: "ucs2", units, segments: Math.ceil(units / 67), perSegment: 67 };
}

/** Typographic characters → plain GSM-7 ones (curly quotes, dashes, ellipsis, non-breaking spaces). */
export function normaliseSmsText(text: string): string {
  return text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[   ]/g, " ")
    .replace(/•/g, "-");
}

/**
 * Whether a number can receive texts: a UK mobile (07…, +447…) or an international number (+ and 8–15 digits,
 * not +44). UK landlines (01, 02, 03…) cannot.
 */
export function isSmsCapable(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const trimmed = phone.trim();
  if (trimmed.startsWith("+") && !trimmed.startsWith("+44")) {
    const n = trimmed.replace(/[^0-9]/g, "").length;
    return n >= 8 && n <= 15;
  }
  return /^07\d{9}$/.test(phoneDigits(trimmed));
}

/** The key replies are matched on: digits with +44 → 0 ("+44 7700 900123" → "07700900123"). */
export function smsAddressKey(phone: string): string {
  return phoneDigits(phone);
}

/** E.164 for providers: "07700 900123" → "+447700900123"; international numbers keep their "+". */
export function toE164(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith("+") && !trimmed.startsWith("+44")) return `+${trimmed.replace(/[^0-9]/g, "")}`;
  const digits = phoneDigits(trimmed);
  return digits.startsWith("0") ? `+44${digits.slice(1)}` : `+${digits}`;
}
