import "server-only";

/**
 * Write answers into the referrer's ORIGINAL Word form (Word in → Word out), keeping its layout,
 * styles, headers and footers. Each FormField's anchor (core/schemas.ts DocxAnchorSchema) says where:
 *
 *   table_cell           the answer cell: its empty paragraph(s) – or the blank lines after the question
 *                        in a question-and-answer box – receive the answer; extra paragraphs are added.
 *   after_paragraph      new paragraph(s) after the question, using the blank / dotted lines that follow
 *                        it as answer space first.
 *   replace_placeholder  the placeholder text ("____", "……", "[Insert prognosis]", a bare "Answer:")
 *                        is replaced in place, even when it is split across runs; dotted continuation
 *                        lines after an "Answer: ____" line take the rest of a long answer.
 *   content_control      the w:sdt's content is set (placeholder state cleared; date pickers get the date).
 *   checkbox_glyph       the chosen option's ☐ becomes ☒ (also symbol-font boxes, w14:checkbox content
 *                        controls and legacy FORMCHECKBOX fields); other options of the question are cleared.
 *   legacy_form_field    the FORMTEXT field's result is set.
 *   mark_cell            (10/2026) a "mark the column" table: the chosen option's cell gets the mark ("X" by default),
 *                        a mark-only cell of another option is cleared; never a mark in the wrong column.
 *   delete_options       (10/2026) a "delete as necessary" list: only the chosen option is kept – the others are
 *                        REMOVED (inline list replaced by the chosen option; option lines removed, an emptied line too).
 *   Typed tick boxes ("[ ]", "[x]") are tick boxes for checkbox_glyph: "[ ]" → "[x]", and "[x]" → "[ ]".
 *   replace_placeholder with clearPlaceholder (10/2026): an unanswered question's printed text is removed (DRAFT too).
 *
 * Template instructions (10/2026, core/template-instructions.ts): once every answer is written, the form author's notes
 * for whoever completes the form ("Delete unused cells", "Delete as necessary", "(Please delete other choices)") are
 * left off – with a line or row they emptied and, for "Delete unused cells", the repeat rows the report left as
 * printed – and a note says so. A note beside a list of options only once an answer has chosen from that list. Never
 * inside an answer; a form without such notes is written exactly as before, and so is one printing more than
 * MAX_INSTRUCTIONS_PER_FORM (hostile sizes).
 *
 * Answers come from core/forms.ts buildFormAnswers(report, form, {receipt}). Anchors are resolved on the
 * ORIGINAL document before anything changes, so every block ID means what the outline said. Text is
 * written through the DOM (XML-escaped) with invalid XML characters removed.
 *
 * DRAFT (opts.draft): a red "DRAFT – awaiting clinician approval" banner at the top of the body (a
 * bookmarked paragraph that the outline skips), sign-off fields blank (the caller passes no receipt).
 * reviewMarkers: answers highlighted and tagged "[F-07]"; unanswered questions get a grey marker.
 * FINAL: no banner, no markers. Never removes or reorders the referrer's own content (only the blank /
 * dotted answer lines an answer has used are replaced, and the template instructions above).
 *
 * bh2 WA2 (the fill reports what it did, plan WA2 designs 1, 2, 4–6): fillDocxReport returns one FillOutcome per field
 * (core/issue-types.ts) – what the box was meant to issue (an answer, a sign-off value, a blank or not-applicable box),
 * what the fill did at its anchor (written, cleared, removed, as printed, not found, collision), and anything left there
 * that reads as an answer (residue: a pre-printed mark or tick, an option list, a printed default, a merge code, the
 * printed words of a blank sentence opener, repeated printed words). Residue is checked in the DOM before it is saved, on
 * the elements resolved before anything changed – never by block ID, because rows and lines are removed. A FINAL copy
 * with a fatal outcome is refused (forms/render-form.ts, 422); a DRAFT reports it. Fatal: not found, collision, an
 * answer or sign-off value that was not written, residue on a decided box. Informational (`note`): the template
 * instructions left off, a "tick all that apply" text answer that names no printed column (nothing is marked).
 * - Choice anchors end explicit: the chosen options marked, ticked or kept, every other one cleared – and checked both
 *   ways (a chosen mark or tick cleared later by another answer is fatal). An answer the engine cannot read as printed
 *   options (forms/choice-marks.ts resolveChoice: "Not recorded", "No mention in the notes", an option not printed,
 *   several options of a single choice) leaves them as printed – never a guess – and is fatal.
 * - A box left blank prints nothing that reads as an answer (ledger hook "fill-leave-blank"): pre-printed marks and
 *   ticks cleared, an option list removed, a printed default removed, a content control or Word form field emptied, and
 *   (Khuram, 26/10) an optional sentence opener ("To return to …") loses its printed lead words and dots – a clause, not
 *   a label ("Assessed by ……" stays; openerLead). A merge code is cleared only where the box is not applicable or the
 *   record has nothing for it – in a box left blank it stays, so the copy is refused (the validators block approval
 *   before that). A tick box or marked column the record leaves empty is a blank box too. A blank left printed is
 *   skipped like an unanswered one, so a later answer to the same placeholder in that place takes the next blank.
 * - A FINAL box nobody decided (no answer, no decision: a box without a report section) is written as before, but a
 *   pre-printed tick, mark or default value there reads as an answer: checked, so the copy is refused (Track.checkOnly).
 * - Bounded work (R-security-2/3; review 26/10: counted in what the document holds, not in lines): every line a question
 *   reads is counted by its size – its runs, properties and text pieces, and its text – and every change by the
 *   children its parent re-indexes, against MAX_FILL_STEPS; a line a question reads holding more of the form's own
 *   content than MAX_LINE_SIZE, a cell of more than MAX_BLOCK_PARAGRAPHS lines, a body of more than MAX_FILL_BLOCKS
 *   blocks: 422 FORM_TOO_COMPLEX. The typography an answer takes is resolved once per cell and row, lazily, only on
 *   forms converted from RTF, from at most 64 paragraphs and 16 cells; a line is only left off where its parent holds
 *   few siblings.
 * - normaliseAnswerParagraph on every write path: a paragraph inside a table cell that receives an answer never keeps
 *   a negative right indent (B0-31, B3-20); on a converted RTF form an answer is never bold, italic or underlined.
 *
 * Owner: WA2 (forms engine) – docs/bh2-ownership.json. fillDocx's signature is unchanged.
 */
import { HttpError } from "../api/http";
import { docxAnchorBlockIds, isAnswerableField, printsDefault, type FormFillAnswer, type FormFillAnswers } from "../core/forms";
import type { BoxState, BoxStateKind, FillOutcome, FillOutcomeKind } from "../core/issue-types";
import { findMergeTokens, hasMergeToken, listMergeTokensInWords } from "../core/merge-fields";
import { isConvertedFromRtf } from "../core/rtf/notes";
import { defineHook, hookEnabled } from "../core/validation/hooks";
import { resolveChoice, type ChoiceResolution } from "./choice-marks";
import {
  MAX_INSTRUCTIONS_PER_FORM,
  findTemplateInstructions,
  instructionColour,
  instructionsLeftOffNote,
  mayHoldInstruction,
  type TemplateInstruction,
} from "../core/template-instructions";
import type { FormDefinition, FormField } from "../core/types";
import {
  CHECKED_GLYPH,
  W_NS as W_NS_URI,
  DRAFT_BANNER_BOOKMARK,
  UNCHECKED_GLYPH,
  W14_NS,
  XML_NS,
  ancestorW,
  bracketBoxText,
  childElements,
  cleanXmlText,
  descendantsW,
  findPlaceholders,
  firstW,
  glyphSlots,
  indexBlocks,
  isAnswerSpaceParagraph,
  isBareLabel,
  isElement,
  isFillLine,
  isW,
  loadDocxDom,
  paragraphSegments,
  paragraphText,
  saveDocxDom,
  segmentsText,
  setWAttr,
  symCharFor,
  wAttr,
  wChildren,
  wEl,
  type BlockIndex,
  type BlockRef,
  type DocxDom,
  type GlyphSlot,
  type XmlElement,
  type XmlNode,
} from "./docx-dom";
import type { FillOptions } from "./types";

/* ------------------------------------------------------------------------------------------------
 * Ordered property helpers (Word is strict about the order of rPr / pPr children)
 * ----------------------------------------------------------------------------------------------*/

const RPR_ORDER = [
  "rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow", "emboss", "imprint",
  "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz", "szCs", "highlight", "u",
  "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath",
];
const PPR_ORDER = [
  "pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl", "numPr", "suppressLineNumbers", "pBdr", "shd",
  "tabs", "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct", "topLinePunct", "autoSpaceDE", "autoSpaceDN", "bidi",
  "adjustRightInd", "snapToGrid", "spacing", "ind", "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc", "textDirection",
  "textAlignment", "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange",
];

/** Insert (or replace) a property child at its schema position. */
function setProp(parent: XmlElement, child: XmlElement, order: string[]): void {
  const name = child.localName ?? "";
  for (const existing of childElements(parent)) {
    if (existing.localName === name) {
      parent.replaceChild(child, existing);
      return;
    }
  }
  const rank = order.indexOf(name);
  for (const existing of childElements(parent)) {
    const r = order.indexOf(existing.localName ?? "");
    if (r > rank) {
      parent.insertBefore(child, existing);
      return;
    }
  }
  parent.appendChild(child);
}

function cloneEl(el: XmlElement): XmlElement {
  return el.cloneNode(true) as XmlElement;
}

/** A copy of an element of the form (a run, its properties), counted: xmldom copies a node at many times a read's cost. */
function cloneCounted(ctx: Ctx, el: XmlElement): XmlElement {
  countCopy(ctx, el);
  return cloneEl(el);
}

/**
 * A copy of a property element (rPr / pPr) without the children `drop` names – built by appending (linear), never by
 * removing children one by one (xmldom re-indexes on every removal: quadratic on a hostile element). Every other child,
 * text and comment nodes too, is copied in order, so the result is the same XML as a copy with those children removed.
 * Counted (bounded work).
 */
function copyWithout(ctx: Ctx, el: XmlElement, drop: (name: string) => boolean): XmlElement {
  countCopy(ctx, el);
  const out = el.cloneNode(false) as XmlElement;
  for (let n = el.firstChild; n; n = n.nextSibling) if (!isElement(n) || !drop(n.localName ?? "")) out.appendChild(n.cloneNode(true));
  return out;
}

/** Inserted after `ref` (counted unless it becomes the last child: xmldom then re-indexes the parent's children). */
function insertAfter(ctx: Ctx, node: XmlElement, ref: XmlElement): void {
  const parent = ref.parentNode;
  if (!parent) return;
  if (ref.nextSibling) {
    reindexed(ctx, parent);
    parent.insertBefore(node, ref.nextSibling);
  } else parent.appendChild(node);
}

/** Inserted before `ref` in `parent` (counted). */
function insertBefore(ctx: Ctx, parent: XmlNode, node: XmlElement, ref: XmlNode | null): void {
  if (ref) reindexed(ctx, parent);
  parent.insertBefore(node, ref);
}

/** Removed from its parent (counted). */
function remove(ctx: Ctx, node: XmlNode): void {
  const parent = node.parentNode;
  if (!parent) return;
  reindexed(ctx, parent);
  parent.removeChild(node);
}

/* ------------------------------------------------------------------------------------------------
 * Fill context, outcomes and the step budget
 * ----------------------------------------------------------------------------------------------*/

/**
 * Ledger hook (core/validation/__corpus__/ledger.json "fill-leave-blank", exemption): a box left blank on a FINAL copy
 * prints nothing – no pre-printed mark, tick, option list, default, frame or merge code. Disabled only inside the
 * corpus seam (core/validation/hooks.ts withHookDisabled); the residue checks still run then, so the copy is refused.
 */
export const FILL_LEAVE_BLANK_HOOK = defineHook("fill-leave-blank");

/**
 * Bounded work (R-security-2/3, plan WA2 design 4; review 26/10 – counted in what the document holds, not in lines).
 * The work a fill does for its questions is counted in steps, against one budget:
 * - each read of a line (a paragraph) for a question – a placeholder looked for, a tick box or option found, a cell's
 *   answer space, a residue check, the typography beside an answer – counts the line's size: its nodes (runs, their
 *   properties, text pieces, tabs, bookmarks), one step per TEXT_PER_STEP characters of its text and LINE_STEPS for the
 *   read itself (sizeOf, readLines); a copy counts COPY_STEPS per node copied;
 * - each change counts the children its parent re-indexes (xmldom re-indexes a parent's children on every removal and
 *   every insertion before a sibling – a run split, a line or row left off, an answer line added).
 * Blue Heart's 17 forms hold at most 613 blocks (paragraphs and table cells), 20 paragraphs in a cell and 13 runs in a
 * line; filling one takes at most about 31,000 steps, long answers included – 1.5% of the budget (DocxFillReport.work).
 * At the budget a fill has done well under 2 s of work on the hostile shapes of the review. Past any bound the form is
 * refused 422 FORM_TOO_COMPLEX before or while it is filled:
 * - MAX_FILL_BLOCKS blocks in the body (the passes over the whole body – the template instructions – stay linear up to
 *   the 200,000-line files of the security review, scripts/medreport/template-instructions.test.ts, and are not counted);
 * - MAX_BLOCK_PARAGRAPHS paragraphs in a cell that a question fills, ticks or clears (each such question reads all of it);
 * - MAX_LINE_SIZE of the form's own content in a line a question reads (refused when the line is first read);
 * - MAX_FILL_STEPS steps in all.
 */
export const MAX_FILL_BLOCKS = 300_000;
export const MAX_BLOCK_PARAGRAPHS = 2_000;
export const MAX_LINE_SIZE = 5_000;
export const MAX_FILL_STEPS = 2_000_000;
/** Characters of text counted as one step (a node walked costs about as much as this many characters searched). */
const TEXT_PER_STEP = 32;
/** Steps counted per line read, whatever its size (reading even an empty line has its own cost). */
const LINE_STEPS = 8;
/** Typography sources: at most this many paragraphs of a cell, and cells of a row, are read (plan WA2 design 4). */
const MAX_SOURCE_PARAGRAPHS = 64;
const MAX_SOURCE_CELLS = 16;
/** Siblings stepped over when looking beside a block (the answer lines after a question, the label cell before). */
const MAX_SIBLINGS_SCANNED = 64;

/** Options of a Word fill (FillOptions plus the issue state, when the caller has it). */
export interface DocxFillOptions extends FillOptions {
  /**
   * What each box issues (WA1's issueState, core/issue-types.ts), when the caller has it: a not-applicable box prints
   * nothing whatever the answers hold, and its merge code is cleared. Without it the answers say it (core/forms
   * FormFillAnswer: text / rows = an answer, leftBlank, blank = the record has nothing for it).
   */
  states?: Readonly<Record<string, BoxState | undefined>>;
}

/** What one field was meant to issue and what the fill did there. */
interface Track {
  field: FormField;
  intended: BoxStateKind;
  /** Why the box is blank / not applicable (BoxState reason), for the merge-code and opener rules. */
  reason: string | null;
  /** The box's issued content is settled: an answer, a sign-off value, or a blank box on a FINAL copy. */
  decided: boolean;
  outcome: FillOutcomeKind;
  /** Why the outcome is wrong (plain words), when it is. */
  problem: string | null;
  residue: string[];
  notes: string[];
  /** An answer that was not written but is informational only (a text "tick all that apply" naming no column). */
  noteOnly: boolean;
  /**
   * A FINAL box nobody decided (no answer and no decision – a box without a report section): its residue is checked as
   * a blank box's is, but nothing printed there is cleared – the copy is refused rather than changed (review 26/10).
   */
  checkOnly: boolean;
  /** Runs this fill wrote for the field (answers, marks, kept options). */
  runs: XmlElement[];
  /** Residue checks on the elements resolved before anything changed, run once the whole form is filled. */
  checks: Array<() => string[]>;
}

const OUTCOME_RANK: Record<FillOutcomeKind, number> = { as_printed: 0, cleared: 1, removed: 2, written: 3, not_found: 4, collision: 5 };

function setOutcome(t: Track | null | undefined, kind: FillOutcomeKind, problem?: string): void {
  if (!t) return;
  if (OUTCOME_RANK[kind] >= OUTCOME_RANK[t.outcome]) t.outcome = kind;
  if (problem && !t.problem) t.problem = problem;
}

function tooComplex(detail: string): HttpError {
  return new HttpError(422, "This form is too complex to fill", { code: "FORM_TOO_COMPLEX", detail: `${detail} Use the referrer's form as it was published, or ask for a simpler copy.` });
}

/**
 * Whether a blank box's printed residue is cleared (the ledger hook "fill-leave-blank", and not a box only checked –
 * Track.checkOnly). Otherwise it is only checked, so the copy is refused.
 */
function clearsBlank(t: Track | null | undefined): boolean {
  return hookEnabled(FILL_LEAVE_BLANK_HOOK) && !t?.checkOnly;
}

/** Count work against the step budget; 422 FORM_TOO_COMPLEX past it. Nothing is counted outside the questions' work. */
function step(ctx: Ctx, n = 1): void {
  if (!ctx.counting) return;
  ctx.steps += n;
  if (ctx.steps > MAX_FILL_STEPS) throw tooComplex("Filling this form takes more work than any real form needs.");
}

/** xmldom re-indexes a parent's children when one is removed or inserted before another: counted. */
function reindexed(ctx: Ctx, parent: XmlNode): void {
  if (ctx.counting) step(ctx, parent.childNodes.length);
}

/**
 * The size of an element for the step budget (see MAX_FILL_STEPS): its nodes, and one step per TEXT_PER_STEP characters
 * of text – `all`, and `printed`, the form's own part (runs this fill wrote left out). A bounded walk: it stops once
 * `printed` passes `printedLimit` or `all` passes `allLimit`, so a hostile line is never walked whole.
 */
