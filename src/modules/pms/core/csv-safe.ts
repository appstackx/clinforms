/**
 * One rule for every CSV the clinic system writes (M10 L4): a TEXT cell a spreadsheet could run as a formula gets a
 * leading apostrophe, and a cell is quoted when it holds a quote, the delimiter, a carriage return or a line feed
 * (RFC 4180). Pure. Used by the report, patient-list, billing, import and access-history downloads.
 *
 * "Could run as a formula": after any leading whitespace (spaces, tabs, line breaks, no-break and ideographic spaces),
 * the first character is = + - @ or | (DDE), or their full-width forms ＝ ＋ － ＠ ｜ – or the cell starts with a tab,
 * carriage return or line feed at all.
 */

const FORMULA = /^[\s  -​　﻿]*[=+\-@|＝＋－＠｜]/;
const LEADING_CONTROL = /^[\t\r\n]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/** Whether a text cell would be read as a formula. */
export function looksLikeFormula(text: string): boolean {
  return LEADING_CONTROL.test(text) || FORMULA.test(text);
}

/**
 * The text with a leading apostrophe when it could run as a formula. `keepNumbers`: a plain number written as text
 * ("-12.5") stays as it is (the import's error report writes back what the file held).
 */
export function defuseFormula(text: string, options: { keepNumbers?: boolean } = {}): string {
  if (options.keepNumbers && PLAIN_NUMBER.test(text)) return text;
  return looksLikeFormula(text) ? `'${text}` : text;
}

/** RFC 4180: quoted (inner quotes doubled) when it holds a quote, the delimiter, CR or LF. */
export function quoteCsv(text: string, delimiter = ","): string {
  return /["\r\n]/.test(text) || text.includes(delimiter) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A text cell: defused, then quoted when needed. */
export function safeCsvText(text: string, options: { delimiter?: string; keepNumbers?: boolean } = {}): string {
  return quoteCsv(defuseFormula(text, { keepNumbers: options.keepNumbers }), options.delimiter ?? ",");
}
