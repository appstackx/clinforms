/**
 * Invoice and credit note numbers: one unbroken sequence per clinic and document type (HMRC: "a unique sequential
 * number"), shown as the clinic's prefix and the number padded to at least five digits ("RIV00042").
 *
 * Insurers' e-billing takes invoice numbers of at most 10 characters, so a prefix is 1–4 capital letters and the
 * number at most 999999 (4 + 6 = 10). The number is given when an invoice is ISSUED (a draft has none), by the
 * database in the same statement that issues it (src/server/repos/pms/billing/invoices.ts).
 */

export const DOCUMENT_PREFIX_PATTERN = /^[A-Z]{1,4}$/;
export const MAX_DOCUMENT_SEQ = 999_999;
export const MAX_DOCUMENT_NUMBER_LENGTH = 10;

/** "RIV" + 42 → "RIV00042"; null when the document has no number yet. */
export function formatDocumentNumber(prefix: string | null | undefined, seq: number | null | undefined): string | null {
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) return null;
  const p = prefix ?? "";
  return `${p}${String(seq).padStart(5, "0")}`;
}

/** "riv00042" / "RIV 42" / "42" → { prefix: "RIV", seq: 42 } (search); null when it is not a number. */
export function parseDocumentNumber(text: string): { prefix: string | null; seq: number } | null {
  const m = /^\s*([A-Za-z]{1,4})?\s*-?\s*0*(\d{1,6})\s*$/.exec(text);
  if (!m) return null;
  const seq = Number(m[2]);
  if (!Number.isInteger(seq) || seq < 1) return null;
  return { prefix: m[1] ? m[1].toUpperCase() : null, seq };
}

/** The next number given the highest one used and the clinic's chosen first number (never goes backwards). */
export function nextDocumentSeq(highestUsed: number | null, firstNumber: number): number {
  return Math.max((highestUsed ?? 0) + 1, firstNumber);
}