function sizeOf(root: XmlNode, printedLimit: number, allLimit = Infinity): { all: number; printed: number } {
  let all = 0;
  let printed = 0;
  let written: XmlNode | null = null;
  let node: XmlNode | null = root;
  while (node) {
    const cost = node.nodeType === 3 || node.nodeType === 4 ? 1 + Math.floor((node.nodeValue?.length ?? 0) / TEXT_PER_STEP) : 1;
    if (!written && isElement(node) && isWritten(node)) written = node;
    all += cost;
    if (!written) printed += cost;
    if (printed > printedLimit || all > allLimit) break;
    if (node.firstChild) {
      node = node.firstChild;
      continue;
    }
    // Next in document order within root: the next sibling of this node or of the nearest ancestor that has one.
    while (node && node !== root) {
      if (node === written) written = null;
      if (node.nextSibling) break;
      node = node.parentNode;
    }
    if (!node || node === root) break;
    node = node.nextSibling;
  }
  return { all, printed };
}

/**
 * Lines (paragraphs) read for a question, `passes` times each: counted by their size (sizeOf). A line holding more of
 * the form's own content than MAX_LINE_SIZE is refused when first read – no real form comes near it (Blue Heart's
 * largest line is a few hundred) – and so is the read that passes the budget.
 */
function readLines(ctx: Ctx, lines: readonly XmlElement[], passes = 1): void {
  if (!ctx.counting) return;
  for (const p of lines) {
    const size = sizeOf(p, MAX_LINE_SIZE, (MAX_FILL_STEPS - ctx.steps) / passes + 1);
    if (size.printed > MAX_LINE_SIZE) throw tooComplex(`A line of this Word file holds more than ${MAX_LINE_SIZE.toLocaleString("en-GB")} pieces of text and formatting; a line that is filled here holds at most ${MAX_LINE_SIZE.toLocaleString("en-GB")}.`);
    step(ctx, (size.all + LINE_STEPS) * passes);
  }
}

/** Steps counted per node copied (xmldom's copy of a node costs about this many reads of one). */
const COPY_STEPS = 8;

/** A copy of `el` for a question: counted by its size (COPY_STEPS per node), the walk bounded by what is left. */
function countCopy(ctx: Ctx, el: XmlElement): void {
  if (!ctx.counting) return;
  step(ctx, sizeOf(el, Infinity, (MAX_FILL_STEPS - ctx.steps) / COPY_STEPS + 1).all * COPY_STEPS);
}

/** A part of the form read whole for a question (a cell's content controls or form fields): counted by its size. */
function readPart(ctx: Ctx, el: XmlElement): void {
  if (!ctx.counting) return;
  step(ctx, sizeOf(el, Infinity, MAX_FILL_STEPS - ctx.steps + 1).all);
}

interface Ctx {
  dom: DocxDom;
  index: BlockIndex;
  form: FormDefinition;
  opts: DocxFillOptions;
  warn(message: string): void;
  /** The outcome of each answerable field. */
  tracks: Map<FormField, Track>;
  /** The field being written (runs made now are its runs). */
  current: Track | null;
  /** Places an answer was written: the field that took each (two answers in one place collide). */
  claims: Map<string, Track>;
  /** Ids of the elements claims are keyed on. */
  claimIds: WeakMap<XmlElement, number>;
  nextClaimId: number;
  /** Work done so far (step budget). */
  steps: number;
  /** The questions' work is being counted (false while the form author's instructions are left off – bounded on their own). */
  counting: boolean;
  /** How many times typography sources were read from the document (cells and answer space) – DocxFillReport.work. */
  typographyReads: number;
  /** Typography sources, resolved once per paragraph, cell and row (RTF forms only). */
  sources: { firstRun: WeakMap<XmlElement, XmlElement | null>; row: WeakMap<XmlElement, XmlElement[]>; spaces: WeakMap<XmlElement, XmlElement[]> };
  /** Placeholder occurrences left in place by unanswered fields, per block element + placeholder text. */
  skipped: Map<XmlElement, Map<string, number>>;
  usedControls: Set<XmlElement>;
  usedLegacy: Set<XmlElement>;
  /** Tick-box changes inside text (☐ → ☒, "[ ]" → "[x]"), applied together once every tick box is decided (10/2026). */
  glyphEdits: Map<XmlElement, Array<{ offset: number; length: number; text: string }>>;
  /** Paragraphs a "delete as necessary" answer removed printed text from (10/2026 verify). */
  deletedParas: Set<XmlElement>;
  /** "Delete as necessary" questions whose list an answer settled – the chosen options kept, the others removed (25/10). */
  chosenLists: Set<FormField>;
  /**
   * Fix round 1 (B0-13): a form converted from RTF when it was added (core/rtf). Its text carries its font, size and
   * colour on every run, and its document defaults (the converter's Times New Roman 12 pt) are never the form's own.
   */
  rtf: boolean;
}

function where(field: FormField): string {
  return `${field.id} (“${field.label}”)`;
}

function trackOf(ctx: Ctx, field: FormField): Track | null {
  return ctx.tracks.get(field) ?? null;
}

/** A stable id per element, for claim keys. */
function elementId(ctx: Ctx, el: XmlElement): number {
  let id = ctx.claimIds.get(el);
  if (id === undefined) {
    ctx.nextClaimId += 1;
    id = ctx.nextClaimId;
    ctx.claimIds.set(el, id);
  }
  return id;
}

/**
 * Claim a place for a field's answer (an answer cell, a paragraph to write after, a tick box, a marked cell, an
 * occurrence of a placeholder or list). A second decided field claiming the same place collides with the first: both
 * are fatal – two answers mapped to one place are never issued.
 */
function claim(ctx: Ctx, field: FormField, el: XmlElement, what: string): boolean {
  const t = trackOf(ctx, field);
  if (!t || !t.decided) return true;
  const key = `${elementId(ctx, el)}|${what}`;
  const other = ctx.claims.get(key);
  if (other && other !== t) {
    const problem = (f: FormField) => `it is mapped to the same place on the form as ${f.id} (“${f.label}”), so one answer would cover the other`;
    setOutcome(t, "collision", problem(other.field));
    setOutcome(other, "collision", problem(field));
    return false;
  }
  ctx.claims.set(key, t);
  return true;
}

/** The element is still part of the document body (not removed with a row or line). */
function isAttached(ctx: Ctx, el: XmlElement): boolean {
  for (let n: XmlNode | null = el; n; n = n.parentNode) if (n === ctx.dom.body) return true;
  return false;
}

/**
 * Every paragraph that receives an answer (plan WA2 design 5, all write paths): inside a table cell it never keeps a
 * negative right indent (RTF templates carry "\ri-330", which runs long answers over the cell's border – B0-31, B3-20),
 * and on a form converted from RTF the answer runs carry no bold, italic or underline (a label's emphasis – B0-13).
 */
function normaliseAnswerParagraph(ctx: Ctx, p: XmlElement | null, runs: readonly XmlElement[] = []): void {
  if (!p) return;
  clampRightIndentInCell(ctx, firstW(p, "pPr"), p);
  if (!ctx.rtf) return;
  for (const run of runs) {
    const rPr = firstW(run, "rPr");
    if (!rPr || !childElements(rPr).some((c) => EMPHASIS.has(c.localName ?? ""))) continue;
    // Rebuilt rather than emptied child by child (bounded work: linear in the properties).
    run.replaceChild(copyWithout(ctx, rPr, (name) => EMPHASIS.has(name)), rPr);
  }
}

/** Bold, italic and underline: a label's emphasis, never an answer's. */
const EMPHASIS = new Set(["b", "bCs", "i", "iCs", "u"]);

/** The answer as text, or "" when unanswered. */
function answerText(field: FormField, answer: FormFillAnswer): string {
  let text = answer.text ?? "";
  if (!text.trim() && answer.value !== undefined && answer.value !== null) {
    text = typeof answer.value === "boolean" ? (answer.value ? "Yes" : "No") : String(answer.value);
  }
  void field;
  return cleanXmlText(text.replace(/\r\n?/g, "\n")).trim();
}

/** Paragraphs (split on blank lines) → lines (split on single newlines). */
function toParagraphs(text: string): string[][] {
  return text
    .split(/\n[ \t]*\n+/)
    .map((p) => p.split("\n").map((l) => l.replace(/[ \t]+$/g, "")))
    .filter((lines) => lines.some((l) => l.trim()));
}

/* ------------------------------------------------------------------------------------------------
 * Runs and paragraphs
 * ----------------------------------------------------------------------------------------------*/

type RunKind = "answer" | "marker" | "unanswered";

/**
 * Runs this fill wrote (answers, marks, kept options, markers), so the template-instruction pass never reads an answer
 * as the form's own text (10/2026). A written run split in two stays marked in both parts.
 */
const WRITTEN = new WeakSet<XmlElement>();
const isWritten = (run: XmlElement | null): boolean => !!run && WRITTEN.has(run);

/** Written runs that print the form's own option again (a "delete as necessary" answer's kept option). */
const KEPT_PRINT = new WeakSet<XmlElement>();
const isKeptPrint = (run: XmlElement | null): boolean => !!run && KEPT_PRINT.has(run);

/** A run split in two keeps what it was in both parts (written by this fill, a kept option). */
function copyWrittenMarks(from: XmlElement, to: XmlElement): void {
  if (WRITTEN.has(from)) WRITTEN.add(to);
  if (KEPT_PRINT.has(from)) KEPT_PRINT.add(to);
}

/** Typography only (font, size, language) – used when copying from a label or question run. */
function typographyOf(ctx: Ctx, rPr: XmlElement | null, keep: string[] = ["rFonts", "sz", "szCs", "lang"]): XmlElement | null {
  if (!rPr) return null;
  const out = copyWithout(ctx, rPr, (name) => !keep.includes(name));
  return childElements(out).length ? out : null;
}

/** The typography an answer takes from the form around it: never bold, italic or underline from a label. */
const ANSWER_TYPOGRAPHY = ["rFonts", "color", "sz", "szCs", "lang"];

/** A colour the form uses for its own instructions or labels, never for an answer: red, or a mid grey. */
function labelOnlyColour(color: XmlElement): boolean {
  const m = /^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(wAttr(color, "val") ?? "");
  if (!m) return false;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  const red = r >= 0xb0 && g < 0x70 && b < 0x70;
  const grey = Math.max(r, g, b) - Math.min(r, g, b) < 0x18 && r >= 0x60 && r <= 0xd8;
  return red || grey;
}

/**
 * Fix round 1 (B0-13), converted RTF forms only: the answer's run properties completed with the font, size, colour and
 * language they lack, from the first of `sources` (run properties of the form text around the answer) that has each –
 * so an answer in a Tahoma form is never Times New Roman, and never black and larger beside dark-blue Calibri. A colour
 * the form keeps for instructions (red) or grey labels is never taken, and the answer is never bold, italic or underlined
 * (a label's emphasis). Any other form is written exactly as before.
 */
function completeTypography(ctx: Ctx, base: XmlElement | null, sources: () => ReadonlyArray<XmlElement | null>): XmlElement | null {
  if (!ctx.rtf) return base;
  // An RTF template's empty answer line carries the bold or underline of the label above it in its paragraph mark.
  let out = withoutEmphasis(ctx, base);
  // Bounded and lazy (R-security-3): the sources are only looked up for a property the answer still lacks.
  let list: ReadonlyArray<XmlElement | null> | null = null;
  for (const key of ANSWER_TYPOGRAPHY) {
    if (out && firstW(out, key)) continue;
    list ??= sources();
    for (const src of list) {
      const el = firstW(src, key);
      if (!el || (key === "color" && labelOnlyColour(el))) continue;
      out ??= wEl(ctx.dom, "rPr");
      setProp(out, cloneEl(el), RPR_ORDER);
      break;
    }
  }
  return out;
}

/**
 * Run properties of the whitespace-only runs in `paras` (an RTF template's typed spaces carry its answer style): the
 * first MAX_SOURCE_PARAGRAPHS paragraphs, resolved once per cell (`key`) – the form's own runs, never an answer's.
 */
function spaceRunRPrs(ctx: Ctx, paras: XmlElement[], key: XmlElement | null): XmlElement[] {
  const cached = key ? ctx.sources.spaces.get(key) : undefined;
  if (cached) return cached;
  if (key) ctx.typographyReads += 1;
  const out: XmlElement[] = [];
  for (const p of paras.slice(0, MAX_SOURCE_PARAGRAPHS)) {
    for (const run of wRuns(ctx, p) ?? []) {
      if (isWritten(run)) continue;
      const text = descendantsW(run, "t").map((t) => t.textContent ?? "").join("");
      const rPr = firstW(run, "rPr");
      if (rPr && text !== "" && text.trim() === "") out.push(rPr);
    }
  }
  if (key) ctx.sources.spaces.set(key, out);
  return out;
}

/**
 * The runs of a paragraph (also inside hyperlinks, smart tags and run-level controls), at most 2,000, in document order
 * – or null when the paragraph holds more of the form's own content than MAX_LINE_SIZE: too large to read as a source
 * of typography (a bounded walk, counted; review 26/10).
 */
function wRuns(ctx: Ctx, p: XmlElement): XmlElement[] | null {
  const size = sizeOf(p, MAX_LINE_SIZE, MAX_FILL_STEPS - ctx.steps + 1);
  step(ctx, size.all);
  if (size.printed > MAX_LINE_SIZE) return null;
  const runs = descendantsW(p, "r");
  return runs.length > MAX_SIBLINGS_TO_LEAVE_OFF ? runs.slice(0, MAX_SIBLINGS_TO_LEAVE_OFF) : runs;
}

/** Bold, italic and underline dropped (an answer written after a bold label is not bold). */
function withoutEmphasis(ctx: Ctx, rPr: XmlElement | null): XmlElement | null {
  if (!rPr) return null;
  const out = copyWithout(ctx, rPr, (name) => EMPHASIS.has(name));
  return childElements(out).length ? out : null;
}

/** Run properties of a paragraph mark (pPr/rPr) as run properties. */
function markRPr(ctx: Ctx, p: XmlElement | null): XmlElement | null {
  const rPr = firstW(firstW(p, "pPr"), "rPr");
  if (!rPr) return null;
  const out = copyWithout(ctx, rPr, (name) => ["ins", "del", "moveFrom", "moveTo", "rPrChange"].includes(name));
  return childElements(out).length ? out : null;
}

/**
 * First run with visible text in a paragraph or cell, in document order – within its first MAX_SOURCE_PARAGRAPHS
 * paragraphs (bounded: a cell of 200,000 empty lines is never walked whole, R-security-3) and the first
 * MAX_SIBLINGS_SCANNED × MAX_SOURCE_PARAGRAPHS elements around them; a paragraph too large to read (wRuns) gives no run.
 * Counted (review 26/10). `printedOnly`: the form's own runs, never one this fill wrote.
 */
function firstTextRun(ctx: Ctx, container: XmlElement, printedOnly = false): XmlElement | null {
  let seen = 0;
  let stepped = 0;
  const visit = (el: XmlElement): XmlElement | null => {
    if (el.localName === "p" && el.namespaceURI === W_NS_URI) {
      seen += 1;
      for (const run of wRuns(ctx, el) ?? []) {
        if (printedOnly && isWritten(run)) continue;
        if (wChildren(run, "t").some((t) => (t.textContent ?? "").trim())) return run;
        // Text inside a text box or drawing in this run.
        for (const t of descendantsW(run, "t")) if ((t.textContent ?? "").trim()) return ancestorW(t, "r") ?? run;
      }
      return null;
    }
    for (let n = el.firstChild; n && seen < MAX_SOURCE_PARAGRAPHS && stepped < MAX_SIBLINGS_SCANNED * MAX_SOURCE_PARAGRAPHS; n = n.nextSibling) {
      stepped += 1;
      if (!isElement(n)) continue;
      const hit = visit(n);
      if (hit) return hit;
    }
    return null;
  };
  const found = visit(container);
  step(ctx, stepped);
  return found;
}

/** Remove placeholder styling (content-control placeholder style, its grey colour and field shading). */
function withoutPlaceholderStyle(ctx: Ctx, rPr: XmlElement | null): XmlElement | null {
  if (!rPr) return null;
  const out = cloneCounted(ctx, rPr);
  const style = firstW(out, "rStyle");
  if (style && /placeholder/i.test(wAttr(style, "val") ?? "")) {
    out.removeChild(style);
    const color = firstW(out, "color");
    if (color && /^(808080|7F7F7F|A6A6A6|767171)$/i.test(wAttr(color, "val") ?? "")) out.removeChild(color);
    const shd = firstW(out, "shd");
    if (shd) out.removeChild(shd);
  }
  return out;
}

function makeRun(ctx: Ctx, lines: string[], rPr: XmlElement | null, kind: RunKind): XmlElement {
  const { dom } = ctx;
  const run = wEl(dom, "r");
  WRITTEN.add(run);
  if (kind === "answer") ctx.current?.runs.push(run);
  const props = rPr ? cloneCounted(ctx, rPr) : wEl(dom, "rPr");
  if (kind === "marker" || kind === "unanswered") {
    setProp(props, wEl(dom, "color", { val: kind === "marker" ? "6B7280" : "9CA3AF" }), RPR_ORDER);
    setProp(props, wEl(dom, "sz", { val: "15" }), RPR_ORDER);
    setProp(props, wEl(dom, "szCs", { val: "15" }), RPR_ORDER);
    if (kind === "unanswered") {
      setProp(props, wEl(dom, "i"), RPR_ORDER);
      setProp(props, wEl(dom, "highlight", { val: "lightGray" }), RPR_ORDER);
    }
  } else if (ctx.opts.reviewMarkers) {
    setProp(props, wEl(dom, "highlight", { val: "yellow" }), RPR_ORDER);
  }
  if (childElements(props).length) run.appendChild(props);
  lines.forEach((line, i) => {
    if (i > 0) run.appendChild(wEl(dom, "br"));
    line.split("\t").forEach((part, j) => {
      if (j > 0) run.appendChild(wEl(dom, "tab"));
      if (part === "") return;
      const t = wEl(dom, "t");
      t.setAttributeNS(XML_NS, "xml:space", "preserve");
      t.appendChild(dom.doc.createTextNode(part));
      run.appendChild(t);
    });
  });
  return run;
}

function answerRuns(ctx: Ctx, field: FormField, lines: string[], rPr: XmlElement | null, kind: RunKind, last: boolean): XmlElement[] {
  const runs = [makeRun(ctx, lines, rPr, kind)];
  if (last && kind === "answer" && ctx.opts.reviewMarkers) runs.push(makeRun(ctx, [` [${field.id}]`], rPr, "marker"));
  return runs;
}

