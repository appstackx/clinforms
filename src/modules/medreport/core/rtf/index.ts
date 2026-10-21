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
import { RTF_LIMITS, RtfConversionError, isRtfBytes, readRtf, type RtfReadLimits } from "./reader";

export { RtfConversionError, RTF_LIMITS, isRtfBytes };
export type { RtfErrorCode } from "./reader";
export type { RtfStats } from "./model";

export const RTF_CONVERTER_VERSION = "rtf-docx-1" as const;
export const RTF_MIME_TYPES = ["application/rtf", "text/rtf"] as const;
export const RTF_NOTE_PREFIX = "Converted from RTF: ";

export interface RtfConversionResult {
  docx: Uint8Array;
  notes: string[];
  stats: RtfStats;
}

export interface RtfConvertOptions extends RtfReadLimits {
  /** Largest .docx accepted (the form upload limit). */
  maxBytes: number;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

const was = (n: number) => (n === 1 ? "was" : "were");

/** The staff-facing notes for a conversion (neutral wording; counts and printed field names only). */
export function rtfConversionNotes(stats: RtfStats): string[] {
  const notes: string[] = [];
  const p = RTF_NOTE_PREFIX;
  if (stats.pictures > 0) notes.push(`${p}${plural(stats.pictures, "picture")} (such as a logo) could not be carried over and ${was(stats.pictures)} left out.`);
  if (stats.shapes > 0) {
    notes.push(`${p}${plural(stats.shapes, "text box or drawn shape", "text boxes or drawn shapes")} ${was(stats.shapes)} left out – any questions inside them are not on the converted form.`);
  }
  if (stats.objects > 0) notes.push(`${p}${plural(stats.objects, "embedded object")} ${was(stats.objects)} left out.`);
  if (stats.footnotes > 0) notes.push(`${p}${plural(stats.footnotes, "footnote")} ${was(stats.footnotes)} left out.`);
  if (stats.comments > 0) notes.push(`${p}${plural(stats.comments, "comment")} ${was(stats.comments)} left out.`);
  if (stats.undecoded > 0) notes.push(`${p}${plural(stats.undecoded, "character")} could not be read and ${was(stats.undecoded)} left out.`);
  if (stats.sections > 0) {
    notes.push(`${p}the template's ${stats.sections + 1} sections were joined into one; each section break became a page break, and the first section's page layout, header and footer are used throughout.`);
  }
  if (stats.headerFooterFillIns > 0) {
    notes.push(`${p}the page header or footer has ${plural(stats.headerFooterFillIns, "fill-in space")}; it is kept as printed and is not completed automatically.`);
  }
  if (stats.mergeFields > 0) {
    const examples = stats.mergeFieldNames.slice(0, 3).map((n) => `«${n}»`).join(", ");
    notes.push(`${p}${plural(stats.mergeFields, "mail-merge field")} from your clinic system${examples ? ` (${examples})` : ""} ${was(stats.mergeFields)} turned into answer boxes – check the mapping once.`);
  }
  if (stats.otherTokens > 0) {
    const examples = stats.otherTokenExamples.join(", ");
    notes.push(
      `${p}${plural(stats.otherTokens, "placeholder")} that another system may fill in${examples ? ` (${examples})` : ""} ${stats.otherTokens === 1 ? "was kept as printed – check whether it is an answer box, and map it if it is." : "were kept as printed – check whether each one is an answer box, and map it if it is."}`,
    );
  }
  const formFields = stats.formTextFields + stats.formCheckboxes + stats.formDropdowns;
  if (formFields > 0) notes.push(`${p}${plural(formFields, "form field")} became tick boxes or fill-in spaces.`);
  return notes;
}

/** Convert an RTF file to .docx bytes. Throws RtfConversionError. */
export function convertRtfToDocx(bytes: Uint8Array, opts: RtfConvertOptions): RtfConversionResult {
  const doc = readRtf(bytes, opts);
  const docx = writeDocx(doc, { maxBytes: opts.maxBytes });
  return { docx, notes: rtfConversionNotes(doc.stats), stats: doc.stats };
}

/** A note written by the conversion (in a form map's analysis warnings). */
export function isRtfConversionNote(note: string): boolean {
  return note.startsWith(RTF_NOTE_PREFIX);
}

/** The note without its prefix, sentence-cased ("Converted from RTF: the page…" → "The page…"). */
export function rtfNoteText(note: string): string {
  const t = note.slice(RTF_NOTE_PREFIX.length);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** A form map whose Word file was converted from an RTF upload (the original file name is kept). */
export function isConvertedFromRtf(file: { fileName: string; mimeType: string }): boolean {
  return /\.rtf$/i.test(file.fileName.trim()) && file.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

/** The download name of a converted form's Word file ("Report.rtf" → "Report.docx"); other names unchanged. */
export function wordFileNameFor(file: { fileName: string; mimeType: string }): string {
  return isConvertedFromRtf(file) ? file.fileName.trim().replace(/\.rtf$/i, ".docx") : file.fileName;
}

