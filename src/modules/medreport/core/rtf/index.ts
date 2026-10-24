/**
 * RTF referrer forms → Word (.docx), converted once at the upload boundary.
 *
 * Clinics that keep each medico-legal provider's report template as RTF (e.g. for a practice system's
 * mail merge) upload it as it is. The Studio's upload dialog converts it in the browser and the server
 * converts it in forms/file.ts decodeFormFile({convertRtf}) – the same code, so the same RTF always
 * becomes the same .docx bytes and SHA-256 on both sides. From then on everything (hashing, storage, the
 * form map, analysis, fill, preview, approval, downloads) sees an ordinary Word form; the form map keeps
 * the original file name ("Report.rtf") and the completed form downloads as .docx.
 *
 * Mail-merge fields (10/2026): a practice system's merge fields – Word MERGEFIELD fields and typed «Name» /
 * <<Name>> – never survive the conversion: each becomes an empty answer space (an empty line or cell, or
 * a "__________" line beside its label), recorded in the notes ("N mail-merge fields from your clinic
 * system were turned into answer boxes – check the mapping once"). Other tokens ([Name], {Name}, $Name$,
 * %Name%) are kept and noted. Engine-wide, core/merge-fields.ts blocks approval of any form that still
 * has a merge field on it.
 *
 * convertRtfToDocx(bytes, {maxBytes}) → {docx, notes, stats}. `notes` are plain-English lines for staff
 * (what was left out, what became what), each starting with RTF_NOTE_PREFIX so the mapping screen can
 * show them under "Converted from RTF". Throws RtfConversionError (code + message) for a file that is
 * not RTF, is incomplete, too deeply nested, too complex or too large once converted.
 *
 * RTF_CONVERTER_VERSION: changing what the converter writes changes the converted bytes, so a map made
 * from an RTF upload through the partner API (which sends the RTF again for each fill) would no longer
 * match. Bump it with any change to the output and say so in the README.
 *
 * Browser-safe and pure (no Node built-ins, no network, no native tools).
 */
import { writeDocx } from "./docx-writer";
import type { RtfStats } from "./model";
import { rtfConversionNotes } from "./notes";
import { RTF_LIMITS, RtfConversionError, readRtf, type RtfReadLimits } from "./reader";
import { isRtfBytes } from "./sniff";

export { RtfConversionError, RTF_LIMITS, isRtfBytes };
export { RTF_NOTE_PREFIX, isConvertedFromRtf, isRtfConversionNote, rtfConversionNotes, rtfNoteText, wordFileNameFor } from "./notes";
export type { RtfErrorCode } from "./reader";
export type { RtfStats } from "./model";

/**
 * "rtf-docx-2" (10/2026): a clinic system's own letter codes (<<P_SURNAME>>, <<DATE>>) are kept in the body instead
 * of becoming answer spaces – only files with such codes convert to different bytes; every other RTF file gives the
 * same .docx bytes as "rtf-docx-1".
 */
export const RTF_CONVERTER_VERSION = "rtf-docx-2" as const;
export const RTF_MIME_TYPES = ["application/rtf", "text/rtf"] as const;

export interface RtfConversionResult {
  docx: Uint8Array;
  notes: string[];
  stats: RtfStats;
}

export interface RtfConvertOptions extends RtfReadLimits {
  /** Largest .docx accepted (the form upload limit). */
  maxBytes: number;
}

/** Convert an RTF file to .docx bytes. Throws RtfConversionError. */
export function convertRtfToDocx(bytes: Uint8Array, opts: RtfConvertOptions): RtfConversionResult {
  const doc = readRtf(bytes, opts);
  const docx = writeDocx(doc, { maxBytes: opts.maxBytes });
  return { docx, notes: rtfConversionNotes(doc.stats), stats: doc.stats };
}