function clearParagraph(ctx: Ctx, p: XmlElement): void {
  for (const child of childElements(p)) if (!isW(child, "pPr")) remove(ctx, child);
}

function isHeadingStyle(ctx: Ctx, styleId: string | null): boolean {
  if (!styleId) return false;
  const info = ctx.dom.styles.get(styleId);
  if (info?.headingLevel !== undefined) return true;
  return /^(heading|title|subtitle)/i.test(info?.name ?? styleId);
}

/** Paragraph properties for a NEW answer paragraph modelled on a question paragraph (no heading, numbering, borders). */
function answerPPr(ctx: Ctx, from: XmlElement | null): XmlElement | null {
  const src = firstW(from, "pPr");
  if (!src) return null;
  const out = wEl(ctx.dom, "pPr");
  const style = firstW(src, "pStyle");
  if (style && !isHeadingStyle(ctx, wAttr(style, "val"))) out.appendChild(cloneEl(style));
  for (const name of ["spacing", "ind", "contextualSpacing"]) {
    const el = firstW(src, name);
    if (el) out.appendChild(cloneEl(el));
  }
  clampRightIndentInCell(ctx, out, from);
  const jc = firstW(src, "jc");
  if (jc && ["left", "start", "both"].includes(wAttr(jc, "val") ?? "")) out.appendChild(cloneEl(jc));
  return childElements(out).length ? out : null;
}

/**
 * Fix round 1 (B0-31): an answer paragraph in a table cell never keeps a negative right indent (RTF templates carry
 * "\ri-330"), which runs long answers over the cell's border; it becomes 0. `at` is where the paragraph is.
 */
function clampRightIndentInCell(ctx: Ctx, pPr: XmlElement | null, at: XmlElement | null): void {
  const ind = firstW(pPr, "ind");
  if (!ind || !at || !(isW(at, "tc") || ancestorW(at, "tc"))) return;
  for (const name of ["right", "end"]) {
    const v = Number(wAttr(ind, name) ?? "NaN");
    if (Number.isFinite(v) && v < 0) setWAttr(ctx.dom, ind, name, "0");
  }
}

function newParagraph(ctx: Ctx, pPr: XmlElement | null): XmlElement {
  const p = wEl(ctx.dom, "p");
  if (pPr) p.appendChild(cloneEl(pPr));
  return p;
}

/** At least `twips` of space after a paragraph (keeps several answer paragraphs in one box apart). */
function ensureSpaceAfter(ctx: Ctx, p: XmlElement, twips: number): void {
  let pPr = firstW(p, "pPr");
  if (!pPr) {
    pPr = wEl(ctx.dom, "pPr");
    insertBefore(ctx, p, pPr, p.firstChild);
  }
  const spacing = firstW(pPr, "spacing");
  const after = Number(wAttr(spacing, "after") ?? "NaN");
  if (spacing && Number.isFinite(after) && after >= twips) return;
  const next = spacing ? cloneEl(spacing) : wEl(ctx.dom, "spacing");
  setWAttr(ctx.dom, next, "after", String(twips));
  if (next.hasAttributeNS(W_NS_URI, "afterAutospacing")) next.removeAttributeNS(W_NS_URI, "afterAutospacing");
  setProp(pPr, next, PPR_ORDER);
}

/**
 * Write answer paragraphs into answer-space paragraphs (in order), adding paragraphs after the last one
 * written (or after `after` when there is no space). Unused dotted/underscore lines are removed; blank
 * lines are kept. Returns the last paragraph written.
 */
function writeIntoSpace(
  ctx: Ctx,
  field: FormField,
  paras: string[][],
  space: XmlElement[],
  after: XmlElement | null,
  container: XmlElement | null,
  pPr: XmlElement | null,
  rPr: XmlElement | null,
  kind: RunKind,
): XmlElement | null {
  let last: XmlElement | null = null;
  paras.forEach((lines, i) => {
    let target: XmlElement;
    if (i < space.length) {
      target = space[i];
      clearParagraph(ctx, target);
    } else {
      const template = space.length ? firstW(space[space.length - 1], "pPr") : pPr;
      target = newParagraph(ctx, template ? (isW(template, "pPr") ? template : null) : null);
      const ref = last ?? after;
      if (ref) insertAfter(ctx, target, ref);
      else if (container) container.appendChild(target);
      else return;
    }
    const runs = answerRuns(ctx, field, lines, rPr, kind, i === paras.length - 1);
    for (const run of runs) target.appendChild(run);
    normaliseAnswerParagraph(ctx, target, kind === "answer" ? runs : []);
    if (i < paras.length - 1) ensureSpaceAfter(ctx, target, 100);
    last = target;
  });
  for (const extra of space.slice(paras.length)) if (isFillLine(extra)) remove(ctx, extra);
  return last;
}

/**
 * Contiguous answer-space paragraphs after `p` (blank or dotted lines), stopping at anything else – and after
 * MAX_SIBLINGS_SCANNED siblings (bookmarks and the like are stepped over). Each line looked at is counted.
 */
function followingSpace(ctx: Ctx, p: XmlElement, limit = 12): XmlElement[] {
  const out: XmlElement[] = [];
  let stepped = 0;
  for (let n = p.nextSibling; n && out.length < limit && stepped < MAX_SIBLINGS_SCANNED; n = n.nextSibling) {
    stepped += 1;
    if (!isElement(n)) continue;
    if (isW(n, "bookmarkStart") || isW(n, "bookmarkEnd") || isW(n, "proofErr")) continue;
    if (!isW(n, "p")) break;
    readLines(ctx, [n], ANSWER_SPACE_PASSES);
    if (firstW(firstW(n, "pPr"), "sectPr") || !isAnswerSpaceParagraph(n)) break;
    out.push(n);
  }
  step(ctx, stepped);
  return out;
}

/** isAnswerSpaceParagraph reads a line about this many times (its controls, fields, pictures and text). */
const ANSWER_SPACE_PASSES = 6;

/* ------------------------------------------------------------------------------------------------
 * Text replacement inside a paragraph (across runs)
 * ----------------------------------------------------------------------------------------------*/

const CONTENT_CHILDREN_SKIP = new Set(["rPr"]);

/** Split runs that hold several content children into one run per child (same formatting). Each change is counted. */
function normaliseRuns(ctx: Ctx, p: XmlElement): void {
  for (const run of descendantsW(p, "r")) {
    const content = childElements(run).filter((c) => !CONTENT_CHILDREN_SKIP.has(c.localName ?? ""));
    if (content.length < 2) continue;
    const rPr = firstW(run, "rPr");
    for (const child of content.slice(1).reverse()) {
      const clone = run.ownerDocument!.createElementNS(run.namespaceURI, run.nodeName) as XmlElement;
      copyWrittenMarks(run, clone);
      if (rPr) clone.appendChild(cloneCounted(ctx, rPr));
      // Moving the child out of the run re-indexes the run's children.
      reindexed(ctx, run);
      clone.appendChild(child);
      insertAfter(ctx, clone, run);
    }
  }
}

function setText(t: XmlElement, text: string): void {
  while (t.firstChild) t.removeChild(t.firstChild);
  t.appendChild(t.ownerDocument!.createTextNode(text));
  t.setAttributeNS(XML_NS, "xml:space", "preserve");
}

/** Split a single-text run at `offset`: the run keeps text[offset:], a clone before it gets text[:offset]. */
function splitRunBefore(ctx: Ctx, run: XmlElement, t: XmlElement, offset: number): void {
  const text = t.textContent ?? "";
  if (offset <= 0 || offset >= text.length) return;
  const before = cloneCounted(ctx, run);
  copyWrittenMarks(run, before);
  const bt = firstW(before, "t");
  if (bt) setText(bt, text.slice(0, offset));
  if (run.parentNode) insertBefore(ctx, run.parentNode, before, run);
  setText(t, text.slice(offset));
}

/** Split a single-text run at `offset`: the run keeps text[:offset], a clone after it gets text[offset:]. */
function splitRunAfter(ctx: Ctx, run: XmlElement, t: XmlElement, offset: number): void {
  const text = t.textContent ?? "";
  if (offset <= 0 || offset >= text.length) return;
  const after = cloneCounted(ctx, run);
  copyWrittenMarks(run, after);
  const at = firstW(after, "t");
  if (at) setText(at, text.slice(offset));
  insertAfter(ctx, after, run);
  setText(t, text.slice(0, offset));
}

/**
 * Replace the visible text [start, end) of a paragraph with new runs (end = start inserts). Returns the
 * run properties of the replaced text (for styling the answer) or null when the range could not be
 * addressed.
 */
function replaceRange(ctx: Ctx, p: XmlElement, start: number, end: number, makeRuns: (styleRPr: XmlElement | null) => XmlElement[]): boolean {
  // Bounded work: the line is read about four times here (its runs split, its segments re-read), and changed.
  readLines(ctx, [p], 4);
  normaliseRuns(ctx, p);
  let segs = paragraphSegments(p);
  const locate = (pos: number) => {
    let acc = 0;
    for (const seg of segs) {
      if (pos >= acc && pos < acc + seg.text.length) return { seg, offset: pos - acc };
      acc += seg.text.length;
    }
    return null;
  };
  if (end > start) {
    const s = locate(start);
    if (s && s.seg.kind === "text" && s.seg.run && s.offset > 0) splitRunBefore(ctx, s.seg.run, s.seg.el, s.offset);
    segs = paragraphSegments(p);
    const e = locate(end);
    if (e && e.seg.kind === "text" && e.seg.run && e.offset > 0) splitRunAfter(ctx, e.seg.run, e.seg.el, e.offset);
    segs = paragraphSegments(p);
    const inRange: XmlElement[] = [];
    const seen = new Set<XmlElement>();
    let acc = 0;
    for (const seg of segs) {
      const segStart = acc;
      acc += seg.text.length;
      if (segStart >= start && acc <= end && seg.run && seg.text.length > 0 && !seen.has(seg.run)) {
        seen.add(seg.run);
        inRange.push(seg.run);
      }
    }
    if (inRange.length === 0) return false;
    const first = inRange[0];
    const styleRPr = firstW(first, "rPr");
    const runs = makeRuns(styleRPr ? cloneCounted(ctx, styleRPr) : null);
    for (const run of runs) if (first.parentNode) insertBefore(ctx, first.parentNode, run, first);
    for (const run of inRange) remove(ctx, run);
    return true;
  }
  // Insertion at a position: after the segment that ends there (or at the start).
  let acc = 0;
  let anchor: XmlElement | null = null;
  for (const seg of segs) {
    acc += seg.text.length;
    if (acc === start && seg.run) {
      anchor = seg.run;
      break;
    }
    if (acc > start && seg.kind === "text" && seg.run) {
      splitRunAfter(ctx, seg.run, seg.el, start - (acc - seg.text.length));
      anchor = seg.run;
      break;
    }
  }
  const styleRPr = anchor ? firstW(anchor, "rPr") : null;
  const runs = makeRuns(styleRPr ? cloneCounted(ctx, styleRPr) : null);
  if (anchor) {
    let ref = anchor;
    for (const run of runs) {
      insertAfter(ctx, run, ref);
      ref = run;
    }
  } else {
    const firstRun = descendantsW(p, "r")[0];
    for (const run of runs) {
      if (firstRun?.parentNode) insertBefore(ctx, firstRun.parentNode, run, firstRun);
      else p.appendChild(run);
    }
  }
  return true;
}

/* ------------------------------------------------------------------------------------------------
 * Anchor handlers
 * ----------------------------------------------------------------------------------------------*/

interface Job {
  field: FormField;
  answer: FormFillAnswer;
  ref: BlockRef;
}

function blockParagraphs(ref: BlockRef): XmlElement[] {
  return ref.kind === "cell" ? ref.paragraphs : [ref.el];
}

function labelCellRPr(ctx: Ctx, ref: BlockRef): XmlElement | null {
  return typographyOf(ctx, labelCellRunRPr(ctx, ref));
}

/** Run properties of the first text in the cell before an answer cell (its label), as printed (bounded, counted). */
function labelCellRunRPr(ctx: Ctx, ref: BlockRef): XmlElement | null {
  if (ref.kind !== "cell") return null;
  let prev = ref.el.previousSibling;
  let stepped = 0;
  while (prev && !isW(prev, "tc") && stepped < MAX_SIBLINGS_SCANNED) {
    prev = prev.previousSibling;
    stepped += 1;
  }
  step(ctx, stepped);
  if (!prev || !isW(prev, "tc")) return null;
  return firstW(firstTextRun(ctx, prev), "rPr");
}

function fillTableCell(ctx: Ctx, job: Job, text: string, kind: RunKind): void {
  const { field, ref } = job;
  const paras = toParagraphs(text);
  if (ref.kind === "paragraph" && !ref.cellPath) {
    // A body paragraph: write into it when it is blank space, otherwise after it.
    fillAfterParagraph(ctx, job, text, kind);
    return;
  }
  let space: XmlElement[] = [];
  let after: XmlElement | null = null;
  let container: XmlElement | null = null;
  if (ref.kind === "cell") {
    const ps = ref.paragraphs;
    container = ref.el;
    readLines(ctx, ps, ANSWER_SPACE_PASSES);
    if (ps.every(isAnswerSpaceParagraph)) space = ps.slice();
    else {
      let lastText = -1;
      ps.forEach((p, i) => {
        if (!isAnswerSpaceParagraph(p)) lastText = i;
      });
      space = ps.slice(lastText + 1);
      after = ps[lastText] ?? null;
    }
  } else {
    readLines(ctx, [ref.el], ANSWER_SPACE_PASSES);
    if (isAnswerSpaceParagraph(ref.el)) space = [ref.el, ...followingSpace(ctx, ref.el)];
    else {
      after = ref.el;
      space = followingSpace(ctx, ref.el);
    }
  }
  const rPr = completeTypography(ctx, markRPr(ctx, space[0] ?? null) ?? labelCellRPr(ctx, ref) ?? typographyOf(ctx, firstW(firstTextRun(ctx, ref.el), "rPr")), () => [
    ...spaceRunRPrs(ctx, ref.kind === "cell" ? ref.paragraphs : [ref.el, ...space], ref.kind === "cell" ? ref.el : null),
    labelCellRunRPr(ctx, ref),
    firstW(firstTextRun(ctx, ref.el, true), "rPr"),
    markRPr(ctx, after),
  ]);
  const pPr = space.length ? null : answerPPr(ctx, after);
  const written = writeIntoSpace(ctx, field, paras, space, after, container, pPr, rPr, kind);
  if (!written) ctx.warn(`${where(field)}: the answer box could not be written.`);
  if (kind === "answer") setOutcome(trackOf(ctx, field), written ? "written" : "not_found", written ? undefined : "its answer box could not be written");
}

/**
 * Fix round 2 (B1-8): run properties of the text around a paragraph inside a table cell – the cell's label first, then
 * the other cells of its row – for the colour an uncoloured instruction paragraph does not give ("Please give clinical
 * details in this box" under JJ Physio's navy "Clinical Impression:"). Empty outside a table.
 * bh2 WA2 (R-security-3): resolved once per row (the form's own runs, the first MAX_SOURCE_CELLS cells) and once per
 * cell's own first run.
 */
function cellContextRPrs(ctx: Ctx, p: XmlElement): XmlElement[] {
  const tc = ancestorW(p, "tc");
  if (!tc) return [];
  const tr = ancestorW(tc, "tr");
  const own = cellFirstRPr(ctx, tc);
  if (!tr) return own ? [own] : [];
  let row = ctx.sources.row.get(tr);
  if (!row) {
    const cells: XmlElement[] = [];
    let stepped = 0;
    for (let n = tr.firstChild; n && cells.length < MAX_SOURCE_CELLS && stepped < MAX_SIBLINGS_SCANNED; n = n.nextSibling) {
      stepped += 1;
      if (isW(n, "tc")) cells.push(n);
    }
    step(ctx, stepped);
    row = cells;
    ctx.sources.row.set(tr, row);
  }
  return [own, ...row.filter((c) => c !== tc).map((c) => cellFirstRPr(ctx, c))].filter((r): r is XmlElement => r !== null);
}

/** The first printed run's properties in a cell, resolved once per cell. */
function cellFirstRPr(ctx: Ctx, tc: XmlElement): XmlElement | null {
  if (ctx.sources.firstRun.has(tc)) return ctx.sources.firstRun.get(tc) ?? null;
  ctx.typographyReads += 1;
  const rPr = firstW(firstTextRun(ctx, tc, true), "rPr");
  ctx.sources.firstRun.set(tc, rPr);
  return rPr;
}

function fillAfterParagraph(ctx: Ctx, job: Job, text: string, kind: RunKind): void {
  const { field, ref } = job;
  if (ref.kind === "cell") {
    fillTableCell(ctx, job, text, kind);
    return;
  }
  const p = ref.el;
  readLines(ctx, [p]);
  const space = followingSpace(ctx, p);
  // The answer space's own formatting first; otherwise only the question's font family (not its size:
  // questions are often headings or small grey instructions).
  const rPr = completeTypography(ctx, markRPr(ctx, space[0] ?? null) ?? typographyOf(ctx, firstW(firstTextRun(ctx, space[0] ?? p), "rPr"), space[0] ? undefined : ["rFonts"]), () => [
    ...spaceRunRPrs(ctx, [p, ...space], null),
    markRPr(ctx, p),
    firstW(firstTextRun(ctx, p, true), "rPr"),
    ...cellContextRPrs(ctx, p),
  ]);
  const written = writeIntoSpace(ctx, field, toParagraphs(text), space, p, null, answerPPr(ctx, p), rPr, kind);
  if (!written) ctx.warn(`${where(field)}: the answer could not be added after the question.`);
  if (kind === "answer") setOutcome(trackOf(ctx, field), written ? "written" : "not_found", written ? undefined : "the answer could not be added after its question");
}

interface Occurrence {
  p: XmlElement;
  index: number;
  length: number;
  text: string;
}

/** Maximal runs of fill characters ("____", "......", ". . . .", "……") in a text. */
const FILL_RUN_RE = /[_.…](?:[_.…]|[ \u00A0](?=[_.…]))*/g;

