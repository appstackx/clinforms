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
import { prescanRtf, type RtfPrescan } from "./prescan";
import { isRtfBytes } from "./sniff";
import { MAX_FORM_FILE_BYTES, MAX_RTF_FILE_BYTES } from "../../config.public";

export { RtfConversionError, RTF_LIMITS, isRtfBytes, prescanRtf };
export type { RtfPrescan };
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
  /** Largest RTF file accepted (10/2026; default MAX_RTF_FILE_BYTES, 12 MB). */
  maxInputBytes?: number;
  /** Largest RTF text once picture / object / binary data is set aside (default MAX_FORM_FILE_BYTES, 2.5 MB). */
  maxTextBytes?: number;
}

const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;

/**
 * The size rules for an RTF upload (10/2026), checked before anything is read: at most `maxInputBytes` (12 MB) in
 * all, of which at most `maxTextBytes` (2.5 MB) may be anything other than pictures, embedded objects and binary
 * data (prescan.ts – one linear pass). Throws RtfConversionError RTF_TOO_LARGE.
 */
export function assertRtfWithinLimits(bytes: Uint8Array, opts: Pick<RtfConvertOptions, "maxInputBytes" | "maxTextBytes"> = {}): RtfPrescan {
  const maxInput = opts.maxInputBytes ?? MAX_RTF_FILE_BYTES;
  const maxText = opts.maxTextBytes ?? MAX_FORM_FILE_BYTES;
  if (bytes.byteLength > maxInput) {
    throw new RtfConversionError("RTF_TOO_LARGE", `This RTF file is ${mb(bytes.byteLength)}; RTF templates can be up to ${mb(maxInput)}. Remove large pictures, or save it as a Word Document (.docx), and upload that file.`);
  }
  const scan = prescanRtf(bytes);
  if (scan.textBytes > maxText) {
    throw new RtfConversionError(
      "RTF_TOO_LARGE",
      `This RTF file holds ${mb(scan.textBytes)} of text and layout besides its pictures; the limit is ${mb(maxText)}. Save it as a Word Document (.docx) and upload that file.`,
    );
  }
  return scan;
}

/** Convert an RTF file to .docx bytes. Throws RtfConversionError. */
export function convertRtfToDocx(bytes: Uint8Array, opts: RtfConvertOptions): RtfConversionResult {
  assertRtfWithinLimits(bytes, opts);
  const doc = readRtf(bytes, opts);
  const docx = writeDocx(doc, { maxBytes: opts.maxBytes });
  return { docx, notes: rtfConversionNotes(doc.stats), stats: doc.stats };
}
