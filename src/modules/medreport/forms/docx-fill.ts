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
 * Owner: forms-engine agent. Signature final.
 */
import { docxAnchorBlockIds, isAnswerableField, isUnknownAnswer, matchOption, namedOptions, printsDefault, yesNoOption, type FormFillAnswer, type FormFillAnswers } from "../core/forms";
import { hasMergeToken } from "../core/merge-fields";
import { isConvertedFromRtf } from "../core/rtf/notes";
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

function insertAfter(node: XmlElement, ref: XmlElement): void {
  const parent = ref.parentNode;
  if (!parent) return;
  if (ref.nextSibling) parent.insertBefore(node, ref.nextSibling);
  else parent.appendChild(node);
}

function remove(node: XmlElement): void {
  node.parentNode?.removeChild(node);
}

/* ------------------------------------------------------------------------------------------------
 * Fill context
 * ----------------------------------------------------------------------------------------------*/

interface Ctx {
  dom: DocxDom;
  index: BlockIndex;
  opts: FillOptions;
  warn(message: string): void;
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

/** Typography only (font, size, language) – used when copying from a label or question run. */
function typographyOf(rPr: XmlElement | null, keep: string[] = ["rFonts", "sz", "szCs", "lang"]): XmlElement | null {
  if (!rPr) return null;
  const out = cloneEl(rPr);
  for (const child of childElements(out)) {
    if (!keep.includes(child.localName ?? "")) out.removeChild(child);
  }
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
function completeTypography(ctx: Ctx, base: XmlElement | null, sources: ReadonlyArray<XmlElement | null>): XmlElement | null {
  if (!ctx.rtf) return base;
  // An RTF template's empty answer line carries the bold or underline of the label above it in its paragraph mark.
  let out = withoutEmphasis(base);
  for (const key of ANSWER_TYPOGRAPHY) {
    if (out && firstW(out, key)) continue;
    for (const src of sources) {
      const el = firstW(src, key);
      if (!el || (key === "color" && labelOnlyColour(el))) continue;
      out ??= wEl(ctx.dom, "rPr");
      setProp(out, cloneEl(el), RPR_ORDER);
      break;
    }
  }
  return out;
}

/** Run properties of the whitespace-only runs in `paras` (an RTF template's typed spaces carry its answer style). */
function spaceRunRPrs(paras: XmlElement[]): XmlElement[] {
  const out: XmlElement[] = [];
  for (const p of paras) {
    for (const run of descendantsW(p, "r")) {
      const text = descendantsW(run, "t").map((t) => t.textContent ?? "").join("");
      const rPr = firstW(run, "rPr");
      if (rPr && text !== "" && text.trim() === "") out.push(rPr);
    }
  }
  return out;
}

/** Bold, italic and underline dropped (an answer written after a bold label is not bold). */
function withoutEmphasis(rPr: XmlElement | null): XmlElement | null {
  if (!rPr) return null;
  const out = cloneEl(rPr);
  for (const child of childElements(out)) if (["b", "bCs", "i", "iCs", "u"].includes(child.localName ?? "")) out.removeChild(child);
  return childElements(out).length ? out : null;
}

/** Run properties of a paragraph mark (pPr/rPr) as run properties. */
function markRPr(p: XmlElement | null): XmlElement | null {
  const rPr = firstW(firstW(p, "pPr"), "rPr");
  if (!rPr) return null;
  const out = cloneEl(rPr);
  for (const child of childElements(out)) {
    if (["ins", "del", "moveFrom", "moveTo", "rPrChange"].includes(child.localName ?? "")) out.removeChild(child);
  }
  return childElements(out).length ? out : null;
}

/** First run with visible text in a paragraph or cell. */
function firstTextRun(container: XmlElement): XmlElement | null {
  for (const t of descendantsW(container, "t")) {
    if ((t.textContent ?? "").trim()) return ancestorW(t, "r");
  }
  return null;
}

/** Remove placeholder styling (content-control placeholder style, its grey colour and field shading). */
function withoutPlaceholderStyle(rPr: XmlElement | null): XmlElement | null {
  if (!rPr) return null;
  const out = cloneEl(rPr);
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
  const props = rPr ? cloneEl(rPr) : wEl(dom, "rPr");
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

function clearParagraph(p: XmlElement): void {
  for (const child of childElements(p)) if (!isW(child, "pPr")) p.removeChild(child);
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
    p.insertBefore(pPr, p.firstChild);
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
      clearParagraph(target);
    } else {
      const template = space.length ? firstW(space[space.length - 1], "pPr") : pPr;
      target = newParagraph(ctx, template ? (isW(template, "pPr") ? template : null) : null);
      const ref = last ?? after;
      if (ref) insertAfter(target, ref);
      else if (container) container.appendChild(target);
      else return;
    }
    clampRightIndentInCell(ctx, firstW(target, "pPr"), target);
    for (const run of answerRuns(ctx, field, lines, rPr, kind, i === paras.length - 1)) target.appendChild(run);
    if (i < paras.length - 1) ensureSpaceAfter(ctx, target, 100);
    last = target;
  });
  for (const extra of space.slice(paras.length)) if (isFillLine(extra)) remove(extra);
  return last;
}