/** A blank made of fill characters ("____", "……"), not a printed default or a code. */
const isFillNeedle = (needle: string): boolean => /^[_.…\s\u00A0]+$/.test(needle);

/** Masks what this fill wrote, character for character, so offsets stay those of the visible text. */
const MASK = "\u0001";

/**
 * A paragraph's visible text with every answer this fill wrote masked (MASK per character): offsets are the visible
 * text's, and a search for a placeholder never lands inside an answer (an answer holding "…" never takes the next
 * question's "…"). A printed option a "delete as necessary" answer kept is the form's own text and stays readable.
 */
function maskedText(p: XmlElement): string {
  return paragraphSegments(p)
    .map((s) => (isWritten(s.run) && !isKeptPrint(s.run) ? MASK.repeat(s.text.length) : s.text))
    .join("");
}

/**
 * Occurrences of `needle` in the block's paragraphs, in order – in the form's own text, never inside an answer. For a
 * blank made of fill characters the whole blank is the occurrence, and blanks of exactly the needle's length are
 * preferred (so "____" of 16 never lands inside a longer blank of 36 left empty by an unanswered question).
 */
function occurrences(ctx: Ctx, paras: XmlElement[], needle: string): Occurrence[] {
  if (!needle) return [];
  readLines(ctx, paras, 2);
  if (!isFillNeedle(needle)) {
    const out: Occurrence[] = [];
    for (const p of paras) {
      const text = maskedText(p);
      let from = 0;
      for (let i = text.indexOf(needle, from); i >= 0; i = text.indexOf(needle, from)) {
        out.push({ p, index: i, length: needle.length, text: needle });
        from = i + needle.length;
      }
    }
    return out;
  }
  const want = needle.trim();
  const runs: (Occurrence & { exact: boolean })[] = [];
  for (const p of paras) {
    const text = maskedText(p);
    for (const m of Array.from(text.matchAll(FILL_RUN_RE))) {
      const run = m[0];
      if (!run.includes(want) && !(want.length >= run.length && want.includes(run) && run.length >= 4)) continue;
      runs.push({ p, index: m.index ?? 0, length: run.length, text: run, exact: run === want });
    }
  }
  const exact = runs.filter((r) => r.exact);
  return (exact.length > 0 ? exact : runs).map(({ exact: _exact, ...o }) => o);
}

function skipKey(ctx: Ctx, block: XmlElement, needle: string): number {
  return ctx.skipped.get(block)?.get(needle) ?? 0;
}

function addSkip(ctx: Ctx, block: XmlElement, needle: string): void {
  const m = ctx.skipped.get(block) ?? new Map<string, number>();
  m.set(needle, (m.get(needle) ?? 0) + 1);
  ctx.skipped.set(block, m);
}

