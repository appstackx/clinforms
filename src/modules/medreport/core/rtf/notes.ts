/**
 * The staff-facing side of an RTF conversion: the notes (what was left out, what became what – neutral
 * wording, counts and printed names only), recognising them in a form map's warnings, and recognising a
 * form converted from RTF. A small module of its own so the mapping screen and downloads use it without
 * loading the converter.
 *
 * Browser-safe and pure.
 */
import type { RtfStats } from "./model";

export const RTF_NOTE_PREFIX = "Converted from RTF: ";

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
  if (stats.practiceCodes > 0) {
    const examples = stats.practiceCodeNames.slice(0, 3).map((n) => `<<${n}>>`).join(", ");
    notes.push(
      `${p}${plural(stats.practiceCodes, "merge code")} from your clinic system${examples ? ` (${examples})` : ""} ${stats.practiceCodes === 1 ? "was" : "were"} kept, so the matching details from the patient's record fill ${stats.practiceCodes === 1 ? "it" : "them"} – check the mapping once.`,
    );
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
