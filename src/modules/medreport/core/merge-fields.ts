/**
 * Mail-merge fields must never reach an approved form (10/2026, all forms – Word and PDF, uploaded as
 * they are or converted from RTF).
 *
 * A template a clinic keeps for its practice system's mail merge carries fields such as «Patient_Name»,
 * <<Referral Ref>> or Word MERGEFIELD codes. Left on the completed form they are wrong (an unfilled
 * field sent to an insurer) or worse (a Word field code that changes when the document is opened). So:
 * - the RTF converter turns merge fields into empty answer spaces (core/rtf);
 * - POST /forms/analyse records the ones left in any other file (FormAnalysis.mergeFields, see
 *   FormMergeFieldSchema; forms/merge-scan.ts finds them);
 * - validation blocks approval while one is left (core/validation/merge-fields.ts: an answer that
 *   contains one, or one in the form that no answered question replaces – unresolvedMergeFields below);
 * - a FINAL render refuses a completed file that still contains one (forms/render-form.ts).
 *
 * Narrow on purpose, so it never fires on ordinary text: «…» and <<…>> only around a short name that
 * starts with a letter (letters, digits, spaces, _ . - / – at most 40 characters), and the upper-case
 * word MERGEFIELD. Square brackets, braces, $…$ and %…% are NOT merge fields here (they are noted, not
 * removed, by the RTF converter; "[…]" blanks are the forms engine's own fill-in placeholders).
 *
 * Browser-safe and pure.
 */
import { docxAnchorBlockIds, formAnchorPdfFieldNames, isBlankByDesign, isSectionAnswered } from "./forms";
import type { FormDefinition, FormField, FormMergeField, Report } from "./types";

const TOKEN = "«[A-Za-z][A-Za-z0-9 _.\\-/]{0,39}»|<<[A-Za-z][A-Za-z0-9 _.\\-/]{0,39}>>|\\bMERGEFIELD\\b";

/** Every merge-looking token in the text, in order, repeats included. */
export function findMergeTokens(text: string): string[] {
  if (!text || (text.indexOf("«") < 0 && text.indexOf("<<") < 0 && text.indexOf("MERGEFIELD") < 0)) return [];
  const re = new RegExp(TOKEN, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[0]);
  return out;
}

export function hasMergeToken(text: string): boolean {
  return findMergeTokens(text).length > 0;
}

/** "«Patient_Name», «DOB» and 2 more" for messages. */
export function listMergeTokens(tokens: readonly string[], max = 3): string {
  const distinct = Array.from(new Set(tokens));
  const shown = distinct.slice(0, max);
  const more = distinct.length - shown.length;
  return `${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}

export interface UnresolvedMergeField extends FormMergeField {
  /** How many times this text is left there. */
  count: number;
  /** A question whose answer box is in the same place (for "Go to"), when there is one. */
  fieldId?: string;
}

function answeredOrSignoff(field: FormField, report: Pick<Report, "sections">): boolean {
  if (field.fillSource.kind === "signoff") return true; // written from the approval receipt
  const section = report.sections.find((s) => s.key === field.id);
  return Boolean(section && isSectionAnswered({ paragraphs: section.paragraphs ?? [], answer: section.answer, blankFromRecords: isBlankByDesign(section, field) }));
}

function inBlock(anchorBlockId: string, blockId: string): boolean {
  return anchorBlockId === blockId || anchorBlockId.startsWith(`${blockId}.`);
}

/**
 * The form's recorded mail-merge fields that the completed form would still contain: a Word body field
 * is cleared only by as many answered questions replacing exactly that text in that place (sign-off
 * questions count – they are written at approval); a fillable PDF field's printed value by an answered
 * question in that field; a `fixed` one (page header or footer, a Word field code, text printed on a PDF
 * page) never.
 */
export function unresolvedMergeFields(form: Pick<FormDefinition, "analysis" | "fields">, report: Pick<Report, "sections">): UnresolvedMergeField[] {
  const entries = form.analysis.mergeFields ?? [];
  if (entries.length === 0) return [];
  const groups = new Map<string, UnresolvedMergeField>();
  for (const e of entries) {
    const key = `${e.blockId ?? ""}|${e.fieldName ?? ""}|${e.fixed ? "fixed" : ""}|${e.where}|${e.text}`;
    const g = groups.get(key);
    if (g) g.count += 1;
    else groups.set(key, { ...e, count: 1 });
  }
  const out: UnresolvedMergeField[] = [];
  groups.forEach((g) => {
    let cleared = 0;
    let near: string | undefined;
    if (!g.fixed && g.blockId) {
      const blockId = g.blockId;
      for (const f of form.fields) {
        if (f.anchor.kind !== "docx") continue;
        const blocks = docxAnchorBlockIds(f.anchor);
        if (!blocks.some((b) => inBlock(b, blockId))) continue;
        near ??= f.id;
        if (f.anchor.target === "replace_placeholder" && (f.anchor.placeholderText ?? "").indexOf(g.text) >= 0 && answeredOrSignoff(f, report)) cleared += 1;
      }
    } else if (!g.fixed && g.fieldName) {
      for (const f of form.fields) {
        if (!formAnchorPdfFieldNames(f.anchor).includes(g.fieldName)) continue;
        near ??= f.id;
        if (answeredOrSignoff(f, report)) cleared += 1;
      }
    }
    const left = g.count - cleared;
    if (left > 0) out.push({ ...g, count: left, ...(near && { fieldId: near }) });
  });
  return out;
}