function fillPlaceholder(ctx: Ctx, job: Job, text: string, kind: RunKind, skip: boolean): void {
  const { field, ref } = job;
  const t = kind === "answer" ? trackOf(ctx, field) : null;
  const anchor = field.anchor.kind === "docx" ? field.anchor : null;
  const paras = blockParagraphs(ref);
  let needle = anchor?.placeholderText ?? "";
  let occ = needle ? occurrences(ctx, paras, needle) : [];
  // 10/2026 verify: the blank was printed inside an option a "delete as necessary" answer removed (a "Max lift … kg"
  // restriction deleted, its "…" answered): the answer belongs to the deleted option, so it is not printed anywhere else.
  if (occ.length === 0 && paras.some((p) => ctx.deletedParas.has(p))) {
    if (!skip) ctx.warn(`${where(field)}: “${needle}” was deleted with the printed option it belongs to, so this answer is not printed.`);
    if (t) {
      setOutcome(t, "removed");
      t.noteOnly = true;
      t.notes.push(`deleted with the printed option it belongs to (${anchor?.placeholderText ?? ""}), so this answer is not printed`);
    }
    return;
  }
  if (occ.length === 0) {
    // The exact text is not there: fall back to the block's detected blanks.
    readLines(ctx, paras, 2);
    const detected = paras.flatMap((p) => findPlaceholders(maskedText(p)).map((m) => ({ p, ...m })));
    if (detected.length > 0) {
      if (!skip) ctx.warn(`${where(field)}: the placeholder “${needle || "(none given)"}” was not found exactly; the first blank in that place was used.`);
      t?.notes.push("its printed placeholder was not found exactly, so the first blank in that place was used");
      needle = "\u0000detected";
      occ = detected.map((d) => ({ p: d.p, index: d.index, length: d.text.length, text: d.text }));
    } else {
      if (skip) return;
      // Its blank was taken by another answer mapped to the same placeholder in that place: two answers, one place.
      const taker = ctx.claims.get(`${elementId(ctx, ref.el)}|ph|${anchor?.placeholderText ?? ""}`);
      if (t && taker && taker !== t) {
        const problem = (f: FormField) => `it is mapped to the same place on the form as ${f.id} (“${f.label}”), so one answer would cover the other`;
        setOutcome(t, "collision", problem(taker.field));
        setOutcome(taker, "collision", problem(field));
      }
      ctx.warn(`${where(field)}: no placeholder was found; the answer was added after the question instead.`);
      // A guess at the place: shown on a draft, never issued (not found is fatal on a FINAL copy).
      fillAfterParagraph(ctx, { ...job, ref: { kind: "paragraph", id: ref.id, el: paras[paras.length - 1], inSdt: false } }, text, kind);
      setOutcome(t, "not_found", `its printed placeholder (${anchor?.placeholderText || "none given"}) is not in that place on the form`);
      return;
    }
  }
  const k = skipKey(ctx, ref.el, needle);
  if (skip) {
    addSkip(ctx, ref.el, needle);
    return;
  }
  const target = occ[Math.min(k, occ.length - 1)];
  if (k >= occ.length) {
    ctx.warn(`${where(field)}: more answers than blanks of “${anchor?.placeholderText ?? ""}” in that place; the last blank was used.`);
    setOutcome(t, "collision", `more answers are mapped to “${anchor?.placeholderText ?? ""}” in that place than it prints`);
  }
  const p = target.p;
  readLines(ctx, [p], 2);
  const fullText = maskedText(p);
  const paraList = toParagraphs(text);
  // A bare "Answer:" label, or (10/2026) a printed label the map says to write after: the answer goes after it.
  const label = isBareLabel(target.text) || Boolean(anchor?.writeAfter);
  const before = fullText[target.index - 1] ?? "";
  const afterText = fullText.slice(target.index + target.length);
  const atLineEnd = afterText.trim() === "";
  const inline = atLineEnd ? paraList[0] : [paraList.map((l) => l.join(" ")).join(" ")];
  const rest = atLineEnd ? paraList.slice(1) : [];
  let written: XmlElement[] = [];

  const ok = replaceRange(
    ctx,
    p,
    label ? target.index + target.length : target.index,
    label ? target.index + target.length : target.index + target.length,
    (styleRPr) => {
      // Written after a printed label (writeAfter, or a bare "Answer:" on a converted RTF form): not in the label's bold.
      const afterLabel = Boolean(anchor?.writeAfter) || (label && ctx.rtf);
      const plain = withoutPlaceholderStyle(ctx, styleRPr);
      const rPr = afterLabel ? completeTypography(ctx, withoutEmphasis(ctx, plain), () => [plain]) : plain;
      const lines = inline.slice();
      const needsSpace = label || (before !== "" && !/[\s(]/.test(before));
      if (needsSpace) lines[0] = ` ${lines[0]}`;
      if (!atLineEnd && /^[A-Za-z0-9]/.test(afterText)) lines[lines.length - 1] = `${lines[lines.length - 1]} `;
      written = answerRuns(ctx, field, lines, rPr, kind, rest.length === 0);
      return written;
    },
  );
  if (!ok) {
    ctx.warn(`${where(field)}: the placeholder could not be replaced; the answer was added after it.`);
    fillAfterParagraph(ctx, { ...job, ref: { kind: "paragraph", id: ref.id, el: p, inSdt: false } }, text, kind);
    setOutcome(t, "not_found", "its printed placeholder could not be replaced");
    return;
  }
  // Plan WA2 design 5 (B3-20): the line written in place is normalised like every other answer paragraph.
  normaliseAnswerParagraph(ctx, p, kind === "answer" ? written : []);
  if (t) {
    setOutcome(t, "written");
    // The placeholder this answer took (the last taker is the one a later answer would collide with); after a label,
    // the label itself is the place.
    if (label) claim(ctx, field, p, `label|${target.index}`);
    else ctx.claims.set(`${elementId(ctx, ref.el)}|ph|${anchor?.placeholderText ?? ""}`, t);
    // A printed sentence the answer completes ("To return to …"): the answer must not repeat its printed words.
    if (!label) {
      const head = fullText.slice(0, target.index).replace(/[\s\u00A0]+$/, "").toLowerCase();
      const known = ctx.form.analysis?.printedLeads?.[field.id]?.trim();
      const lead = known && head.endsWith(known.toLowerCase()) ? known : openerLead(leadBefore(fullText, target.index));
      const repeated = repeatedLead(lead, inline[0] ?? "");
      if (repeated) t.residue.push(`the printed words “${repeated}” are repeated by the answer`);
    }
  }
  // An "Answer: ____" line: dotted continuation lines below are answer space for the rest of the answer.
  if (atLineEnd) {
    const space = followingSpace(ctx, p).filter((x, i, all) => all.slice(0, i + 1).every(isFillLine));
    const rPr = withoutPlaceholderStyle(ctx, firstW(firstTextRun(ctx, p), "rPr"));
    // Every paragraph of a long answer in the same typography as its first (fix round 1, B0-13: its colour too).
    if (rest.length > 0 || space.length > 0) writeIntoSpace(ctx, field, rest, space, p, null, answerPPr(ctx, p), completeTypography(ctx, typographyOf(ctx, rPr), () => [rPr]), kind);
  }
}

/**
 * The printed words of a line just before a blank at `index` – the sentence opener the answer completes ("To return
 * to" in "Expected outcome – To return to …") – or "" when the blank follows a label (":"), a number, the start of the
 * line or another answer. At most 60 characters; it starts after the line's start, a tab, a sentence's end, a dash
 * between words, another blank or an answer.
 */
export function leadBefore(text: string, index: number): string {
  const head = text.slice(0, index);
  let start = 0;
  const boundaries = [/\n/g, /[.!?;:](?=[\s\u00A0])/g, /[\s\u00A0][–—-][\s\u00A0]/g, /[_.…]{2,}/g, new RegExp(`${MASK}+`, "g")];
  for (const re of boundaries) for (const m of Array.from(head.matchAll(re))) start = Math.max(start, (m.index ?? 0) + m[0].length);
  const lead = head.slice(start).replace(/^[\s\u00A0]+/, "").replace(/[\s\u00A0]+$/, "");
  if (!lead || lead.length > 60 || !/[A-Za-z\u00C0-\u024F]$/.test(lead)) return "";
  return lead;
}

/**
 * Words that leave a printed sentence open – the answer must complete it: prepositions, verbs that take a complement,
 * determiners and conjunctions. A closed class of English grammar words, not a list of form phrases.
 */
const OPEN_ENDINGS = new Set(
  (
    "to in at on by for of from with within without since until till after before about into onto over under than as " +
    "is are was were be been being has have had will would can could should shall may might must do does did " +
    "a an the his her their its our your my this that these those and or but"
  ).split(" "),
);

/** Auxiliary and linking verbs (a closed class): a lead holding one is a clause, not a label. */
const AUXILIARIES = new Set("is are was were be been being has have had will would can could should shall may might must do does did".split(" "));

/**
 * The lead when it opens a sentence the answer completes, else "" – a label, which a blank box leaves as printed. A
 * sentence opener ends in a word that leaves it open (OPEN_ENDINGS) and reads as a clause: it holds an auxiliary verb
 * ("He has been off work since …", "Pain is …") or an infinitive – "to" before a verb ("To return to …", "Expected to
 * be fit in …"). Labels end in a noun ("Name of physiotherapist ……", "Date ……") or a preposition after a participle or
 * noun ("Assessed by ……", "Referred to ……", "Signed on behalf of ……", "Copy to …", "Date of …") – review 26/10: those
 * stay. A verb-ending opener ("He reported …") is not recognised either: it stays as printed, as before B3-19.
 */
export function openerLead(lead: string): string {
  const words = lead.toLowerCase().match(/[a-z\u00C0-\u024F']+/g) ?? [];
  const last = words[words.length - 1] ?? "";
  if (!last || !OPEN_ENDINGS.has(last)) return "";
  const clause = words.some((w) => AUXILIARIES.has(w)) || words.some((w, i) => w === "to" && i + 1 < words.length - 1);
  return clause ? lead : "";
}

/**
 * The answer's first words that repeat the end of the printed lead, or "": "To return to" + "return to work" → "return
 * to"; review 26/10 – one word too ("To return to" + "to work" → "to"; "Expected to be fit in" + "in 6 weeks" → "in"):
 * a word printed twice across the blank is never right.
 */
export function repeatedLead(lead: string, answer: string): string {
  const words = (s: string) => s.toLowerCase().split(/[^A-Za-z0-9\u00C0-\u024F']+/).filter(Boolean);
  const l = words(lead);
  const a = words(answer);
  if (l.length === 0 || a.length === 0) return "";
  for (let n = Math.min(l.length, a.length); n >= 1; n--) {
    if (l.slice(l.length - n).every((w, i) => w === a[i])) return l.slice(l.length - n).join(" ");
  }
  return "";
}

/**
 * Removes the field's exact placeholder from its block (the occurrence a filled answer would have taken), for an
 * answer the record leaves empty on purpose, a box left blank that prints a default, or one that does not apply.
 * Nothing happens when the exact text is not there. True when it was removed.
 */
function clearPlaceholder(ctx: Ctx, job: Job): boolean {
  const { field, ref } = job;
  const needle = field.anchor.kind === "docx" ? (field.anchor.placeholderText ?? "") : "";
  if (!needle) return false;
  const occ = occurrences(ctx, blockParagraphs(ref), needle);
  if (occ.length === 0) {
    ctx.warn(`${where(field)}: the placeholder “${needle}” was not found, so nothing was removed.`);
    return false;
  }
  const k = skipKey(ctx, ref.el, needle);
  const target = occ[Math.min(k, occ.length - 1)];
  if (!replaceRange(ctx, target.p, target.index, target.index + target.length, () => [])) {
    ctx.warn(`${where(field)}: the placeholder “${needle}” could not be removed.`);
    return false;
  }
  // Fix round 1 (B0-32): a line left empty (an address line the record does not have) goes too – a cell keeps its last
  // line, and a line that keeps two tables apart stays (removeIfBlank).
  removeIfBlank(ctx, target.p);
  return true;
}

/**
 * Khuram, 26/10 (B3-19, plan WA2 design 6): a sentence opener left blank – a blank at the end of a printed sentence the
 * answer would complete ("To return to …") – loses its printed lead words and its dots, so the issued form never prints
 * a sentence with nothing in it. The lead is the map's printedLeads entry when the line ends with it, else leadBefore().
 * Only a blank with nothing but punctuation after it on its line: a frame with printed words after the blank ("…/10
 * at rest") stays as printed. True when the opener was removed.
 */
function dropBlankOpener(ctx: Ctx, job: Job, drop = true): boolean {
  const { field, ref } = job;
  const anchor = field.anchor.kind === "docx" ? field.anchor : null;
  const needle = anchor?.placeholderText ?? "";
  if (!anchor || anchor.writeAfter || !needle || !isFillNeedle(needle)) return false;
  const occ = occurrences(ctx, blockParagraphs(ref), needle);
  if (occ.length === 0) return false;
  const target = occ[Math.min(skipKey(ctx, ref.el, needle), occ.length - 1)];
  readLines(ctx, [target.p]);
  const text = maskedText(target.p);
  const end = target.index + target.length;
  const lineAfter = text.slice(end).split("\n")[0];
  // Printed words after the blank (a frame, "…/10 at rest"), or a printed question ("… returned to …?"): as printed.
  if (!/^[\s\u00A0.,;:!]*$/.test(lineAfter)) return false;
  const head = text.slice(0, target.index).replace(/[\s\u00A0]+$/, "");
  const known = ctx.form.analysis?.printedLeads?.[field.id]?.trim();
  const lead = known && head.toLowerCase().endsWith(known.toLowerCase()) ? known : openerLead(leadBefore(text, target.index));
  if (!lead) return false;
  const p = target.p;
  // Checked once the whole form is filled, whether or not it was dropped (the leave-blank hook): no opener left.
  trackOf(ctx, field)?.checks.push(() => {
    if (!isAttached(ctx, p)) return [];
    readLines(ctx, [p]);
    const now = maskedText(p);
    const at = now.toLowerCase().indexOf(lead.toLowerCase());
    return at >= 0 && /^[\s\u00A0]*[_.…]/.test(now.slice(at + lead.length)) ? [`the printed words “${lead} …” are still on the form`] : [];
  });
  if (!drop) return false;
  let from = head.length - lead.length;
  // The separator before it goes too ("Expected outcome – To return to …" → "Expected outcome").
  const sep = /[\s\u00A0]*(?:[–—-][\s\u00A0]*)?$/.exec(text.slice(0, from));
  if (sep && sep.index > 0 && /[–—-]/.test(sep[0])) from = sep.index;
  else while (from > 0 && /[\s\u00A0]/.test(text[from - 1])) from -= 1;
  const tail = /^[ \t\u00A0.,;:!]*/.exec(lineAfter)?.[0].length ?? 0;
  if (!replaceRange(ctx, p, from, end + tail, () => [])) return false;
  removeIfBlank(ctx, p);
  return true;
}

/** Content controls of a block: inside its paragraphs/cell, or the block-level control around it (counted). */
function controlsOf(ctx: Ctx, ref: BlockRef): XmlElement[] {
  readPart(ctx, ref.el);
  const inside = descendantsW(ref.el, "sdt");
  const around = ancestorW(ref.el, "sdt");
  return around && !inside.includes(around) ? [around, ...inside] : inside;
}

function isCheckboxControl(sdt: XmlElement): boolean {
  const pr = firstW(sdt, "sdtPr");
  return !!pr && childElements(pr).some((c) => c.localName === "checkbox" && c.namespaceURI === W14_NS);
}

/** The content control a field writes into: the one whose tag or alias is its placeholder, else the first free one. */
function pickControl(ctx: Ctx, field: FormField, ref: BlockRef): XmlElement | undefined {
  const anchor = field.anchor.kind === "docx" ? field.anchor : null;
  const candidates = controlsOf(ctx, ref).filter((s) => !isCheckboxControl(s));
  const want = anchor?.placeholderText?.trim().toLowerCase();
  let sdt: XmlElement | undefined;
  if (want) {
    sdt = candidates.find((s) => {
      const pr = firstW(s, "sdtPr");
      const tag = (wAttr(firstW(pr, "tag"), "val") ?? "").toLowerCase();
      const alias = (wAttr(firstW(pr, "alias"), "val") ?? "").toLowerCase();
      return !ctx.usedControls.has(s) && (tag === want || alias === want);
    });
  }
  return sdt ?? candidates.find((s) => !ctx.usedControls.has(s));
}

function fillContentControl(ctx: Ctx, job: Job, text: string, kind: RunKind, skip: boolean, isoDate: string | null): void {
  const { field, ref } = job;
  const t = kind === "answer" ? trackOf(ctx, field) : null;
  const sdt = pickControl(ctx, field, ref);
  if (!sdt) {
    if (skip) return;
    ctx.warn(`${where(field)}: no free content control was found there; the answer was written into the box instead.`);
    fillTableCell(ctx, job, text, kind);
    setOutcome(t, "not_found", "no free content control is in that place on the form");
    return;
  }
  ctx.usedControls.add(sdt);
  if (skip) return;
  const pr = firstW(sdt, "sdtPr");
  const content = firstW(sdt, "sdtContent");
  if (content) readPart(ctx, content);
  if (!content) {
    ctx.warn(`${where(field)}: the content control is empty and could not be filled.`);
    setOutcome(t, "not_found", "its content control has no content to fill");
    return;
  }
  const plc = firstW(pr, "showingPlcHdr");
  if (plc && pr) pr.removeChild(plc);
  const date = firstW(pr, "date");
  if (date && isoDate) setWAttr(ctx.dom, date, "fullDate", `${isoDate}T00:00:00Z`);
  const firstRun = descendantsW(content, "r")[0] ?? null;
  const rPr = withoutPlaceholderStyle(ctx, firstW(pr, "rPr")) ?? withoutPlaceholderStyle(ctx, firstW(firstRun, "rPr"));
  const paras = toParagraphs(text);
  const blockParas = wChildren(content, "p");
  if (blockParas.length > 0) {
    if (writeIntoSpace(ctx, field, paras, [blockParas[0]], null, content, null, rPr, kind)) setOutcome(t, "written");
    else setOutcome(t, "not_found", "its content control could not be written");
    return;
  }
  for (const child of childElements(content)) remove(ctx, child);
  const lines: string[] = [];
  paras.forEach((p, i) => {
    if (i > 0) lines.push("");
    lines.push(...p);
  });
  const runs = answerRuns(ctx, field, lines, rPr, kind, true);
  for (const run of runs) content.appendChild(run);
  normaliseAnswerParagraph(ctx, ancestorW(content, "p"), kind === "answer" ? runs : []);
  setOutcome(t, "written");
}

/**
 * A box left blank on a content control (plan WA2 design 2): whatever it shows – the "Click or tap here to enter text."
 * prompt or a value the template already holds – is emptied, and it no longer shows its prompt. Returns what happened.
 */
function clearContentControl(ctx: Ctx, job: Job, clear: boolean): FillOutcomeKind {
  const { field, ref } = job;
  const sdt = pickControl(ctx, field, ref);
  if (!sdt) return "not_found";
  ctx.usedControls.add(sdt);
  const content = firstW(sdt, "sdtContent");
  if (!content) return "as_printed";
  readPart(ctx, content);
  trackOf(ctx, field)?.checks.push(() => {
    if (!isAttached(ctx, content)) return [];
    readPart(ctx, content);
    return (content.textContent ?? "").trim() ? ["the content control still shows printed text"] : [];
  });
  if (!clear) return "as_printed";
  const pr = firstW(sdt, "sdtPr");
  const showing = firstW(pr, "showingPlcHdr");
  const had = (content.textContent ?? "").trim() !== "" || Boolean(showing);
  if (showing && pr) pr.removeChild(showing);
  const paras = wChildren(content, "p");
  if (paras.length > 0) {
    // A block control keeps its first line, empty (a cell or the body never loses its paragraph).
    clearParagraph(ctx, paras[0]);
    for (const extra of paras.slice(1)) remove(ctx, extra);
  } else for (const child of childElements(content)) if (!isW(child, "rPr")) remove(ctx, child);
  return had ? "cleared" : "as_printed";
}

function legacyFields(ctx: Ctx, ref: BlockRef, type: "textInput" | "checkBox"): XmlElement[] {
  readPart(ctx, ref.el);
  return descendantsW(ref.el, "fldChar").filter((f) => wAttr(f, "fldCharType") === "begin" && !!firstW(firstW(f, "ffData"), type));
}

/** The Word form field (FORMTEXT) a field writes into, its result runs and its end. */
function legacyPlace(ctx: Ctx, field: FormField, ref: BlockRef): { begin: XmlElement; beginRun: XmlElement; sepRun: XmlElement | null; endRun: XmlElement | null; result: XmlElement[] } | null {
  const anchor = field.anchor.kind === "docx" ? field.anchor : null;
  const begins = legacyFields(ctx, ref, "textInput");
  const want = anchor?.placeholderText?.trim();
  let begin = want ? begins.find((b) => !ctx.usedLegacy.has(b) && wAttr(firstW(firstW(b, "ffData"), "name"), "val") === want) : undefined;
  begin ??= begins.find((b) => !ctx.usedLegacy.has(b));
  if (!begin) return null;
  ctx.usedLegacy.add(begin);
  const beginRun = ancestorW(begin, "r");
  const p = ancestorW(begin, "p");
  if (!beginRun || !p) return { begin, beginRun: beginRun ?? begin, sepRun: null, endRun: null, result: [] };
  readLines(ctx, [p]);
  const runs = descendantsW(p, "r");
  let depth = 0;
  let sepRun: XmlElement | null = null;
  let endRun: XmlElement | null = null;
  const result: XmlElement[] = [];
  let started = false;
  for (const run of runs) {
    if (run === beginRun) {
      started = true;
      depth = 1;
      continue;
    }
    if (!started) continue;
    const fc = firstW(run, "fldChar");
    const type = wAttr(fc, "fldCharType");
    if (type === "begin") depth++;
    else if (type === "end") {
      depth--;
      if (depth === 0) {
        endRun = run;
        break;
      }
    } else if (type === "separate" && depth === 1) {
      sepRun = run;
      continue;
    }
    if (sepRun && depth === 1 && !fc) result.push(run);
  }
  return { begin, beginRun, sepRun, endRun, result };
}

function fillLegacyField(ctx: Ctx, job: Job, text: string, kind: RunKind, skip: boolean): void {
  const { field } = job;
  const t = kind === "answer" ? trackOf(ctx, field) : null;
  const place = legacyPlace(ctx, field, job.ref);
  if (!place) {
    if (skip) return;
    ctx.warn(`${where(field)}: no free Word form field was found there; the answer was written into the box instead.`);
    fillTableCell(ctx, job, text, kind);
    setOutcome(t, "not_found", "no free Word form field is in that place on the form");
    return;
  }
  if (skip) return;
  const { beginRun, result, endRun } = place;
  let sepRun = place.sepRun;
  if (!endRun) {
    ctx.warn(`${where(field)}: the Word form field is incomplete and could not be filled.`);
    setOutcome(t, "not_found", "its Word form field is incomplete");
    return;
  }
  const rPr = firstW(result[0] ?? sepRun ?? beginRun, "rPr");
  const lines = toParagraphs(text).flatMap((l, i) => (i > 0 ? ["", ...l] : l));
  const newRuns = answerRuns(ctx, field, lines, rPr ? cloneCounted(ctx, rPr) : null, kind, true);
  if (!sepRun) {
    sepRun = wEl(ctx.dom, "r");
    sepRun.appendChild(wEl(ctx.dom, "fldChar", { fldCharType: "separate" }));
    if (endRun.parentNode) insertBefore(ctx, endRun.parentNode, sepRun, endRun);
  }
  for (const run of result) remove(ctx, run);
  let at = sepRun;
  for (const run of newRuns) {
    insertAfter(ctx, run, at);
    at = run;
  }
  normaliseAnswerParagraph(ctx, ancestorW(endRun, "p"), kind === "answer" ? newRuns : []);
  setOutcome(t, "written");
}

/** A box left blank on a Word form field (FORMTEXT): its printed result (a default value, the blank spaces) is emptied. */
function clearLegacyField(ctx: Ctx, job: Job, clear: boolean): FillOutcomeKind {
  const place = legacyPlace(ctx, job.field, job.ref);
  if (!place) return "not_found";
  if (!place.endRun) return "as_printed";
  const endRun = place.endRun;
  const sepRun = place.sepRun;
  const blankText = (t: string) => t.replace(/[\s\u2002\u00A0]/g, "") === "";
  trackOf(ctx, job.field)?.checks.push(() => {
    if (!isAttached(ctx, endRun) || !sepRun) return [];
    const line = ancestorW(endRun, "p");
    if (line) readLines(ctx, [line]);
    let text = "";
    for (let n = sepRun.nextSibling; n && n !== endRun; n = n.nextSibling) text += n.textContent ?? "";
    return blankText(text) ? [] : ["the Word form field still prints a value"];
  });
  if (!clear) return "as_printed";
  const had = place.result.some((r) => !blankText(r.textContent ?? ""));
  for (const run of place.result) remove(ctx, run);
  return had ? "cleared" : "as_printed";
}

/* ------------------------------------------------------------------------------------------------
 * Tick boxes
 * ----------------------------------------------------------------------------------------------*/

interface GlyphTarget {
  option: string;
  slot: GlyphSlot | null;
  /** The paragraphs of the option's block, and the box's index there (to re-read it once everything is written). */
  paras: XmlElement[];
  glyphIndex: number;
}

function resolveGlyphs(ctx: Ctx, field: FormField): GlyphTarget[] {
  const anchor = field.anchor.kind === "docx" ? field.anchor : null;
  return (anchor?.optionGlyphs ?? []).map((g) => {
    const ref = ctx.index.byId.get(g.blockId);
    if (!ref) return { option: g.option, slot: null, paras: [], glyphIndex: g.glyphIndex };
    const paras = blockParagraphs(ref);
    if (paras.length > MAX_BLOCK_PARAGRAPHS) throw tooComplex(`A table cell of this Word file holds ${paras.length.toLocaleString("en-GB")} lines; a cell that is filled here holds at most ${MAX_BLOCK_PARAGRAPHS.toLocaleString("en-GB")}.`);
    readLines(ctx, paras, 2);
    const slots = paras.flatMap((p) => glyphSlots(paragraphSegments(p)));
    return { option: g.option, slot: slots[g.glyphIndex] ?? null, paras, glyphIndex: g.glyphIndex };
  });
}

/** A tick box's state now (re-read in its own paragraphs; null when it is no longer there). */
function glyphCheckedNow(ctx: Ctx, target: GlyphTarget): boolean | null {
  readLines(ctx, target.paras, 2);
  // The form's own boxes only: an answer written into the same line is never read as one.
  const slots = target.paras.flatMap((p) => glyphSlots(paragraphSegments(p).filter((seg) => !isWritten(seg.run) || isKeptPrint(seg.run))));
  const slot = slots[target.glyphIndex];
  return slot ? slot.checked : null;
}

/**
 * What an answer chooses among a choice field's printed options (forms/choice-marks.ts resolveChoice – the same reading
 * the validators check approval with), recorded on the field's outcome when it chooses nothing it can mark: an answer
 * that says it is not known, or names no printed option, is fatal on a decided box and leaves the options as printed.
 */
function choiceFor(ctx: Ctx, field: FormField, answer: FormFillAnswer, options: string[]): ChoiceResolution {
  const r = resolveChoice(field, answer, options);
  if (r.kind === "unknown" || r.kind === "unmatched") {
    const t = trackOf(ctx, field);
    if (t && t.intended === "answer") setOutcome(t, "as_printed", r.kind === "unknown" ? `the answer “${r.text}” says it is not known, so no printed option can be marked` : `the answer “${r.text}” is none of the printed options`);
  }
  return r;
}

function setGlyph(ctx: Ctx, slot: GlyphSlot, checked: boolean): void {
  const seg = slot.segment;
  const sdt = seg.run ? ancestorW(seg.run, "sdt") : null;
  const box = sdt ? childElements(firstW(sdt, "sdtPr") ?? sdt).find((c) => c.localName === "checkbox" && c.namespaceURI === W14_NS) : undefined;
  let glyph = checked ? CHECKED_GLYPH : UNCHECKED_GLYPH;
  if (box) {
    const state = childElements(box).find((c) => c.localName === (checked ? "checkedState" : "uncheckedState"));
    const val = state?.getAttributeNS(W14_NS, "val");
    if (val && /^[0-9a-f]{4,5}$/i.test(val)) glyph = String.fromCodePoint(parseInt(val, 16));
    const checkedEl = childElements(box).find((c) => c.localName === "checked");
    if (checkedEl) checkedEl.setAttributeNS(W14_NS, `${checkedEl.prefix ?? "w14"}:val`, checked ? "1" : "0");
  }
  if (slot.bracket) {
    // A typed tick box ("[ ]" → "[x]", "[x]" → "[ ]"), possibly split over runs: the new box in its first part.
    slot.bracket.parts.forEach((part, i) => {
      if (part.segment.kind !== "text") return;
      addGlyphEdit(ctx, part.segment.el, { offset: part.offset, length: part.length, text: i === 0 ? bracketBoxText(slot.bracket!.text, checked) : "" });
    });
  } else if (seg.kind === "text") {
    addGlyphEdit(ctx, seg.el, { offset: slot.offset, length: 1, text: glyph });
  } else if (seg.kind === "sym") {
    if (box) setWAttr(ctx.dom, seg.el, "char", glyph.codePointAt(0)!.toString(16).toUpperCase());
    else setWAttr(ctx.dom, seg.el, "char", symCharFor(seg.el, checked));
  } else if (seg.kind === "legacyCheck" && seg.fieldBegin) {
    const cb = firstW(firstW(seg.fieldBegin, "ffData"), "checkBox");
    if (!cb) return;
    const existing = firstW(cb, "checked");
    if (existing) cb.removeChild(existing);
    cb.appendChild(wEl(ctx.dom, "checked", { val: checked ? "1" : "0" }));
  }
}

function addGlyphEdit(ctx: Ctx, t: XmlElement, edit: { offset: number; length: number; text: string }): void {
  const list = ctx.glyphEdits.get(t) ?? [];
  list.push(edit);
  ctx.glyphEdits.set(t, list);
}

/**
 * Apply the tick-box changes inside text, per text element from its end backwards – a typed box can change length
 * ("[]" → "[x]"), so every change uses the offsets read on the untouched document. A ☐ → ☒ change alone gives exactly
 * the text it always gave.
 */
function flushGlyphEdits(ctx: Ctx): void {
  ctx.glyphEdits.forEach((edits, t) => {
    let text = t.textContent ?? "";
    for (const e of edits.slice().sort((a, b) => b.offset - a.offset)) text = text.slice(0, e.offset) + e.text + text.slice(e.offset + e.length);
    setText(t, text);
  });
  ctx.glyphEdits.clear();
}

function fillCheckboxes(ctx: Ctx, field: FormField, answer: FormFillAnswer, targets: GlyphTarget[]): void {
  const t = trackOf(ctx, field);
  if (targets.length === 0) {
    ctx.warn(`${where(field)}: no tick boxes are linked to this question.`);
    setOutcome(t, "not_found", "no tick boxes are linked to it on the form");
    return;
  }
  for (const target of targets) if (!target.slot) setOutcome(t, "not_found", `the tick box for “${target.option}” is not on the form`);
  // Review 26/10: a box the record leaves empty (record_empty) is a blank box too – a pre-printed tick never issues; a
  // FINAL box nobody decided is checked the same way, nothing cleared (Track.checkOnly).
  if (answer.leftBlank || answer.blank || t?.checkOnly) {
    // Fix round 1 (B0-2): left blank – a box printed ticked is cleared; unticked boxes stay exactly as printed.
    if (clearsBlank(t)) {
      for (const target of targets) {
        if (target.slot?.checked) {
          setGlyph(ctx, target.slot, false);
          setOutcome(t, "cleared");
        }
      }
    }
    t?.checks.push(() => targets.filter((g) => glyphCheckedNow(ctx, g) === true).map((g) => `“${g.option}” is ticked on the form`));
    return;
  }
  const choice = choiceFor(ctx, field, answer, targets.map((g) => g.option));
  if (choice.kind !== "chosen") {
    if (choice.kind === "unmatched") ctx.warn(`${where(field)}: the answer “${answer.text ?? String(answer.value)}” does not match any tick box, so none was ticked.`);
    // Unanswered, unknown or unmatched: every box stays as printed – never a guess (fatal on a decided box, above).
    return;
  }
  const chosen = new Set(choice.options);
  for (const target of targets) {
    if (!target.slot) {
      ctx.warn(`${where(field)}: the tick box for “${target.option}” was not found.`);
      continue;
    }
    if (chosen.has(target.option)) claim(ctx, field, target.slot.segment.el, `glyph@${target.slot.offset}`);
    setGlyph(ctx, target.slot, chosen.has(target.option));
  }
  setOutcome(t, "written");
  // Explicit on the issued form: the chosen boxes ticked, every other one clear.
  t?.checks.push(() =>
    targets.flatMap((g) => {
      const now = glyphCheckedNow(ctx, g);
      if (now === null) return [];
      if (now && !chosen.has(g.option)) return [`“${g.option}” is ticked on the form`];
      if (!now && chosen.has(g.option)) return [`the chosen “${g.option}” is not ticked`];
      return [];
    }),
  );
}

/* ------------------------------------------------------------------------------------------------
 * "Mark the column" tables (mark_cell, 10/2026)
 * ----------------------------------------------------------------------------------------------*/

interface MarkTarget {
  option: string;
  ref: BlockRef | null;
}

/**
 * A cell that holds only a mark ("x", "X", "✓"…) – a mark printed as a default, or one written before. Also the other
 * marks forms print for "this one" (10/2026 verify): ☑, the multiplication sign ×, ✕ and ✖.
 */
const MARK_ONLY_RE = /^[\s\u00A0]*[xX\u2713\u2714\u2717\u2718\u221A\u2612\u2611\u00D7\u2715\u2716][\s\u00A0]*$/;

function resolveMarkCells(ctx: Ctx, field: FormField): MarkTarget[] {
  const anchor = field.anchor.kind === "docx" ? field.anchor : null;
  return (anchor?.optionCells ?? []).map((c) => ({ option: c.option, ref: ctx.index.byId.get(c.blockId) ?? null }));
}

function markParagraphs(ref: BlockRef): XmlElement[] {
  return ref.kind === "cell" ? ref.paragraphs : [ref.el];
}

/** The mark in its own run: the cell's typography, bold, highlighted on a review copy. */
function markRun(ctx: Ctx, mark: string, rPr: XmlElement | null): XmlElement {
  const run = makeRun(ctx, [mark], rPr, "answer");
  let props = firstW(run, "rPr");
  if (!props) {
    props = wEl(ctx.dom, "rPr");
    run.insertBefore(props, run.firstChild);
  }
  setProp(props, wEl(ctx.dom, "b"), RPR_ORDER);
  return run;
}

/** Writes the mark in a chosen cell; the mark's run, or null when it could not be written. */
function writeMark(ctx: Ctx, ref: BlockRef, mark: string, field: FormField): XmlElement | null {
  const paras = markParagraphs(ref);
  if (paras.length === 0) {
    ctx.warn(`${where(field)}: the cell to mark has no line to write in.`);
    return null;
  }
  readLines(ctx, paras, ANSWER_SPACE_PASSES);
  const texts = paras.map((p) => segmentsText(paragraphSegments(p)));
  const markOnly = texts.findIndex((t) => MARK_ONLY_RE.test(t));
  const rPr = markRPr(ctx, paras[0]) ?? labelCellRPr(ctx, ref) ?? typographyOf(ctx, firstW(firstTextRun(ctx, ref.el), "rPr"));
  let written: XmlElement | null = null;
  const mk = (styleRPr: XmlElement | null) => (written = markRun(ctx, mark, styleRPr));
  if (markOnly >= 0 && texts.every((t, i) => i === markOnly || t.trim() === "")) {
    // A mark is printed there already (a default): written again in the form's own place.
    const p = paras[markOnly];
    const at = texts[markOnly].search(/\S/);
    const ok = replaceRange(ctx, p, at, at + 1, (styleRPr) => [mk(styleRPr ?? rPr)]);
    clampRightIndentInCell(ctx, firstW(p, "pPr"), p);
    return ok ? written : null;
  }
  if (paras.every(isAnswerSpaceParagraph)) {
    const p = paras[0];
    clearParagraph(ctx, p);
    p.appendChild(mk(rPr));
    clampRightIndentInCell(ctx, firstW(p, "pPr"), p);
    return written;
  }
  // The cell prints the option itself ("70%", "Yes"): the mark goes after it.
  let last = paras.length - 1;
  while (last > 0 && texts[last].trim() === "") last -= 1;
  const p = paras[last];
  const end = texts[last].replace(/[\s\u00A0]+$/, "").length;
  const ok = replaceRange(ctx, p, end, end, (styleRPr) => [makeRun(ctx, [" "], styleRPr ?? rPr, "answer"), mk(styleRPr ?? rPr)]);
  clampRightIndentInCell(ctx, firstW(p, "pPr"), p);
  return ok ? written : null;
}

/** A cell that holds only a mark ("x", "✓", "☒"…), as printed now. */
function holdsOnlyMark(ctx: Ctx, ref: BlockRef): boolean {
  const paras = markParagraphs(ref);
  readLines(ctx, paras);
  const texts = paras.map((p) => segmentsText(paragraphSegments(p)));
  const markOnly = texts.findIndex((t) => MARK_ONLY_RE.test(t));
  return markOnly >= 0 && texts.every((t, i) => i === markOnly || t.trim() === "");
}

/** A cell that holds only a mark is cleared (never a mark left in the wrong column). True when one was cleared. */
function clearMark(ctx: Ctx, ref: BlockRef): boolean {
  const paras = markParagraphs(ref);
  readLines(ctx, paras);
  const texts = paras.map((p) => segmentsText(paragraphSegments(p)));
  const markOnly = texts.findIndex((t) => MARK_ONLY_RE.test(t));
  if (markOnly < 0 || !texts.every((t, i) => i === markOnly || t.trim() === "")) return false;
  const at = texts[markOnly].search(/\S/);
  return replaceRange(ctx, paras[markOnly], at, at + 1, () => []);
}

function fillMarkCells(ctx: Ctx, field: FormField, answer: FormFillAnswer, targets: MarkTarget[]): void {
  const t = trackOf(ctx, field);
  if (targets.length === 0) {
    ctx.warn(`${where(field)}: no cells to mark are linked to this question.`);
    setOutcome(t, "not_found", "no cells to mark are linked to it on the form");
    return;
  }
  for (const target of targets) if (!target.ref) setOutcome(t, "not_found", `the cell for “${target.option}” is not on the form`);
  const options = targets.map((g) => g.option);
  // Explicit on the issued form (re-read once everything is written): a mark only in the chosen columns – and (review
  // 26/10) each chosen column still holds the mark this fill wrote there (a later answer mapped onto the same cell can
  // clear it).
  const marks = new Map<string, XmlElement>();
  const markedWrongly = (chosen: ReadonlySet<string>) => () =>
    targets.flatMap((g) => {
      if (!g.ref || !isAttached(ctx, g.ref.el)) return [];
      if (!chosen.has(g.option)) return holdsOnlyMark(ctx, g.ref) ? [`a mark is printed in “${g.option}”`] : [];
      const run = marks.get(g.option);
      return run && !isAttached(ctx, run) ? [`the chosen “${g.option}” is not marked`] : [];
    });
  // Review 26/10: a box the record leaves empty (record_empty) is a blank box too – a pre-printed mark never issues; a
  // FINAL box nobody decided is checked the same way, nothing cleared (Track.checkOnly).
  if (answer.leftBlank || answer.blank || t?.checkOnly) {
    // Fix round 1 (B0-2): left blank – a mark printed as a default ("x") is cleared, never left as an answer.
    if (clearsBlank(t)) for (const target of targets) if (target.ref && clearMark(ctx, target.ref)) setOutcome(t, "cleared");
    t?.checks.push(markedWrongly(new Set()));
    return;
  }
  const choice = choiceFor(ctx, field, answer, options);
  if (choice.kind === "none_given") return;
  if (choice.kind === "unmatched" && (field.answerType === "short_text" || field.answerType === "long_text")) {
    // "Tick all that apply" read as text naming something not printed: nothing is marked – the printed default marks
    // too (explicit, never left to read as the answer). Informational: the validators ask for the printed options.
    ctx.warn(`${where(field)}: “${choice.text}” is not one of the printed columns, so no cell was marked.`);
    for (const target of targets) if (target.ref && clearMark(ctx, target.ref)) setOutcome(t, "cleared");
    if (t) {
      t.noteOnly = true;
      t.problem = null;
      t.notes.push(`“${choice.text}” is not one of the printed columns, so no cell was marked`);
    }
    t?.checks.push(markedWrongly(new Set()));
    return;
  }
  if (choice.kind !== "chosen") {
    // Unknown or unmatched: every cell stays as printed – never a guess (fatal on a decided box, choiceFor).
    if (choice.kind === "unmatched") ctx.warn(`${where(field)}: the answer “${answer.text ?? String(answer.value)}” does not match any column, so no cell was marked.`);
    return;
  }
  const chosen = new Set(choice.options);
  const anchor = field.anchor.kind === "docx" ? field.anchor : null;
  const mark = cleanXmlText(anchor?.mark ?? "X").trim() || "X"; // no control characters (security fix 24/10/2026)
  let ok = true;
  for (const target of targets) {
    if (!target.ref) {
      ctx.warn(`${where(field)}: the cell for “${target.option}” was not found.`);
      continue;
    }
    if (chosen.has(target.option)) {
      claim(ctx, field, target.ref.el, "mark");
      const run = writeMark(ctx, target.ref, mark, field);
      if (run) marks.set(target.option, run);
      else ok = false;
    } else clearMark(ctx, target.ref);
  }
  if (ok) setOutcome(t, "written");
  else setOutcome(t, "not_found", "a chosen cell could not be marked");
  t?.checks.push(markedWrongly(chosen));
}

/* ------------------------------------------------------------------------------------------------
 * "Delete as necessary" lists (delete_options, 10/2026): only the chosen option is kept; the others are removed
 * ----------------------------------------------------------------------------------------------*/

/** Index of `needle` in `text` (case-insensitive) from `from`, as a whole word or phrase; -1 when it is not there. */
function findWord(text: string, needle: string, from = 0): number {
  const t = text.toLowerCase();
  const n = needle.trim().toLowerCase();
  if (!n) return -1;
  for (let i = t.indexOf(n, from); i >= 0; i = t.indexOf(n, i + 1)) {
    const before = i === 0 ? "" : t.charAt(i - 1);
    const after = t.charAt(i + n.length);
    const edge = (ch: string, side: string) => ch === "" || !/[a-z0-9]/i.test(ch) || !/[a-z0-9]/i.test(side);
    if (edge(before, n.charAt(0)) && edge(after, n.charAt(n.length - 1))) return i;
  }
  return -1;
}

const BLOCKS = ["p", "tbl", "sdt", "sectPr"];

/** The nearest block (paragraph, table, control or section end) before / after `el` among its siblings. */
function siblingBlock(el: XmlElement, dir: "previousSibling" | "nextSibling"): XmlElement | null {
  for (let n = el[dir]; n; n = n[dir]) if (isElement(n) && BLOCKS.some((b) => isW(n, b))) return n;
  return null;
}

/**
 * A line just after a table that a table, or the end of its cell or of the body, follows: without it Word joins the
 * two tables, or finds a cell (or the document) ending in a table and may call the file damaged (review 25/10/2026).
 */
function keepsTableApart(p: XmlElement): boolean {
  if (!isW(siblingBlock(p, "previousSibling"), "tbl")) return false;
  const next = siblingBlock(p, "nextSibling");
  return !next || isW(next, "tbl") || isW(next, "sectPr");
}

function removeIfBlank(ctx: Ctx, p: XmlElement): void {
  // Bounded work (plan WA2 design 4): leaving a line off makes xmldom re-index its parent's children, so only where the
  // parent holds few (fewSiblings) – elsewhere the emptied line stays, empty.
  if (!fewSiblings(p)) return;
  readLines(ctx, [p], 3);
  if (segmentsText(paragraphSegments(p)).trim() !== "") return;
  if (descendantsW(p, "drawing").length > 0 || descendantsW(p, "pict").length > 0) return; // a picture (a logo) stays
  const cell = ancestorW(p, "tc");
  if (cell) step(ctx, cell.childNodes.length);
  if (cell && wChildren(cell, "p").length <= 1) return; // a cell keeps its last paragraph
  if (firstW(firstW(p, "pPr"), "sectPr")) return;
  if (keepsTableApart(p)) return;
  remove(ctx, p);
}

/** Occurrences of `needle` in the form's own text of `paras` (answers masked). */
function printedCount(ctx: Ctx, paras: readonly XmlElement[], needle: string): number {
  readLines(ctx, paras);
  let n = 0;
  for (const p of paras) {
    const text = maskedText(p);
    for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) n += 1;
  }
  return n;
}

/** `removeAll` (fix round 1, B0-2): the question was left blank – every printed option is removed, none kept. */
function fillDeleteOptions(ctx: Ctx, job: Job, unanswered: boolean, removeAll = false): void {
  const { field, ref, answer } = job;
  const t = unanswered ? null : trackOf(ctx, field);
  const anchor = field.anchor.kind === "docx" ? field.anchor : null;
  if (!anchor) return;
  const lines = anchor.placeholderText ? [] : (anchor.optionTexts ?? []);
  const options = field.options?.length ? field.options : lines.map((o) => o.option);
  const list = anchor.placeholderText ?? "";
  const paras = blockParagraphs(ref);
  if (list) {
    const occ = occurrences(ctx, paras, list);
    const k = skipKey(ctx, ref.el, list);
    if (occ.length === 0) {
      if (!unanswered) ctx.warn(`${where(field)}: the options “${list}” were not found, so nothing was deleted.`);
      setOutcome(t, "not_found", `its printed options (${list}) are not in that place on the form`);
      return;
    }
    const before = printedCount(ctx, paras, list);
    // Explicit on the issued form: the printed list is gone (removed, or replaced by the kept option) – checked once the
    // whole form is filled.
    const listGone = () => t?.checks.push(() => (paras.some((p) => isAttached(ctx, p)) && printedCount(ctx, paras, list) >= before ? [`the printed options “${list}” are still on the form`] : []));
    const choice: ChoiceResolution | null = removeAll ? { kind: "chosen", options: [] } : unanswered ? null : choiceFor(ctx, field, answer, options);
    const chosen = choice?.kind === "chosen" ? new Set(choice.options) : null;
    const target = occ[Math.min(k, occ.length - 1)];
    if (t && t.decided) claim(ctx, field, target.p, `list|${list}|${Math.min(k, occ.length - 1)}`);
    // A single printed item ("delete any that do not apply"): kept when ticked, removed when not – and the whole list
    // when the question is left blank.
    if (chosen && (options.length === 1 || removeAll)) {
      let settled = true;
      if (chosen.size === 0 && !replaceRange(ctx, target.p, target.index, target.index + target.length, () => [])) {
        ctx.warn(`${where(field)}: “${list}” could not be removed.`);
        setOutcome(t, "as_printed", `“${list}” could not be removed`);
        settled = false;
      }
      if (chosen.size === 0) {
        ctx.deletedParas.add(target.p);
        removeIfBlank(ctx, target.p);
        if (settled) setOutcome(t, removeAll ? "cleared" : "written");
        listGone();
      } else {
        // The single item is kept as printed: that is the answer.
        addSkip(ctx, ref.el, list);
        setOutcome(t, "written");
      }
      if (settled) ctx.chosenLists.add(field);
      return;
    }
    if (chosen === null || chosen.size !== 1) {
      if ((chosen && chosen.size === 0) || choice?.kind === "unmatched") ctx.warn(`${where(field)}: the answer “${answer.text ?? String(answer.value)}” is not one of “${list}”, so every option was left as printed.`);
      if (chosen && chosen.size > 1) setOutcome(t, "as_printed", `the answer chooses more than one of “${list}”`);
      if (t?.decided && choice?.kind !== "none_given") listGone();
      addSkip(ctx, ref.el, list);
      return;
    }
    const keep = Array.from(chosen)[0];
    const printed = target.text;
    const at = findWord(printed, keep);
    const kept = cleanXmlText(at >= 0 ? printed.slice(at, at + keep.trim().length) : keep); // no control characters (24/10)
    ctx.deletedParas.add(target.p);
    if (
      !replaceRange(ctx, target.p, target.index, target.index + target.length, (styleRPr) => {
        const run = makeRun(ctx, [kept], styleRPr, "answer");
        KEPT_PRINT.add(run);
        return [run];
      })
    ) {
      ctx.warn(`${where(field)}: the options “${list}” could not be changed, so every option was left as printed.`);
      setOutcome(t, "as_printed", `the options “${list}” could not be changed`);
    } else {
      ctx.chosenLists.add(field);
      setOutcome(t, "written");
    }
    listGone();
    return;
  }
  // One option per line (or a single printed item kept when ticked).
  const choice: ChoiceResolution | null = removeAll ? { kind: "chosen", options: [] } : unanswered ? null : choiceFor(ctx, field, answer, options);
  if (choice === null || choice.kind === "none_given") return;
  if (choice.kind !== "chosen") {
    ctx.warn(`${where(field)}: the answer “${answer.text ?? String(answer.value)}” does not match any printed option, so every option was left as printed.`);
    return;
  }
  const chosen = new Set(choice.options);
  if (chosen.size === 0 && options.length > 1 && !removeAll) {
    ctx.warn(`${where(field)}: the answer “${answer.text ?? String(answer.value)}” does not match any printed option, so every option was left as printed.`);
    setOutcome(t, "as_printed", "none of the printed options matches the answer");
    return;
  }
  // Locate every option on the untouched lines first, then remove the others from the end backwards.
  const located: Array<{ option: string; p: XmlElement; index: number; length: number; text: string }> = [];
  // Positions already taken, per paragraph (security fix 24/10/2026: a Set, not a scan of `located` per option).
  const taken = new Map<XmlElement, Set<number>>();
  for (const o of lines) {
    const block = ctx.index.byId.get(o.blockId);
    if (!block) {
      ctx.warn(`${where(field)}: the line for “${o.option}” was not found, so every option was left as printed.`);
      setOutcome(t, "not_found", `the line for “${o.option}” is not on the form`);
      return;
    }
    let hit: { p: XmlElement; index: number } | null = null;
    const blockParas = blockParagraphs(block);
    readLines(ctx, blockParas);
    for (const p of blockParas) {
      const text = maskedText(p);
      const i = text.indexOf(o.text);
      if (i >= 0 && !taken.get(p)?.has(i)) {
        hit = { p, index: i };
        break;
      }
    }
    if (!hit) {
      ctx.warn(`${where(field)}: “${o.text}” was not found, so every option was left as printed.`);
      setOutcome(t, "not_found", `the printed option “${o.text}” is not in its place on the form`);
      return;
    }
    located.push({ option: o.option, p: hit.p, index: hit.index, length: o.text.length, text: o.text });
    const set = taken.get(hit.p) ?? new Set<number>();
    set.add(hit.index);
    taken.set(hit.p, set);
  }
  // Removed per paragraph from the END backwards, so an earlier removal never shifts a later one (security fix
  // 24/10/2026: one sort over all paragraphs with "0 when the paragraphs differ" is not a consistent comparator, and
  // options interleaved over two paragraphs could delete the wrong characters).
  const drop = located.filter((l) => !chosen.has(l.option));
  const printedBefore = new Map(drop.map((l) => [l, printedCount(ctx, [l.p], l.text)] as const));
  const byParagraph = new Map<XmlElement, typeof drop>();
  for (const l of drop) byParagraph.set(l.p, [...(byParagraph.get(l.p) ?? []), l]);
  let settled = true;
  byParagraph.forEach((items, para) => {
    for (const l of items.sort((a, b) => b.index - a.index)) {
      ctx.deletedParas.add(para);
      if (!replaceRange(ctx, para, l.index, l.index + l.length, () => [])) {
        ctx.warn(`${where(field)}: “${l.option}” could not be removed.`);
        settled = false;
      }
    }
  });
  byParagraph.forEach((_, para) => removeIfBlank(ctx, para));
  if (settled) ctx.chosenLists.add(field);
  if (t) {
    if (settled) setOutcome(t, removeAll ? "cleared" : "written");
    else setOutcome(t, "as_printed", "a printed option that was not chosen could not be removed");
    // Explicit on the issued form: every option not chosen is gone (its line removed, or its text).
    t.checks.push(() => drop.filter((l) => isAttached(ctx, l.p) && printedCount(ctx, [l.p], l.text) >= (printedBefore.get(l) ?? 1)).map((l) => `the printed option “${l.option}” is still on the form`));
  }
}

/** Every table row around `el` whose height is exact is set to "at least" that height, so an answer never clips. */
function growExactRows(ctx: Ctx, el: XmlElement): void {
  for (let tr = isW(el, "tr") ? el : ancestorW(el, "tr"); tr; tr = ancestorW(tr, "tr")) {
    const height = firstW(firstW(tr, "trPr"), "trHeight");
    if (height && wAttr(height, "hRule") === "exact") setWAttr(ctx.dom, height, "hRule", "atLeast");
  }
}

/* ------------------------------------------------------------------------------------------------
 * Template instructions (10/2026): the form author's notes for whoever completes the form are left off
 * ----------------------------------------------------------------------------------------------*/

/** A run's own text colour ("ff0000"); "" for the default (none, automatic or black). */
function runColour(run: XmlElement | null): string {
  return instructionColour(wAttr(firstW(firstW(run, "rPr"), "color"), "val"));
}

/** The form's own printed text in a paragraph: what this fill wrote is left out (an answer is never a box's label). */
function printedText(p: XmlElement): string {
  return paragraphSegments(p)
    .filter((seg) => !isWritten(seg.run))
    .map((seg) => seg.text)
    .join("");
}

/** A paragraph of a table cell with a line of printed text above it in the cell (the box's own label; 10 lines up at most). */
function belowLabelInCell(p: XmlElement): boolean {
  if (!isW(p.parentNode, "tc")) return false;
  let lines = 0;
  for (let n = p.previousSibling; n && lines < 10; n = n.previousSibling) {
    if (!isW(n, "p")) continue;
    if (printedText(n).trim()) return true;
    lines += 1;
  }
  return false;
}

/**
 * The form's own instructions in a paragraph (core/template-instructions.ts) – never one touching a written run. A line
 * of more than MAX_SIBLINGS_TO_LEAVE_OFF runs or text pieces is left as printed: leaving text off splits and removes
 * them one by one, and xmldom re-indexes the line each time (hostile sizes, integration review 25/10/2026).
 */
function instructionsIn(p: XmlElement): TemplateInstruction[] {
  if (!mayHoldInstruction(p.textContent ?? "")) return [];
  if (descendantsW(p, "r").length > MAX_SIBLINGS_TO_LEAVE_OFF || descendantsW(p, "t").length > MAX_SIBLINGS_TO_LEAVE_OFF) return [];
  let text = "";
  const colours: Array<{ at: number; colour: string }> = [];
  const written: Array<[number, number]> = [];
  let colourOf: XmlElement | null | undefined;
  let colour = "";
  for (const seg of paragraphSegments(p)) {
    if (seg.kind === "text" && seg.text) {
      // Once per run, not per text piece: finding a run's properties walks its children.
      if (seg.run !== colourOf) {
        colourOf = seg.run;
        colour = runColour(seg.run);
      }
      if (colours[colours.length - 1]?.colour !== colour) colours.push({ at: text.length, colour });
    }
    if (isWritten(seg.run)) written.push([text.length, text.length + seg.text.length]);
    text += seg.kind === "tab" ? "\t" : seg.text;
  }
  // Both lists are in text order and do not overlap: one pointer walks the written ranges.
  let w = 0;
  return findTemplateInstructions({ text, colours, belowLabelInCell: belowLabelInCell(p) }).filter((f) => {
    while (w < written.length && written[w][1] <= f.start) w += 1;
    return !(w < written.length && written[w][0] < f.end);
  });
}

/** A paragraph's text without the form's instructions. */
function textWithoutInstructions(p: XmlElement): string {
  let text = paragraphText(p);
  for (const f of instructionsIn(p).reverse()) text = text.slice(0, f.start) + text.slice(f.end);
  return text.trim();
}

const NOT_PLAIN_IN_ROW = ["tbl", "sdt", "fldChar", "drawing", "pict", "object", "txbxContent"];

/**
 * A plain table row's printed text cell by cell, instructions left out (null: merged cells, controls, fields, or a
 * mail-merge code – a row still printing «Name» / <<DATE>> is never "unused", so the final check still sees it).
 */
function rowText(tr: XmlElement): { key: string; blank: boolean } | null {
  const cells = wChildren(tr, "tc");
  if (cells.length === 0 || wChildren(tr, "sdt").length > 0 || wChildren(tr, "customXml").length > 0) return null;
  const parts: string[] = [];
  let blank = true;
  for (const tc of cells) {
    const tcPr = firstW(tc, "tcPr");
    if (firstW(tcPr, "vMerge") || NOT_PLAIN_IN_ROW.some((name) => descendantsW(tc, name).length > 0)) return null;
    const text = wChildren(tc, "p").map(textWithoutInstructions).filter(Boolean).join("\n");
    if (hasMergeToken(text)) return null;
    if (text) blank = false;
    parts.push(`${wAttr(firstW(tcPr, "gridSpan"), "val") ?? "1"}:${text}`);
  }
  const trPr = firstW(tr, "trPr");
  return { key: JSON.stringify([wAttr(firstW(trPr, "gridBefore"), "val"), wAttr(firstW(trPr, "gridAfter"), "val"), parts]), blank };
}

function previousRow(tr: XmlElement): XmlElement | null {
  for (let n = tr.previousSibling; n; n = n.previousSibling) if (isElement(n)) return isW(n, "tr") ? n : null;
  return null;
}

/** The row's table has another row (a table never loses its last one). */
function hasOtherRow(tr: XmlElement): boolean {
  for (let n = tr.previousSibling; n; n = n.previousSibling) if (isW(n, "tr")) return true;
  for (let n = tr.nextSibling; n; n = n.nextSibling) if (isW(n, "tr")) return true;
  return false;
}

const hasWritten = (el: XmlElement): boolean => descendantsW(el, "r").some(isWritten);

/** Real forms leave off a few dozen rows; past this many the rest stay as printed (each removal walks the table). */
const MAX_ROWS_LEFT_OFF = 500;

/**
 * Leaving a line or row off makes xmldom re-index every child of its parent, so it is only done where the parent holds
 * at most this many (a real form's body, table or cell holds well under a hundred – Blue Heart's 55 at most). Elsewhere
 * an emptied line stays, empty, and the rows stay as printed: bounded work on hostile files (security review 25/10/2026).
 */
const MAX_SIBLINGS_TO_LEAVE_OFF = 2_000;
const fewSiblings = (el: XmlElement): boolean => (el.parentNode?.childNodes.length ?? Infinity) <= MAX_SIBLINGS_TO_LEAVE_OFF;

interface UnusedRowsPlan {
  /** The row that prints "Delete unused cells". */
  row: XmlElement;
  /** The repeat rows it refers to (itself too when it is the last of them), each with its printed text. */
  rows: Array<{ tr: XmlElement; key: string }>;
  /** The instruction has a row of its own (nothing else printed in it). */
  ownRow: boolean;
}

/**
 * The repeat rows a "Delete unused cells/rows/lines" in `p` refers to: those directly above its row – at least two
 * plain rows printing the same text (the row itself counts when it prints the same once the instruction is left out).
 * An instruction sharing its row with other text is only removed as text. `claimed`: rows already in a plan – a later
 * instruction's look upwards stops there, so each row is read once.
 */
function planUnusedRows(p: XmlElement, claimed: Set<XmlElement>): UnusedRowsPlan | null {
  const row = ancestorW(p, "tr");
  if (!row || claimed.has(row) || !fewSiblings(row)) return null;
  claimed.add(row);
  const own = rowText(row);
  if (!own) return null;
  const above = previousRow(row);
  const like = above && !claimed.has(above) ? rowText(above) : null;
  const rows: UnusedRowsPlan["rows"] = [];
  if (like) for (let tr = above; tr && !claimed.has(tr) && rowText(tr)?.key === like.key; tr = previousRow(tr)) rows.push({ tr, key: like.key });
  rows.reverse(); // top to bottom
  const member = own.key === like?.key;
  if (member) rows.push({ tr: row, key: own.key });
  else if (!own.blank) return null;
  for (const { tr } of rows) claimed.add(tr);
  return { row, rows: rows.length >= 2 ? rows : [], ownRow: !member };
}

/** Where each "delete as necessary" list is printed (25/10): every element holding a line of it, up to the body. */
type ListsByElement = Map<XmlElement, Set<FormField>>;

function listsByElement(ctx: Ctx, jobs: Job[]): ListsByElement {
  const out: ListsByElement = new Map();
  for (const { field } of jobs) {
    if (field.anchor.kind !== "docx" || field.anchor.target !== "delete_options") continue;
    for (const id of docxAnchorBlockIds(field.anchor)) {
      for (let n: XmlNode | null = ctx.index.byId.get(id)?.el ?? null; isElement(n) && n !== ctx.dom.body; n = n.parentNode) {
        const here = out.get(n) ?? new Set<FormField>();
        if (here.has(field)) break; // so are the elements above it
        here.add(field);
        out.set(n, here);
      }
    }
  }
  return out;
}

/**
 * The lists a note beside options ("Delete as necessary") in `p` refers to, on the untouched document: those printed
 * in its own line, else in its cell, else in its row, else in the blocks right after its row (outside a table: after
 * its line) while they print lists – blank ones skipped, 10 at most. Empty when none is printed next to it.
 */
function listsNextTo(p: XmlElement, lists: ListsByElement): Set<FormField> {
  const cell = ancestorW(p, "tc");
  const row = cell ? ancestorW(cell, "tr") : null;
  for (const scope of [p, cell, row]) {
    const here = scope ? lists.get(scope) : undefined;
    if (here?.size) return here;
  }
  const out = new Set<FormField>();
  let blank = 0;
  for (let n = (row ?? p).nextSibling; n; n = n.nextSibling) {
    if (!isW(n, "p") && !isW(n, "tbl") && !isW(n, "tr") && !isW(n, "sdt")) continue; // bookmarks and the like
    const here = lists.get(n);
    if (here?.size) here.forEach((f) => out.add(f));
    else if (out.size > 0 || (n.textContent ?? "").trim() || ++blank > 10) break;
  }
  return out;
}

interface InstructionPlan {
  rows: UnusedRowsPlan[];
  /** Each line printing a note beside options (kind "delete") → the lists next to it (listsNextTo). */
  lists: Map<XmlElement, Set<FormField>>;
}

/**
 * Read on the untouched document: the repeat rows each "Delete unused cells" refers to, and the lists next to each
 * note beside options. null when the form prints more than MAX_INSTRUCTIONS_PER_FORM: not a template's notes, so it is
 * left as printed (and the work stays bounded: security review 25/10/2026).
 */
function planInstructions(ctx: Ctx, lists: ListsByElement): InstructionPlan | null {
  const plan: InstructionPlan = { rows: [], lists: new Map() };
  const claimed = new Set<XmlElement>();
  let count = 0;
  for (const p of descendantsW(ctx.dom.body, "p")) {
    const here = instructionsIn(p);
    if (here.length === 0) continue;
    count += here.length;
    if (count > MAX_INSTRUCTIONS_PER_FORM) return null;
    if (here.some((f) => f.kind === "delete")) plan.lists.set(p, listsNextTo(p, lists));
    const rows = here.some((f) => f.kind === "delete_unused") ? planUnusedRows(p, claimed) : null;
    if (rows) plan.rows.push(rows);
  }
  return plan;
}

/** An answer chose from every list next to a note beside options (and at least one is printed there). */
function chosenFromAll(ctx: Ctx, lists: Set<FormField> | undefined): boolean {
  return !!lists && lists.size > 0 && Array.from(lists).every((f) => ctx.chosenLists.has(f));
}

/**
 * Table rows an answered question writes in or ticks (25/10): never "unused", even when the answer left the row's
 * text as printed (a box answered "No" stays unticked).
 */
function answeredRows(ctx: Ctx, form: FormDefinition, answers: FormFillAnswers): Set<XmlElement> {
  const out = new Set<XmlElement>();
  for (const field of form.fields) {
    if (field.anchor.kind !== "docx" || !isAnswerableField(field) || !answerText(field, answers[field.id] ?? {})) continue;
    for (const id of docxAnchorBlockIds(field.anchor)) {
      const el = ctx.index.byId.get(id)?.el;
      for (let tr = !el ? null : isW(el, "tr") ? el : ancestorW(el, "tr"); tr && !out.has(tr); tr = ancestorW(tr, "tr")) out.add(tr);
    }
  }
  return out;
}

/**
 * After every answer is written: each instruction leaves the line (with its brackets), a line it emptied goes (a cell
 * keeps its last line), and for "Delete unused cells" its own row goes, and so do the repeat rows the report left as
 * printed – the first stays when none was used. A note beside options stays until an answer has chosen from every list
 * next to it, so a list nobody chose from never reads as chosen. One note lists what was left off. A form without any
 * is unchanged; one printing more than MAX_INSTRUCTIONS_PER_FORM is left as printed (read before anything changes).
 */
function leaveOffInstructions(ctx: Ctx, plan: InstructionPlan | null, answered: Set<XmlElement>): void {
  if (!plan) return;
  const lines: Array<{ p: XmlElement; off: TemplateInstruction[] }> = [];
  let count = 0;
  for (const p of descendantsW(ctx.dom.body, "p")) {
    const here = instructionsIn(p);
    if (here.length === 0) continue;
    count += here.length;
    if (count > MAX_INSTRUCTIONS_PER_FORM) return;
    const off = here.filter((f) => f.kind !== "delete" || chosenFromAll(ctx, plan.lists.get(p)));
    if (off.length > 0) lines.push({ p, off });
  }
  const found: TemplateInstruction[] = [];
  const clearedRows = new Set<XmlElement>();
  for (const { p, off } of lines) {
    // From the end of the line, so the earlier offsets still hold.
    const removed: TemplateInstruction[] = [];
    for (const f of off.slice().reverse()) if (replaceRange(ctx, p, f.start, f.end, () => [])) removed.unshift(f);
    if (removed.length === 0) continue;
    found.push(...removed);
    const row = ancestorW(p, "tr");
    if (row) clearedRows.add(row);
    const parent = p.parentNode;
    if ((parent === ctx.dom.body || isW(parent, "tc")) && fewSiblings(p)) removeIfBlank(ctx, p);
  }
  if (found.length === 0) return;
  const unusedRow = (tr: XmlElement) => !answered.has(tr) && !hasWritten(tr);
  let rowsLeftOff = 0;
  let removedRows = 0;
  for (const repeat of plan.rows) {
    if (!clearedRows.has(repeat.row) || removedRows >= MAX_ROWS_LEFT_OFF) continue;
    const unused = repeat.rows.filter(({ tr, key }) => unusedRow(tr) && rowText(tr)?.key === key);
    if (unused.length === repeat.rows.length) unused.shift(); // none was used: the table keeps one empty row
    for (const { tr } of unused.slice(0, MAX_ROWS_LEFT_OFF - removedRows)) {
      remove(ctx, tr);
      rowsLeftOff += 1;
      removedRows += 1;
    }
    if (repeat.ownRow && repeat.row.parentNode && unusedRow(repeat.row) && rowText(repeat.row)?.blank && hasOtherRow(repeat.row) && removedRows < MAX_ROWS_LEFT_OFF) {
      remove(ctx, repeat.row);
      removedRows += 1;
    }
  }
  ctx.warn(instructionsLeftOffNote(found, rowsLeftOff));
}

/* ------------------------------------------------------------------------------------------------
 * DRAFT banner
 * ----------------------------------------------------------------------------------------------*/

function insertDraftBanner(ctx: Ctx): void {
  const { dom } = ctx;
  const p = wEl(dom, "p");
  const pPr = wEl(dom, "pPr");
  const bdr = wEl(dom, "pBdr");
  for (const side of ["top", "left", "bottom", "right"]) bdr.appendChild(wEl(dom, side, { val: "single", sz: "8", space: "4", color: "B42318" }));
  pPr.appendChild(bdr);
  pPr.appendChild(wEl(dom, "shd", { val: "clear", color: "auto", fill: "FDECEA" }));
  pPr.appendChild(wEl(dom, "spacing", { before: "0", after: "160" }));
  pPr.appendChild(wEl(dom, "jc", { val: "center" }));
  p.appendChild(pPr);
  p.appendChild(wEl(dom, "bookmarkStart", { id: "907001", name: DRAFT_BANNER_BOOKMARK }));
  const run = (text: string, bold: boolean, size: string) => {
    const r = wEl(dom, "r");
    const rPr = wEl(dom, "rPr");
    if (bold) rPr.appendChild(wEl(dom, "b"));
    rPr.appendChild(wEl(dom, "color", { val: "B42318" }));
    rPr.appendChild(wEl(dom, "sz", { val: size }));
    rPr.appendChild(wEl(dom, "szCs", { val: size }));
    r.appendChild(rPr);
    const t = wEl(dom, "t");
    t.setAttributeNS(XML_NS, "xml:space", "preserve");
    t.appendChild(dom.doc.createTextNode(text));
    r.appendChild(t);
    return r;
  };
  p.appendChild(run("DRAFT – awaiting clinician approval", true, "24"));
  p.appendChild(run("  ·  Not for issue. Every answer must be checked and approved by the treating clinician.", false, "17"));
  p.appendChild(wEl(dom, "bookmarkEnd", { id: "907001" }));
  const first = childElements(dom.body)[0];
  if (first) dom.body.insertBefore(p, first);
  else dom.body.appendChild(p);
}

/* ------------------------------------------------------------------------------------------------
 * Entry point
 * ----------------------------------------------------------------------------------------------*/

/** A not-applicable reason (BoxState not_applicable): the box is not asked, so a merge code there is cleared. */
const NOT_APPLICABLE_REASONS = new Set(["condition", "session_not_attended", "person"]);

/** What a field is meant to issue – WA1's state when the caller has it, else what its answer says – and the answer to fill. */
function intentOf(field: FormField, given: FormFillAnswer, opts: DocxFillOptions): Pick<Track, "intended" | "reason" | "decided"> & { answer: FormFillAnswer; checkOnly?: boolean } {
  const s = opts.states?.[field.id];
  const has = answerText(field, given) !== "";
  if (s) {
    switch (s.kind) {
      case "answer":
        return { intended: "answer", reason: null, decided: true, answer: given };
      case "signoff":
        return { intended: "signoff", reason: null, decided: has, answer: given };
      case "not_applicable":
        return { intended: "not_applicable", reason: s.reason, decided: true, answer: { leftBlank: true } };
      case "blank":
        if (s.reason === "record_empty") return { intended: "blank", reason: s.reason, decided: true, answer: { text: "", blank: true } };
        if (s.reason === "no_answer" && opts.draft) return { intended: "blank", reason: s.reason, decided: false, answer: {} };
        return { intended: "blank", reason: s.reason, decided: true, answer: { leftBlank: true } };
      default:
        return { intended: s.kind, reason: null, decided: false, answer: {} };
    }
  }
  if (field.fillSource.kind === "signoff") return { intended: "signoff", reason: null, decided: has, answer: given };
  if (has) return { intended: "answer", reason: null, decided: true, answer: given };
  if (given.blank) return { intended: "blank", reason: "record_empty", decided: true, answer: given };
  if (given.leftBlank) return { intended: "blank", reason: "left_blank", decided: true, answer: given };
  // No answer and no decision on a FINAL copy (core/forms buildFormAnswers gives {} to a box without a report section):
  // written as before – left as printed, its list and instruction too – but what it issues is settled, so a printed
  // mark, tick or default value there, which reads as an answer, refuses the copy (review 26/10). Nothing is cleared.
  if (!opts.draft) return { intended: "blank", reason: "no_answer", decided: true, answer: given, checkOnly: true };
  // A draft: no answer yet – left as printed.
  return { intended: "blank", reason: "no_answer", decided: false, answer: given };
}

/** A merge code a field's placeholder prints, still in the form's own text of its block. */
function mergeCodesLeft(ctx: Ctx, job: Job): string[] {
  const needle = job.field.anchor.kind === "docx" ? (job.field.anchor.placeholderText ?? "") : "";
  const tokens = findMergeTokens(needle);
  if (tokens.length === 0) return [];
  const paras = blockParagraphs(job.ref).filter((p) => isAttached(ctx, p));
  return tokens.filter((tok) => printedCount(ctx, paras, tok) > 0);
}

/**
 * A box decided blank (left blank, approved without an answer, not applicable): it prints nothing that reads as an
 * answer (ledger hook "fill-leave-blank"). Blank lines and empty cells stay as printed.
 */
function fillBlankBox(ctx: Ctx, job: Job, t: Track): void {
  const anchor = job.field.anchor.kind === "docx" ? job.field.anchor : null;
  if (!anchor) return;
  const enabled = clearsBlank(t);
  const needle = anchor.placeholderText ?? "";
  switch (anchor.target) {
    case "delete_options":
      if (enabled) fillDeleteOptions(ctx, job, false, true);
      else t.checks.push(() => (needle && printedCount(ctx, blockParagraphs(job.ref).filter((p) => isAttached(ctx, p)), needle) > 0 ? [`the printed options “${needle}” are still on the form`] : []));
      return;
    case "replace_placeholder": {
      if (anchor.writeAfter || !needle) return;
      if (hasMergeToken(needle)) {
        // A merge code is cleared only where the box is not asked; in a box left blank it stays – the copy is refused.
        if (enabled && t.intended === "not_applicable" && NOT_APPLICABLE_REASONS.has(t.reason ?? "") && clearPlaceholder(ctx, job)) setOutcome(t, "cleared");
        else addSkip(ctx, job.ref.el, needle);
        t.checks.push(() => mergeCodesLeft(ctx, job).map((tok) => `${listMergeTokensInWords([tok])} is still on the form (a mail-merge field)`));
        return;
      }
      if (printsDefault(needle) || anchor.clearPlaceholder) {
        // A printed default ("30 minutes") or text that must never go out is removed.
        const paras = blockParagraphs(job.ref);
        const before = printedCount(ctx, paras, needle);
        if (enabled && clearPlaceholder(ctx, job)) setOutcome(t, "cleared");
        else addSkip(ctx, job.ref.el, needle);
        if (printsDefault(needle)) t.checks.push(() => (paras.some((p) => isAttached(ctx, p)) && printedCount(ctx, paras.filter((p) => isAttached(ctx, p)), needle) >= before ? [`the printed default “${needle}” is still on the form`] : []));
        return;
      }
      // Khuram, 26/10 (B3-19): a sentence opener left blank loses its printed lead and dots.
      if (dropBlankOpener(ctx, job, enabled)) setOutcome(t, "removed");
      // Review 26/10: a blank left printed is skipped, as an unanswered one is – a later answer mapped to the same
      // placeholder in that place takes the next blank, never this one ("Name ______ Date ______").
      else addSkip(ctx, job.ref.el, needle);
      return;
    }
    case "content_control": {
      const kind = clearContentControl(ctx, job, enabled);
      if (kind === "not_found") setOutcome(t, "not_found", "no free content control is in that place on the form");
      else setOutcome(t, kind);
      return;
    }
    case "legacy_form_field": {
      const kind = clearLegacyField(ctx, job, enabled);
      if (kind === "not_found") setOutcome(t, "not_found", "no free Word form field is in that place on the form");
      else setOutcome(t, kind);
      return;
    }
    default:
      return;
  }
}

/** The outcome reported for a field: fatal per plan WA2 design 1 (see the file comment). */
function toOutcome(t: Track): FillOutcome {
  const unwritten = (t.intended === "answer" || t.intended === "signoff") && t.outcome !== "written" && !t.noteOnly;
  const fatal = t.decided && (t.outcome === "not_found" || t.outcome === "collision" || t.residue.length > 0 || unwritten);
  const problem = t.problem ?? (unwritten ? "the answer was not written on the form" : null);
  const note = fatal && problem ? problem : t.notes.join("; ") || (problem ?? "");
  return {
    fieldId: t.field.id,
    intended: t.intended,
    outcome: t.outcome,
    ...(t.residue.length > 0 && { residue: Array.from(new Set(t.residue)) }),
    fatal,
    ...(note && { note }),
  };
}

/** The completed Word file and what the fill did at each answerable field (form order). */
export interface DocxFillReport {
  bytes: Buffer;
  outcomes: FillOutcome[];
  /** The work the fill did (bounded work): steps counted against MAX_FILL_STEPS, and typography sources read. */
  work: { steps: number; typographyReads: number };
}

export function fillDocx(buf: Uint8Array, form: FormDefinition, answers: FormFillAnswers, opts: DocxFillOptions): Buffer {
  return fillDocxReport(buf, form, answers, opts).bytes;
}

export function fillDocxReport(buf: Uint8Array, form: FormDefinition, answers: FormFillAnswers, opts: DocxFillOptions): DocxFillReport {
  const dom = loadDocxDom(buf);
  const index = indexBlocks(dom);
  // Bounded work (plan WA2 design 4): a body of more blocks than any real form is refused before anything is filled.
  if (index.blocks.length > MAX_FILL_BLOCKS) throw tooComplex(`This Word file has ${index.blocks.length.toLocaleString("en-GB")} paragraphs and table cells; forms that can be filled here have at most ${MAX_FILL_BLOCKS.toLocaleString("en-GB")}.`);
  const ctx: Ctx = {
    dom,
    index,
    form,
    opts,
    warn: (m) => opts.onWarning?.(m),
    tracks: new Map(),
    current: null,
    claims: new Map(),
    claimIds: new WeakMap(),
    nextClaimId: 0,
    steps: 0,
    counting: true,
    typographyReads: 0,
    sources: { firstRun: new WeakMap(), row: new WeakMap(), spaces: new WeakMap() },
    skipped: new Map(),
    usedControls: new Set(),
    usedLegacy: new Set(),
    glyphEdits: new Map(),
    deletedParas: new Set(),
    chosenLists: new Set(),
    rtf: isConvertedFromRtf(form.file),
  };

  // 1. Resolve every anchor on the untouched document – and (10/2026) the form author's instructions: the repeat rows a
  //    "Delete unused cells" refers to, and the lists next to a "Delete as necessary".
  const jobs: Job[] = [];
  const glyphJobs: { field: FormField; answer: FormFillAnswer; targets: GlyphTarget[] }[] = [];
  const markJobs: { field: FormField; answer: FormFillAnswer; targets: MarkTarget[] }[] = [];
  const effective: FormFillAnswers = {};
  for (const field of form.fields) {
    if (!isAnswerableField(field)) continue;
    const intent = intentOf(field, answers[field.id] ?? {}, opts);
    const t: Track = { field, intended: intent.intended, reason: intent.reason, decided: intent.decided, outcome: "as_printed", problem: null, residue: [], notes: [], noteOnly: false, checkOnly: intent.checkOnly === true, runs: [], checks: [] };
    ctx.tracks.set(field, t);
    const answer = intent.answer;
    effective[field.id] = answer;
    const anchor = field.anchor;
    if (anchor.kind !== "docx") {
      ctx.warn(`${where(field)}: this question has a PDF position, so it cannot be written into a Word form.`);
      setOutcome(t, "not_found", "it has a place on a PDF form, not on this Word form");
      continue;
    }
    if (anchor.target === "checkbox_glyph") {
      glyphJobs.push({ field, answer, targets: resolveGlyphs(ctx, field) });
      continue;
    }
    if (anchor.target === "mark_cell") {
      markJobs.push({ field, answer, targets: resolveMarkCells(ctx, field) });
      continue;
    }
    const ref = index.byId.get(anchor.blockId);
    if (!ref) {
      ctx.warn(`${where(field)}: its place on the form (${anchor.blockId}) was not found, so it was left blank. Check the form mapping.`);
      setOutcome(t, "not_found", `its place on the form (${anchor.blockId}) is not in this file`);
      continue;
    }
    jobs.push({ field, answer, ref });
  }
  // Bounded work: every question reads its own cell, so a cell of more lines than any real form is refused.
  const cells = [...jobs.map((j) => j.ref), ...markJobs.flatMap((m) => m.targets.map((x) => x.ref))];
  for (const ref of cells) {
    if (ref?.kind === "cell" && ref.paragraphs.length > MAX_BLOCK_PARAGRAPHS) {
      throw tooComplex(`A table cell of this Word file holds ${ref.paragraphs.length.toLocaleString("en-GB")} lines; a cell that is filled here holds at most ${MAX_BLOCK_PARAGRAPHS.toLocaleString("en-GB")}.`);
    }
  }
  // The form author's instructions are read in one pass over the body, bounded on its own (not counted).
  ctx.counting = false;
  const instructions = planInstructions(ctx, listsByElement(ctx, jobs));
  const answered = instructions?.rows.length ? answeredRows(ctx, form, effective) : new Set<XmlElement>();
  ctx.counting = true;

  // 2. Tick boxes first: they only swap characters, so nothing else moves. Then the marked cells (each in its own cell).
  for (const g of glyphJobs) {
    ctx.current = trackOf(ctx, g.field);
    fillCheckboxes(ctx, g.field, g.answer, g.targets);
  }
  flushGlyphEdits(ctx);
  for (const m of markJobs) {
    ctx.current = trackOf(ctx, m.field);
    fillMarkCells(ctx, m.field, m.answer, m.targets);
  }

  // 3. Text answers, in form order – "delete as necessary" lists first (10/2026 verify), so a blank printed inside a
  //    deleted option is known to be gone, and one inside a kept option is filled whatever the questions' order.
  const isDelete = (j: Job) => j.field.anchor.kind === "docx" && j.field.anchor.target === "delete_options";
  for (const job of [...jobs.filter(isDelete), ...jobs.filter((j) => !isDelete(j))]) {
    const { field } = job;
    const anchor = field.anchor.kind === "docx" ? field.anchor : null;
    const t = trackOf(ctx, field)!;
    ctx.current = t;
    if (!anchor) continue;
    if (!job.ref.el.parentNode) {
      ctx.warn(`${where(field)}: its place on the form was used by another answer, so it was left blank.`);
      setOutcome(t, "collision", "its place on the form was taken by another answer");
      continue;
    }
    const text = answerText(field, job.answer);
    // 10/2026: an answer space the record leaves empty on purpose (an address line it does not have): the
    // placeholder (a clinic system's merge code) is removed, never left or marked.
    const blank = text === "" && job.answer.blank === true;
    if (blank) {
      if (anchor.target === "replace_placeholder" && !anchor.writeAfter) {
        if (clearPlaceholder(ctx, job)) setOutcome(t, "cleared");
        else if (anchor.placeholderText) addSkip(ctx, job.ref.el, anchor.placeholderText);
      }
      t.checks.push(() => mergeCodesLeft(ctx, job).map((tok) => `${listMergeTokensInWords([tok])} is still on the form (a mail-merge field)`));
      continue;
    }
    // Fix round 1 (B0-2): a question a person left blank (or an approved report left without an answer, or one that
    // does not apply) prints nothing that reads as an answer – fillBlankBox.
    if (text === "" && job.answer.leftBlank) {
      fillBlankBox(ctx, job, t);
      continue;
    }
    const unanswered = text === "";
    // 10/2026: printed text that must never go out (e.g. a named clinician's numbers in a template) is removed while
    // its question has no answer yet – the review copy's marker replaces it anyway.
    if (unanswered && anchor.target === "replace_placeholder" && anchor.clearPlaceholder && !anchor.writeAfter && !opts.reviewMarkers) {
      clearPlaceholder(ctx, job);
      continue;
    }
    // Review 26/10: a FINAL box nobody decided (Track.checkOnly) is written as before, but a printed default value there
    // reads as an answer – checked, so the copy is refused.
    if (unanswered && t.checkOnly && anchor.target === "replace_placeholder" && !anchor.writeAfter && printsDefault(anchor.placeholderText) && !anchor.clearPlaceholder) {
      const paras = blockParagraphs(job.ref);
      const needle = anchor.placeholderText ?? "";
      const before = printedCount(ctx, paras, needle);
      t.checks.push(() => (paras.some((p) => isAttached(ctx, p)) && printedCount(ctx, paras.filter((p) => isAttached(ctx, p)), needle) >= before ? [`the printed default “${needle}” is still on the form`] : []));
    }
    const kind: RunKind = unanswered ? "unanswered" : "answer";
    const marker = field.fillSource.kind === "signoff" ? `[${field.id} – completed on approval]` : `[${field.id} – not answered yet]`;
    const skip = unanswered && !opts.reviewMarkers;
    const isoDate = typeof job.answer.value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(job.answer.value) ? job.answer.value : null;
    const value = unanswered ? marker : text;
    if (anchor.target === "delete_options") {
      fillDeleteOptions(ctx, job, unanswered);
      continue;
    }
    if (kind === "answer" && (anchor.target === "table_cell" || anchor.target === "after_paragraph")) {
      // Two answers mapped to one answer cell, or written after the same printed line, collide.
      claim(ctx, field, job.ref.el, anchor.target === "after_paragraph" && job.ref.kind === "paragraph" ? "after" : "cell");
    }
    switch (anchor.target) {
      case "table_cell":
        if (!skip) fillTableCell(ctx, job, value, kind);
        break;
      case "after_paragraph":
        if (!skip) fillAfterParagraph(ctx, job, value, kind);
        break;
      case "replace_placeholder":
        fillPlaceholder(ctx, job, value, kind, skip);
        break;
      case "content_control":
        fillContentControl(ctx, job, value, kind, skip, isoDate);
        break;
      case "legacy_form_field":
        fillLegacyField(ctx, job, value, kind, skip);
        break;
      default:
        break;
    }
    // 10/2026 verify: a table row of EXACT height (RTF templates' negative row heights) would clip a longer answer in
    // Word; once something is written there it becomes "at least" that height – the same look for a one-line answer.
    if (!skip) growExactRows(ctx, job.ref.el);
  }
  ctx.current = null;

  // 4. The form author's instructions for whoever completes it are left off (10/2026, core/template-instructions.ts) –
  //    bounded on their own (MAX_INSTRUCTIONS_PER_FORM, fewSiblings, MAX_ROWS_LEFT_OFF), so not counted.
  ctx.counting = false;
  leaveOffInstructions(ctx, instructions, answered);
  ctx.counting = true;

  // 5. What the fill did (plan WA2 design 1), on the elements resolved before anything changed: an answer that is no
  //    longer on the form, and residue on a decided box.
  for (const t of Array.from(ctx.tracks.values())) {
    if (!t.decided) continue;
    if ((t.intended === "answer" || t.intended === "signoff") && t.outcome === "written" && t.runs.length > 0 && !t.runs.some((r: XmlElement) => isAttached(ctx, r))) {
      t.outcome = "collision";
      t.problem = "another answer, or a line or row left off, took its place on the form";
    }
    for (const check of t.checks) t.residue.push(...check());
  }
  const outcomes = form.fields.filter(isAnswerableField).map((f) => toOutcome(ctx.tracks.get(f)!));

  if (opts.draft) insertDraftBanner(ctx);
  return { bytes: saveDocxDom(dom), outcomes, work: { steps: ctx.steps, typographyReads: ctx.typographyReads } };
}
