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
import { docxAnchorBlockIds, formAnchorPdfFieldNames } from "./forms";
import { clearsItsPlaceholder, issueDetails, type BoxIssue, type IssueContent } from "./issue-state";
import { findPracticeCodes, practiceCodeWords } from "./practice-merge-codes";
import type { FormDefinition, FormMergeField } from "./types";

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

/**
 * A clinic-system code in plain words (fix 10/2026, Blue Heart test run): what the code dictionary says it holds, in
 * the same words as the staff screens (practiceCodeWords) – <<P_GROUPREF>> → "your clinic system's placeholder for the
 * referrer's reference for this case" – so a clinician never reads the raw code. A code the dictionary does not know
 * keeps its name, in quotes, so staff can find it on the form. Null for anything else («Patient Name» and MERGEFIELD
 * read as printed).
 */
export function practiceCodeInWords(token: string): string | null {
  const found = findPracticeCodes(token);
  if (found.length !== 1 || found[0].text !== token) return null;
  const words = practiceCodeWords(found[0].code);
  return words ? `your clinic system's placeholder for ${words}` : `your clinic system's placeholder “${found[0].code}”`;
}

/** listMergeTokens() with clinic-system codes in plain words (the same text when there are none). */
export function listMergeTokensInWords(tokens: readonly string[], max = 3): string {
  return listMergeTokens(tokens.map((t) => practiceCodeInWords(t) ?? t), max);
}

export interface UnresolvedMergeField extends FormMergeField {
  /** How many times this text is left there. */
  count: number;
  /**
   * The question whose answer replaces it (fix round 1), else one whose answer box is in the same place (for "Go to"),
   * when there is one.
   */
  fieldId?: string;
}

/**
 * bh2 WA1 design 5: whether a box's fill removes what is printed in its place – its issue state
 * (core/issue-state.ts): answered, filled at approval (sign-off), ruled out by a frozen condition or a person, a session
 * not attended, or empty by design. A box with no answer, left blank on purpose, or ruled out only by the earlier
 * run-time reading leaves its code there.
 */
function clears(box: BoxIssue | undefined): boolean {
  return Boolean(box && clearsItsPlaceholder(box));
}

function inBlock(anchorBlockId: string, blockId: string): boolean {
  return anchorBlockId === blockId || anchorBlockId.startsWith(`${blockId}.`);
}

/**
 * The form's recorded mail-merge fields that the completed form would still contain: a Word body field
 * is cleared only by as many questions replacing exactly that text in that place whose box clears it (answered,
 * sign-off – written at approval –, not asked, or empty by design: see clears() above); a fillable PDF field's printed
 * value by such a question in that field; a `fixed` one (page header or footer, a Word field code, text printed on a
 * PDF page) never. `report` is the whole report (its approver decides whether an "applies anyway" counts).
 */
export function unresolvedMergeFields(form: Pick<FormDefinition, "analysis" | "fields">, report: IssueContent): UnresolvedMergeField[] {
  const entries = form.analysis.mergeFields ?? [];
  if (entries.length === 0) return [];
  const boxes = new Map(issueDetails(report, form).map((b) => [b.key, b]));
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
      // Fix round 1 (B0-10): the question whose answer replaces the code owns it ("Reference <<P_GROUPREF>>" on a line
      // that starts "Claimant <<P_TITLE>>" is F-04's, not the line's first question); else the first one there.
      let owner: string | undefined;
      for (const f of form.fields) {
        if (f.anchor.kind !== "docx") continue;
        const blocks = docxAnchorBlockIds(f.anchor);
        if (!blocks.some((b) => inBlock(b, blockId))) continue;
        near ??= f.id;
        // (A question that writes AFTER the printed text – writeAfter, 10/2026 – leaves the code there.)
        const replaces = f.anchor.target === "replace_placeholder" && !f.anchor.writeAfter && (f.anchor.placeholderText ?? "").indexOf(g.text) >= 0;
        if (replaces) owner ??= f.id;
        if (replaces && clears(boxes.get(f.id))) cleared += 1;
      }
      near = owner ?? near;
    } else if (!g.fixed && g.fieldName) {
      for (const f of form.fields) {
        if (!formAnchorPdfFieldNames(f.anchor).includes(g.fieldName)) continue;
        near ??= f.id;
        if (clears(boxes.get(f.id))) cleared += 1;
      }
    }
    const left = g.count - cleared;
    if (left > 0) out.push({ ...g, count: left, ...(near && { fieldId: near }) });
  });
  return out;
}
