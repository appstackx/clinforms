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
 *
 * Answers come from core/forms.ts buildFormAnswers(report, form, {receipt}). Anchors are resolved on the
 * ORIGINAL document before anything changes, so every block ID means what the outline said. Text is
 * written through the DOM (XML-escaped) with invalid XML characters removed.
 *
 * DRAFT (opts.draft): a red "DRAFT – awaiting clinician approval" banner at the top of the body (a
 * bookmarked paragraph that the outline skips), sign-off fields blank (the caller passes no receipt).
 * reviewMarkers: answers highlighted and tagged "[F-07]"; unanswered questions get a grey marker.
 * FINAL: no banner, no markers. Never removes or reorders the referrer's own content (only the blank /
 * dotted answer lines an answer has used are replaced).
 *
 * Owner: forms-engine agent. Signature final.
 */
import { isAnswerableField, isUnknownAnswer, matchOption, type FormFillAnswer, type FormFillAnswers } from "../core/forms";
import type { FormDefinition, FormField } from "../core/types";
import {
  CHECKED_GLYPH,
  W_NS as W_NS_URI,
  DRAFT_BANNER_BOOKMARK,
  UNCHECKED_GLYPH,
  W14_NS,
  XML_NS,
  ancestorW,
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

/** Typography only (font, size, language) – used when copying from a label or question run. */
function typographyOf(rPr: XmlElement | null, keep: string[] = ["rFonts", "sz", "szCs", "lang"]): XmlElement | null {
  if (!rPr) return null;
  const out = cloneEl(rPr);
  for (const child of childElements(out)) {
    if (!keep.includes(child.localName ?? "")) out.removeChild(child);
  }
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
  const jc = firstW(src, "jc");
  if (jc && ["left", "start", "both"].includes(wAttr(jc, "val") ?? "")) out.appendChild(cloneEl(jc));
  return childElements(out).length ? out : null;
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
  if (ref.kind !== "cell") return null;
  let prev = ref.el.previousSibling;
  while (prev && !isW(prev, "tc")) prev = prev.previousSibling;
  if (!prev || !isElement(prev)) return null;
  const run = firstTextRun(prev);
  return typographyOf(firstW(run, "rPr"));
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
  const rPr = markRPr(space[0] ?? null) ?? labelCellRPr(ref) ?? typographyOf(firstW(firstTextRun(ref.el), "rPr"));
  const pPr = space.length ? null : answerPPr(ctx, after);
  const written = writeIntoSpace(ctx, field, paras, space, after, container, pPr, rPr, kind);
  if (!written) ctx.warn(`${where(field)}: the answer box could not be written.`);
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
  const rPr = markRPr(space[0] ?? null) ?? typographyOf(firstW(firstTextRun(space[0] ?? p), "rPr"), space[0] ? undefined : ["rFonts"]);
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
  const label = isBareLabel(target.text);
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
      const rPr = withoutPlaceholderStyle(styleRPr);
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
    if (rest.length > 0 || space.length > 0) writeIntoSpace(ctx, field, rest, space, p, null, answerPPr(ctx, p), typographyOf(rPr), kind);
  }
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
  const yes = options.find((o) => /^\s*yes\b/i.test(o));
  const no = options.find((o) => /^\s*no\b/i.test(o));
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
  if (seg.kind === "text") {
    const t = seg.el;
    const text = t.textContent ?? "";
    setText(t, text.slice(0, slot.offset) + glyph + text.slice(slot.offset + 1));
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

function fillCheckboxes(ctx: Ctx, field: FormField, answer: FormFillAnswer, targets: GlyphTarget[]): void {
  if (targets.length === 0) {
    ctx.warn(`${where(field)}: no tick boxes are linked to this question.`);
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
  };

  // 1. Resolve every anchor on the untouched document.
  const jobs: Job[] = [];
  const glyphJobs: { field: FormField; answer: FormFillAnswer; targets: GlyphTarget[] }[] = [];
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
    const ref = index.byId.get(anchor.blockId);
    if (!ref) {
      ctx.warn(`${where(field)}: its place on the form (${anchor.blockId}) was not found, so it was left blank. Check the form mapping.`);
      continue;
    }
    jobs.push({ field, answer, ref });
  }

  // 2. Tick boxes first: they only swap single characters, so nothing else moves.
  for (const g of glyphJobs) fillCheckboxes(ctx, g.field, g.answer, g.targets);

  // 3. Text answers, in form order.
  for (const job of jobs) {
    const { field } = job;
    const anchor = field.anchor.kind === "docx" ? field.anchor : null;
    if (!anchor) continue;
    if (!job.ref.el.parentNode) {
      ctx.warn(`${where(field)}: its place on the form was used by another answer, so it was left blank.`);
      continue;
    }
    const text = answerText(field, job.answer);
    const unanswered = text === "";
    const kind: RunKind = unanswered ? "unanswered" : "answer";
    const marker = field.fillSource.kind === "signoff" ? `[${field.id} – completed on approval]` : `[${field.id} – not answered yet]`;
    const skip = unanswered && !opts.reviewMarkers;
    const isoDate = typeof job.answer.value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(job.answer.value) ? job.answer.value : null;
    const value = unanswered ? marker : text;
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
  }

  if (opts.draft) insertDraftBanner(ctx);
  return saveDocxDom(dom);
}