/** Contiguous answer-space paragraphs after `p` (blank or dotted lines), stopping at anything else. */
function followingSpace(p: XmlElement, limit = 12): XmlElement[] {
  const out: XmlElement[] = [];
  for (let n = p.nextSibling; n && out.length < limit; n = n.nextSibling) {
    if (!isElement(n)) continue;
    if (isW(n, "bookmarkStart") || isW(n, "bookmarkEnd") || isW(n, "proofErr")) continue;
    if (!isW(n, "p") || firstW(firstW(n, "pPr"), "sectPr") || !isAnswerSpaceParagraph(n)) break;
    out.push(n);
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Text replacement inside a paragraph (across runs)
 * ----------------------------------------------------------------------------------------------*/

const CONTENT_CHILDREN_SKIP = new Set(["rPr"]);

/** Split runs that hold several content children into one run per child (same formatting). */
function normaliseRuns(p: XmlElement): void {
  for (const run of descendantsW(p, "r")) {
    const content = childElements(run).filter((c) => !CONTENT_CHILDREN_SKIP.has(c.localName ?? ""));
    if (content.length < 2) continue;
    const rPr = firstW(run, "rPr");
    for (const child of content.slice(1).reverse()) {
      const clone = run.ownerDocument!.createElementNS(run.namespaceURI, run.nodeName) as XmlElement;
      if (isWritten(run)) WRITTEN.add(clone);
      if (rPr) clone.appendChild(cloneEl(rPr));
      clone.appendChild(child);
      insertAfter(clone, run);
    }
  }
}

function setText(t: XmlElement, text: string): void {
  while (t.firstChild) t.removeChild(t.firstChild);
  t.appendChild(t.ownerDocument!.createTextNode(text));
  t.setAttributeNS(XML_NS, "xml:space", "preserve");
}

/** Split a single-text run at `offset`: the run keeps text[offset:], a clone before it gets text[:offset]. */
function splitRunBefore(run: XmlElement, t: XmlElement, offset: number): void {
  const text = t.textContent ?? "";
  if (offset <= 0 || offset >= text.length) return;
  const before = cloneEl(run);
  if (isWritten(run)) WRITTEN.add(before);
  const bt = firstW(before, "t");
  if (bt) setText(bt, text.slice(0, offset));
  run.parentNode?.insertBefore(before, run);
  setText(t, text.slice(offset));
}

/** Split a single-text run at `offset`: the run keeps text[:offset], a clone after it gets text[offset:]. */
function splitRunAfter(run: XmlElement, t: XmlElement, offset: number): void {
  const text = t.textContent ?? "";
  if (offset <= 0 || offset >= text.length) return;
  const after = cloneEl(run);
  if (isWritten(run)) WRITTEN.add(after);
  const at = firstW(after, "t");
  if (at) setText(at, text.slice(offset));
  insertAfter(after, run);
  setText(t, text.slice(0, offset));
}

/**
 * Replace the visible text [start, end) of a paragraph with new runs (end = start inserts). Returns the
 * run properties of the replaced text (for styling the answer) or null when the range could not be
 * addressed.
 */
function replaceRange(p: XmlElement, start: number, end: number, makeRuns: (styleRPr: XmlElement | null) => XmlElement[]): boolean {
  normaliseRuns(p);
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
    if (s && s.seg.kind === "text" && s.seg.run && s.offset > 0) splitRunBefore(s.seg.run, s.seg.el, s.offset);
    segs = paragraphSegments(p);
    const e = locate(end);
    if (e && e.seg.kind === "text" && e.seg.run && e.offset > 0) splitRunAfter(e.seg.run, e.seg.el, e.offset);
    segs = paragraphSegments(p);
    const inRange: XmlElement[] = [];
    let acc = 0;
    for (const seg of segs) {
      const segStart = acc;
      acc += seg.text.length;
      if (segStart >= start && acc <= end && seg.run && seg.text.length > 0) {
        if (!inRange.includes(seg.run)) inRange.push(seg.run);
      }
    }
    if (inRange.length === 0) return false;
    const first = inRange[0];
    const styleRPr = firstW(first, "rPr");
    const runs = makeRuns(styleRPr ? cloneEl(styleRPr) : null);
    for (const run of runs) first.parentNode?.insertBefore(run, first);
    for (const run of inRange) remove(run);
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
      splitRunAfter(seg.run, seg.el, start - (acc - seg.text.length));
      anchor = seg.run;
      break;
    }
  }
  const styleRPr = anchor ? firstW(anchor, "rPr") : null;
  const runs = makeRuns(styleRPr ? cloneEl(styleRPr) : null);
  if (anchor) {
    let ref = anchor;
    for (const run of runs) {
      insertAfter(run, ref);
      ref = run;
    }
  } else {
    const firstRun = descendantsW(p, "r")[0];
    for (const run of runs) {
      if (firstRun) firstRun.parentNode?.insertBefore(run, firstRun);
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

function labelCellRPr(ref: BlockRef): XmlElement | null {
  return typographyOf(labelCellRunRPr(ref));
}

/** Run properties of the first text in the cell before an answer cell (its label), as printed. */
function labelCellRunRPr(ref: BlockRef): XmlElement | null {
  if (ref.kind !== "cell") return null;
  let prev = ref.el.previousSibling;
  while (prev && !isW(prev, "tc")) prev = prev.previousSibling;
  if (!prev || !isElement(prev)) return null;
  return firstW(firstTextRun(prev), "rPr");
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
    if (isAnswerSpaceParagraph(ref.el)) space = [ref.el, ...followingSpace(ref.el)];
    else {
      after = ref.el;
      space = followingSpace(ref.el);
    }
  }
  const rPr = completeTypography(ctx, markRPr(space[0] ?? null) ?? labelCellRPr(ref) ?? typographyOf(firstW(firstTextRun(ref.el), "rPr")), [
    ...spaceRunRPrs(ref.kind === "cell" ? ref.paragraphs : [ref.el, ...space]),
    labelCellRunRPr(ref),
    firstW(firstTextRun(ref.el), "rPr"),
    markRPr(after),
  ]);
  const pPr = space.length ? null : answerPPr(ctx, after);
  const written = writeIntoSpace(ctx, field, paras, space, after, container, pPr, rPr, kind);
  if (!written) ctx.warn(`${where(field)}: the answer box could not be written.`);
}

/**
 * Fix round 2 (B1-8): run properties of the text around a paragraph inside a table cell – the cell's label first, then
 * the other cells of its row – for the colour an uncoloured instruction paragraph does not give ("Please give clinical
 * details in this box" under JJ Physio's navy "Clinical Impression:"). Empty outside a table.
 */
function cellContextRPrs(p: XmlElement): XmlElement[] {
  const tc = ancestorW(p, "tc");
  if (!tc) return [];
  const tr = ancestorW(tc, "tr");
  const cells = tr ? childElements(tr).filter((c) => isW(c, "tc")) : [tc];
  return [tc, ...cells.filter((c) => c !== tc)].map((c) => firstW(firstTextRun(c), "rPr")).filter((r): r is XmlElement => r !== null);
}

function fillAfterParagraph(ctx: Ctx, job: Job, text: string, kind: RunKind): void {
  const { field, ref } = job;
  if (ref.kind === "cell") {
    fillTableCell(ctx, job, text, kind);
    return;
  }
  const p = ref.el;
  const space = followingSpace(p);
  // The answer space's own formatting first; otherwise only the question's font family (not its size:
  // questions are often headings or small grey instructions).
  const rPr = completeTypography(ctx, markRPr(space[0] ?? null) ?? typographyOf(firstW(firstTextRun(space[0] ?? p), "rPr"), space[0] ? undefined : ["rFonts"]), [
    ...spaceRunRPrs([p, ...space]),
    markRPr(p),
    firstW(firstTextRun(p), "rPr"),
    ...cellContextRPrs(p),
  ]);
  const written = writeIntoSpace(ctx, field, toParagraphs(text), space, p, null, answerPPr(ctx, p), rPr, kind);
  if (!written) ctx.warn(`${where(field)}: the answer could not be added after the question.`);
}

interface Occurrence {
  p: XmlElement;
  index: number;
  length: number;
  text: string;
}

/** Maximal runs of fill characters ("____", "......", ". . . .", "……") in a text. */
const FILL_RUN_RE = /[_.…](?:[_.…]|[ \u00A0](?=[_.…]))*/g;

/**
 * Occurrences of `needle` in the block's paragraphs, in order. For a blank made of fill characters the
 * whole blank is the occurrence, and blanks of exactly the needle's length are preferred (so "____" of
 * 16 never lands inside a longer blank of 36 left empty by an unanswered question).
 */
function occurrences(paras: XmlElement[], needle: string): Occurrence[] {
  if (!needle) return [];
  const fillNeedle = /^[_.…\s\u00A0]+$/.test(needle);
  if (!fillNeedle) {
    const out: Occurrence[] = [];
    for (const p of paras) {
      const text = segmentsText(paragraphSegments(p));
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
    const text = segmentsText(paragraphSegments(p));
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
  const anchor = field.anchor.kind === "docx" ? field.anchor : null;
  const paras = blockParagraphs(ref);
  let needle = anchor?.placeholderText ?? "";
  let occ = needle ? occurrences(paras, needle) : [];
  // 10/2026 verify: the blank was printed inside an option a "delete as necessary" answer removed (a "Max lift … kg"
  // restriction deleted, its "…" answered): the answer belongs to the deleted option, so it is not printed anywhere else.
  if (occ.length === 0 && paras.some((p) => ctx.deletedParas.has(p))) {
    if (!skip) ctx.warn(`${where(field)}: “${needle}” was deleted with the printed option it belongs to, so this answer is not printed.`);
    return;
  }
  if (occ.length === 0) {
    // The exact text is not there: fall back to the block's detected blanks.
    const detected = paras.flatMap((p) => findPlaceholders(segmentsText(paragraphSegments(p))).map((m) => ({ p, ...m })));
    if (detected.length > 0) {
      if (!skip) ctx.warn(`${where(field)}: the placeholder “${needle || "(none given)"}” was not found exactly; the first blank in that place was used.`);
      needle = "\u0000detected";
      occ = detected.map((d) => ({ p: d.p, index: d.index, length: d.text.length, text: d.text }));
    } else {
      if (skip) return;
      ctx.warn(`${where(field)}: no placeholder was found; the answer was added after the question instead.`);
      fillAfterParagraph(ctx, { ...job, ref: { kind: "paragraph", id: ref.id, el: paras[paras.length - 1], inSdt: false } }, text, kind);
      return;
    }
  }
  const k = skipKey(ctx, ref.el, needle);
  if (skip) {
    addSkip(ctx, ref.el, needle);
    return;
  }
  const target = occ[Math.min(k, occ.length - 1)];
  if (k >= occ.length) ctx.warn(`${where(field)}: more answers than blanks of “${anchor?.placeholderText ?? ""}” in that place; the last blank was used.`);
  const p = target.p;
  const fullText = segmentsText(paragraphSegments(p));
  const paraList = toParagraphs(text);
  // A bare "Answer:" label, or (10/2026) a printed label the map says to write after: the answer goes after it.
  const label = isBareLabel(target.text) || Boolean(anchor?.writeAfter);
  const before = fullText[target.index - 1] ?? "";
  const afterText = fullText.slice(target.index + target.length);
  const atLineEnd = afterText.trim() === "";
  const inline = atLineEnd ? paraList[0] : [paraList.map((l) => l.join(" ")).join(" ")];
  const rest = atLineEnd ? paraList.slice(1) : [];

  const ok = replaceRange(
    p,
    label ? target.index + target.length : target.index,
    label ? target.index + target.length : target.index + target.length,
    (styleRPr) => {
      // Written after a printed label (writeAfter, or a bare "Answer:" on a converted RTF form): not in the label's bold.
      const afterLabel = Boolean(anchor?.writeAfter) || (label && ctx.rtf);
      const plain = withoutPlaceholderStyle(styleRPr);
      const rPr = afterLabel ? completeTypography(ctx, withoutEmphasis(plain), [plain]) : plain;
      const lines = inline.slice();
      const needsSpace = label || (before !== "" && !/[\s(]/.test(before));
      if (needsSpace) lines[0] = ` ${lines[0]}`;
      if (!atLineEnd && /^[A-Za-z0-9]/.test(afterText)) lines[lines.length - 1] = `${lines[lines.length - 1]} `;
      return answerRuns(ctx, field, lines, rPr, kind, rest.length === 0);
    },
  );
  if (!ok) {
    ctx.warn(`${where(field)}: the placeholder could not be replaced; the answer was added after it.`);
    fillAfterParagraph(ctx, { ...job, ref: { kind: "paragraph", id: ref.id, el: p, inSdt: false } }, text, kind);
    return;
  }
  // An "Answer: ____" line: dotted continuation lines below are answer space for the rest of the answer.
  if (atLineEnd) {
    const space = followingSpace(p).filter((x, i, all) => all.slice(0, i + 1).every(isFillLine));
    const rPr = withoutPlaceholderStyle(firstW(firstTextRun(p), "rPr"));
    // Every paragraph of a long answer in the same typography as its first (fix round 1, B0-13: its colour too).
    if (rest.length > 0 || space.length > 0) writeIntoSpace(ctx, field, rest, space, p, null, answerPPr(ctx, p), completeTypography(ctx, typographyOf(rPr), [rPr]), kind);
  }
}

/**
 * Removes the field's exact placeholder from its block (the occurrence a filled answer would have taken), for an
 * answer the record leaves empty on purpose. Nothing happens when the exact text is not there.
 */
function clearPlaceholder(ctx: Ctx, job: Job): void {
  const { field, ref } = job;
  const needle = field.anchor.kind === "docx" ? (field.anchor.placeholderText ?? "") : "";
  if (!needle) return;
  const occ = occurrences(blockParagraphs(ref), needle);
  if (occ.length === 0) {
    ctx.warn(`${where(field)}: the placeholder “${needle}” was not found, so nothing was removed.`);
    return;
  }
  const k = skipKey(ctx, ref.el, needle);
  const target = occ[Math.min(k, occ.length - 1)];
  if (!replaceRange(target.p, target.index, target.index + target.length, () => [])) {
    ctx.warn(`${where(field)}: the placeholder “${needle}” could not be removed.`);
    return;
  }
  // Fix round 1 (B0-32): a line left empty (an address line the record does not have) goes too – a cell keeps its last
  // line, and a line that keeps two tables apart stays (removeIfBlank).
  removeIfBlank(target.p);
}

/** Content controls of a block: inside its paragraphs/cell, or the block-level control around it. */
function controlsOf(ref: BlockRef): XmlElement[] {
  const inside = descendantsW(ref.el, "sdt");
  const around = ancestorW(ref.el, "sdt");
  return around && !inside.includes(around) ? [around, ...inside] : inside;
}

function isCheckboxControl(sdt: XmlElement): boolean {
  const pr = firstW(sdt, "sdtPr");
  return !!pr && childElements(pr).some((c) => c.localName === "checkbox" && c.namespaceURI === W14_NS);
}

function fillContentControl(ctx: Ctx, job: Job, text: string, kind: RunKind, skip: boolean, isoDate: string | null): void {
  const { field, ref } = job;
  const anchor = field.anchor.kind === "docx" ? field.anchor : null;
  const candidates = controlsOf(ref).filter((s) => !isCheckboxControl(s));
  let sdt: XmlElement | undefined;
  const want = anchor?.placeholderText?.trim().toLowerCase();
  if (want) {
    sdt = candidates.find((s) => {
      const pr = firstW(s, "sdtPr");
      const tag = (wAttr(firstW(pr, "tag"), "val") ?? "").toLowerCase();
      const alias = (wAttr(firstW(pr, "alias"), "val") ?? "").toLowerCase();
      return !ctx.usedControls.has(s) && (tag === want || alias === want);
    });
  }
  sdt ??= candidates.find((s) => !ctx.usedControls.has(s));
  if (!sdt) {
    if (skip) return;
    ctx.warn(`${where(field)}: no free content control was found there; the answer was written into the box instead.`);
    fillTableCell(ctx, job, text, kind);
    return;
  }
  ctx.usedControls.add(sdt);
  if (skip) return;
  const pr = firstW(sdt, "sdtPr");
  const content = firstW(sdt, "sdtContent");
  if (!content) {
    ctx.warn(`${where(field)}: the content control is empty and could not be filled.`);
    return;
  }
  const plc = firstW(pr, "showingPlcHdr");
  if (plc && pr) pr.removeChild(plc);
  const date = firstW(pr, "date");
  if (date && isoDate) setWAttr(ctx.dom, date, "fullDate", `${isoDate}T00:00:00Z`);
  const firstRun = descendantsW(content, "r")[0] ?? null;
  const rPr = withoutPlaceholderStyle(firstW(pr, "rPr")) ?? withoutPlaceholderStyle(firstW(firstRun, "rPr"));
  const paras = toParagraphs(text);
  const blockParas = wChildren(content, "p");
  if (blockParas.length > 0) {
    writeIntoSpace(ctx, field, paras, [blockParas[0]], null, content, null, rPr, kind);
    return;
  }
  for (const child of childElements(content)) content.removeChild(child);
  const lines: string[] = [];
  paras.forEach((p, i) => {
    if (i > 0) lines.push("");
    lines.push(...p);
  });
  for (const run of answerRuns(ctx, field, lines, rPr, kind, true)) content.appendChild(run);
}

function legacyFields(ref: BlockRef, type: "textInput" | "checkBox"): XmlElement[] {
  return descendantsW(ref.el, "fldChar").filter((f) => wAttr(f, "fldCharType") === "begin" && !!firstW(firstW(f, "ffData"), type));
}

function fillLegacyField(ctx: Ctx, job: Job, text: string, kind: RunKind, skip: boolean): void {
  const { field, ref } = job;
  const anchor = field.anchor.kind === "docx" ? field.anchor : null;
  const begins = legacyFields(ref, "textInput");
  const want = anchor?.placeholderText?.trim();
  let begin = want ? begins.find((b) => !ctx.usedLegacy.has(b) && wAttr(firstW(firstW(b, "ffData"), "name"), "val") === want) : undefined;
  begin ??= begins.find((b) => !ctx.usedLegacy.has(b));
  if (!begin) {
    if (skip) return;
    ctx.warn(`${where(field)}: no free Word form field was found there; the answer was written into the box instead.`);
    fillTableCell(ctx, job, text, kind);
    return;
  }
  ctx.usedLegacy.add(begin);
  if (skip) return;
  const beginRun = ancestorW(begin, "r");
  const p = ancestorW(begin, "p");
  if (!beginRun || !p) return;
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
  if (!endRun) {
    ctx.warn(`${where(field)}: the Word form field is incomplete and could not be filled.`);
    return;
  }
  const rPr = firstW(result[0] ?? sepRun ?? beginRun, "rPr");
  const lines = toParagraphs(text).flatMap((l, i) => (i > 0 ? ["", ...l] : l));
  const newRuns = answerRuns(ctx, field, lines, rPr ? cloneEl(rPr) : null, kind, true);
  if (!sepRun) {
    sepRun = wEl(ctx.dom, "r");
    sepRun.appendChild(wEl(ctx.dom, "fldChar", { fldCharType: "separate" }));
    endRun.parentNode?.insertBefore(sepRun, endRun);
  }
  for (const run of result) remove(run);
  let at = sepRun;
  for (const run of newRuns) {
    insertAfter(run, at);
    at = run;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Tick boxes
 * ----------------------------------------------------------------------------------------------*/

interface GlyphTarget {
  option: string;
  slot: GlyphSlot | null;
}

function resolveGlyphs(ctx: Ctx, field: FormField): GlyphTarget[] {
  const anchor = field.anchor.kind === "docx" ? field.anchor : null;
  return (anchor?.optionGlyphs ?? []).map((g) => {
    const ref = ctx.index.byId.get(g.blockId);
    if (!ref) return { option: g.option, slot: null };
    const slots = blockParagraphs(ref).flatMap((p) => glyphSlots(paragraphSegments(p)));
    return { option: g.option, slot: slots[g.glyphIndex] ?? null };
  });
}

/** Which options to tick for an answer (null = unanswered: leave the boxes as they are). */
function chosenOptions(field: FormField, answer: FormFillAnswer, options: string[]): Set<string> | null {
  const value = answer.value;
  const text = (answer.text ?? "").trim();
  // "Yes…" / "No…", or a printed "Y" / "N" pair (10/2026).
  const yes = yesNoOption(options, true) ?? undefined;
  const no = yesNoOption(options, false) ?? undefined;
  if (typeof value === "boolean") {
    if (options.length === 1) return new Set(value ? options : []);
    const pick = value ? yes : no;
    return pick ? new Set([pick]) : new Set();
  }
  const raw = typeof value === "string" && value.trim() ? value : text;
  if (!raw) return null;
  // "Not recorded", "Unknown"… : leave every box as it is (never a definite "No").
  if (isUnknownAnswer(raw, options)) return null;
  if (field.answerType === "yes_no" || field.answerType === "checkbox") {
    if (/^(yes|true|ticked|checked)\b/i.test(raw)) return new Set(options.length === 1 ? options : yes ? [yes] : []);
    if (/^(no|false)\b/i.test(raw)) return new Set(no ? [no] : []);
  }
  const match = matchOption(options, raw);
  return match ? new Set([match]) : new Set();
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
  if (targets.length === 0) {
    ctx.warn(`${where(field)}: no tick boxes are linked to this question.`);
    return;
  }
  if (answer.leftBlank) {
    // Fix round 1 (B0-2): left blank – a box printed ticked is cleared; unticked boxes stay exactly as printed.
    for (const target of targets) if (target.slot?.checked) setGlyph(ctx, target.slot, false);
    return;
  }
  const chosen = chosenOptions(field, answer, targets.map((t) => t.option));
  if (chosen === null) return;
  if (chosen.size === 0 && (answer.text || answer.value !== undefined)) {
    ctx.warn(`${where(field)}: the answer “${answer.text ?? String(answer.value)}” does not match any tick box, so none was ticked.`);
  }
  for (const target of targets) {
    if (!target.slot) {
      ctx.warn(`${where(field)}: the tick box for “${target.option}” was not found.`);
      continue;
    }
    setGlyph(ctx, target.slot, chosen.has(target.option));
  }
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

function writeMark(ctx: Ctx, ref: BlockRef, mark: string, field: FormField): void {
  const paras = markParagraphs(ref);
  if (paras.length === 0) {
    ctx.warn(`${where(field)}: the cell to mark has no line to write in.`);
    return;
  }
  const texts = paras.map((p) => segmentsText(paragraphSegments(p)));
  const markOnly = texts.findIndex((t) => MARK_ONLY_RE.test(t));
  const rPr = markRPr(paras[0]) ?? labelCellRPr(ref) ?? typographyOf(firstW(firstTextRun(ref.el), "rPr"));
  if (markOnly >= 0 && texts.every((t, i) => i === markOnly || t.trim() === "")) {
    // A mark is printed there already (a default): written again in the form's own place.
    const p = paras[markOnly];
    const at = texts[markOnly].search(/\S/);
    replaceRange(p, at, at + 1, (styleRPr) => [markRun(ctx, mark, styleRPr ?? rPr)]);
    return;
  }
  if (paras.every(isAnswerSpaceParagraph)) {
    const p = paras[0];
    clearParagraph(p);
    p.appendChild(markRun(ctx, mark, rPr));
    return;
  }
  // The cell prints the option itself ("70%", "Yes"): the mark goes after it.
  let last = paras.length - 1;
  while (last > 0 && texts[last].trim() === "") last -= 1;
  const p = paras[last];
  const end = texts[last].replace(/[\s\u00A0]+$/, "").length;
  replaceRange(p, end, end, (styleRPr) => [makeRun(ctx, [" "], styleRPr ?? rPr, "answer"), markRun(ctx, mark, styleRPr ?? rPr)]);
}

/** A cell that holds only a mark is cleared (never a mark left in the wrong column). */
function clearMark(ref: BlockRef): void {
  const paras = markParagraphs(ref);
  const texts = paras.map((p) => segmentsText(paragraphSegments(p)));
  const markOnly = texts.findIndex((t) => MARK_ONLY_RE.test(t));
  if (markOnly < 0 || !texts.every((t, i) => i === markOnly || t.trim() === "")) return;
  const at = texts[markOnly].search(/\S/);
  replaceRange(paras[markOnly], at, at + 1, () => []);
}

function fillMarkCells(ctx: Ctx, field: FormField, answer: FormFillAnswer, targets: MarkTarget[]): void {
  if (targets.length === 0) {
    ctx.warn(`${where(field)}: no cells to mark are linked to this question.`);
    return;
  }
  const options = targets.map((t) => t.option);
  if (answer.leftBlank) {
    // Fix round 1 (B0-2): left blank – a mark printed as a default ("x") is cleared, never left as an answer.
    for (const target of targets) if (target.ref) clearMark(target.ref);
    return;
  }
  let chosen: Set<string> | null;
  if (field.answerType === "short_text" || field.answerType === "long_text") {
    // "Tick all that apply": a text answer names the options to mark ("Neck, Back"). Anything else in it marks nothing.
    const raw = (answer.text ?? "").trim();
    if (!raw) return;
    const named = namedOptions(options, raw);
    if (named.unmatched) {
      ctx.warn(`${where(field)}: “${named.unmatched}” is not one of the printed columns, so no cell was marked.`);
      return;
    }
    chosen = new Set(named.matched);
  } else {
    chosen = chosenOptions(field, answer, options);
  }
  if (chosen === null) return;
  const unticked = options.length === 1 && (answer.value === false || /^(?:no|false)\b/i.test((answer.text ?? "").trim()));
  if (chosen.size === 0 && !unticked && field.answerType !== "short_text" && field.answerType !== "long_text" && (answer.text || answer.value !== undefined)) {
    ctx.warn(`${where(field)}: the answer “${answer.text ?? String(answer.value)}” does not match any column, so no cell was marked.`);
  }
  const anchor = field.anchor.kind === "docx" ? field.anchor : null;
  const mark = cleanXmlText(anchor?.mark ?? "X").trim() || "X"; // no control characters (security fix 24/10/2026)
  for (const target of targets) {
    if (!target.ref) {
      ctx.warn(`${where(field)}: the cell for “${target.option}” was not found.`);
      continue;
    }
    if (chosen.has(target.option)) writeMark(ctx, target.ref, mark, field);
    else clearMark(target.ref);
  }
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

function removeIfBlank(p: XmlElement): void {
  if (segmentsText(paragraphSegments(p)).trim() !== "") return;
  if (descendantsW(p, "drawing").length > 0 || descendantsW(p, "pict").length > 0) return; // a picture (a logo) stays
  const cell = ancestorW(p, "tc");
  if (cell && wChildren(cell, "p").length <= 1) return; // a cell keeps its last paragraph
  if (firstW(firstW(p, "pPr"), "sectPr")) return;
  if (keepsTableApart(p)) return;
  remove(p);
}

/** `removeAll` (fix round 1, B0-2): the question was left blank – every printed option is removed, none kept. */
function fillDeleteOptions(ctx: Ctx, job: Job, unanswered: boolean, removeAll = false): void {
  const { field, ref, answer } = job;
  const anchor = field.anchor.kind === "docx" ? field.anchor : null;
  if (!anchor) return;
  const lines = anchor.placeholderText ? [] : (anchor.optionTexts ?? []);
  const options = field.options?.length ? field.options : lines.map((o) => o.option);
  const list = anchor.placeholderText ?? "";
  const paras = blockParagraphs(ref);
  if (list) {
    const occ = occurrences(paras, list);
    const k = skipKey(ctx, ref.el, list);
    if (occ.length === 0) {
      if (!unanswered) ctx.warn(`${where(field)}: the options “${list}” were not found, so nothing was deleted.`);
      return;
    }
    const chosen = removeAll ? new Set<string>() : unanswered ? null : chosenOptions(field, answer, options);
    const target = occ[Math.min(k, occ.length - 1)];
    // A single printed item ("delete any that do not apply"): kept when ticked, removed when not – and the whole list
    // when the question is left blank.
    if (chosen && (options.length === 1 || removeAll)) {
      let settled = true;
      if (chosen.size === 0 && !replaceRange(target.p, target.index, target.index + target.length, () => [])) {
        ctx.warn(`${where(field)}: “${list}” could not be removed.`);
        settled = false;
      }
      if (chosen.size === 0) {
        ctx.deletedParas.add(target.p);
        removeIfBlank(target.p);
      }
      else addSkip(ctx, ref.el, list);
      if (settled) ctx.chosenLists.add(field);
      return;
    }
    if (chosen === null || chosen.size !== 1) {
      if (chosen && chosen.size === 0) ctx.warn(`${where(field)}: the answer “${answer.text ?? String(answer.value)}” is not one of “${list}”, so every option was left as printed.`);
      addSkip(ctx, ref.el, list);
      return;
    }
    const keep = Array.from(chosen)[0];
    const printed = target.text;
    const at = findWord(printed, keep);
    const kept = cleanXmlText(at >= 0 ? printed.slice(at, at + keep.trim().length) : keep); // no control characters (24/10)
    ctx.deletedParas.add(target.p);
    if (!replaceRange(target.p, target.index, target.index + target.length, (styleRPr) => [makeRun(ctx, [kept], styleRPr, "answer")])) {
      ctx.warn(`${where(field)}: the options “${list}” could not be changed, so every option was left as printed.`);
    } else ctx.chosenLists.add(field);
    return;
  }
  // One option per line (or a single printed item kept when ticked).
  const chosen = removeAll ? new Set<string>() : unanswered ? null : chosenOptions(field, answer, options);
  if (chosen === null) return;
  if (chosen.size === 0 && options.length > 1 && !removeAll) {
    ctx.warn(`${where(field)}: the answer “${answer.text ?? String(answer.value)}” does not match any printed option, so every option was left as printed.`);
    return;
  }
  // Locate every option on the untouched lines first, then remove the others from the end backwards.
  const located: Array<{ option: string; p: XmlElement; index: number; length: number }> = [];
  // Positions already taken, per paragraph (security fix 24/10/2026: a Set, not a scan of `located` per option).
  const taken = new Map<XmlElement, Set<number>>();
  for (const o of lines) {
    const block = ctx.index.byId.get(o.blockId);
    if (!block) {
      ctx.warn(`${where(field)}: the line for “${o.option}” was not found, so every option was left as printed.`);
      return;
    }
    let hit: { p: XmlElement; index: number } | null = null;
    for (const p of blockParagraphs(block)) {
      const text = segmentsText(paragraphSegments(p));
      const i = text.indexOf(o.text);
      if (i >= 0 && !taken.get(p)?.has(i)) {
        hit = { p, index: i };
        break;
      }
    }
    if (!hit) {
      ctx.warn(`${where(field)}: “${o.text}” was not found, so every option was left as printed.`);
      return;
    }
    located.push({ option: o.option, p: hit.p, index: hit.index, length: o.text.length });
    const set = taken.get(hit.p) ?? new Set<number>();
    set.add(hit.index);
    taken.set(hit.p, set);
  }
  // Removed per paragraph from the END backwards, so an earlier removal never shifts a later one (security fix
  // 24/10/2026: one sort over all paragraphs with "0 when the paragraphs differ" is not a consistent comparator, and
  // options interleaved over two paragraphs could delete the wrong characters).
  const drop = located.filter((l) => !chosen.has(l.option));
  const byParagraph = new Map<XmlElement, typeof drop>();
  for (const l of drop) byParagraph.set(l.p, [...(byParagraph.get(l.p) ?? []), l]);
  let settled = true;
  byParagraph.forEach((items, para) => {
    for (const l of items.sort((a, b) => b.index - a.index)) {
      ctx.deletedParas.add(para);
      if (!replaceRange(para, l.index, l.index + l.length, () => [])) {
        ctx.warn(`${where(field)}: “${l.option}” could not be removed.`);
        settled = false;
      }
    }
  });
  byParagraph.forEach((_, para) => removeIfBlank(para));
  if (settled) ctx.chosenLists.add(field);
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
function planInstructions(dom: DocxDom, lists: ListsByElement): InstructionPlan | null {
  const plan: InstructionPlan = { rows: [], lists: new Map() };
  const claimed = new Set<XmlElement>();
  let count = 0;
  for (const p of descendantsW(dom.body, "p")) {
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
    for (const f of off.slice().reverse()) if (replaceRange(p, f.start, f.end, () => [])) removed.unshift(f);
    if (removed.length === 0) continue;
    found.push(...removed);
    const row = ancestorW(p, "tr");
    if (row) clearedRows.add(row);
    const parent = p.parentNode;
    if ((parent === ctx.dom.body || isW(parent, "tc")) && fewSiblings(p)) removeIfBlank(p);
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
      remove(tr);
      rowsLeftOff += 1;
      removedRows += 1;
    }
    if (repeat.ownRow && repeat.row.parentNode && unusedRow(repeat.row) && rowText(repeat.row)?.blank && hasOtherRow(repeat.row) && removedRows < MAX_ROWS_LEFT_OFF) {
      remove(repeat.row);
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

export function fillDocx(buf: Uint8Array, form: FormDefinition, answers: FormFillAnswers, opts: FillOptions): Buffer {
  const dom = loadDocxDom(buf);
  const index = indexBlocks(dom);
  const ctx: Ctx = {
    dom,
    index,
    opts,
    warn: (m) => opts.onWarning?.(m),
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
  for (const field of form.fields) {
    if (!isAnswerableField(field)) continue;
    const anchor = field.anchor;
    if (anchor.kind !== "docx") {
      ctx.warn(`${where(field)}: this question has a PDF position, so it cannot be written into a Word form.`);
      continue;
    }
    const answer = answers[field.id] ?? {};
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
      continue;
    }
    jobs.push({ field, answer, ref });
  }
  const instructions = planInstructions(dom, listsByElement(ctx, jobs));
  const answered = instructions?.rows.length ? answeredRows(ctx, form, answers) : new Set<XmlElement>();

  // 2. Tick boxes first: they only swap characters, so nothing else moves. Then the marked cells (each in its own cell).
  for (const g of glyphJobs) fillCheckboxes(ctx, g.field, g.answer, g.targets);
  flushGlyphEdits(ctx);
  for (const m of markJobs) fillMarkCells(ctx, m.field, m.answer, m.targets);

  // 3. Text answers, in form order – "delete as necessary" lists first (10/2026 verify), so a blank printed inside a
  //    deleted option is known to be gone, and one inside a kept option is filled whatever the questions' order.
  const isDelete = (j: Job) => j.field.anchor.kind === "docx" && j.field.anchor.target === "delete_options";
  for (const job of [...jobs.filter(isDelete), ...jobs.filter((j) => !isDelete(j))]) {
    const { field } = job;
    const anchor = field.anchor.kind === "docx" ? field.anchor : null;
    if (!anchor) continue;
    if (!job.ref.el.parentNode) {
      ctx.warn(`${where(field)}: its place on the form was used by another answer, so it was left blank.`);
      continue;
    }
    const text = answerText(field, job.answer);
    // 10/2026: an answer space the record leaves empty on purpose (an address line it does not have): the
    // placeholder (a clinic system's merge code) is removed, never left or marked.
    const blank = text === "" && job.answer.blank === true;
    if (blank) {
      if (anchor.target === "replace_placeholder" && !anchor.writeAfter) clearPlaceholder(ctx, job);
      continue;
    }
    // Fix round 1 (B0-2): a question a person left blank (or an approved report left without an answer) prints nothing
    // that reads as an answer: a "delete as necessary" list is removed, a printed default value ("30 minutes") too.
    // Blank lines and empty cells stay as printed, with no review marker (it is decided).
    if (text === "" && job.answer.leftBlank) {
      if (anchor.target === "delete_options") fillDeleteOptions(ctx, job, false, true);
      else if (anchor.target === "replace_placeholder" && !anchor.writeAfter && printsDefault(anchor.placeholderText)) clearPlaceholder(ctx, job);
      continue;
    }
    const unanswered = text === "";
    // 10/2026: printed text that must never go out (e.g. a named clinician's numbers in a template) is removed while
    // its question has no answer yet – the review copy's marker replaces it anyway.
    if (unanswered && anchor.target === "replace_placeholder" && anchor.clearPlaceholder && !anchor.writeAfter && !opts.reviewMarkers) {
      clearPlaceholder(ctx, job);
      continue;
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

  // 4. The form author's instructions for whoever completes it are left off (10/2026, core/template-instructions.ts).
  leaveOffInstructions(ctx, instructions, answered);

  if (opts.draft) insertDraftBanner(ctx);
  return saveDocxDom(dom);
}
