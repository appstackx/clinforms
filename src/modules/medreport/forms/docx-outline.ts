import "server-only";

/**
 * Word form → outline for the analysis (forms-analyse) and the mapping editor.
 *
 * buildDocxOutline(buf) reads word/document.xml (pizzip + @xmldom/xmldom) and returns every body
 * paragraph and table cell in document order as OutlineBlocks with STABLE block IDs
 * (core/forms.ts formatParagraphBlockId / formatCellBlockId: "p12", "t2.r3.c1", nested "t2.r3.c1.t0.r0.c0",
 * paragraph in a cell "t2.r3.c1.p0"; all 0-based). The same bytes always give the same IDs, which is why
 * a FormDefinition is bound to the file's SHA-256. The traversal is shared with the fill (docx-dom.ts
 * indexBlocks), so an ID always addresses the same element in both.
 *
 * Per block: text (runs joined, tabs as spaces), style / heading level, isEmpty, placeholders
 * ("[…]", "……", "____", "Answer:", "Click or tap here to enter text."), ☐/☒ glyph count (incl. symbol
 * boxes, w14:checkbox content controls and legacy check boxes), content controls (w:sdt) and legacy
 * FORMTEXT/FORMCHECKBOX field names. A cell's own paragraphs are listed as separate blocks after the cell
 * when it has more than one (question + answer space in one box).
 *
 * Owner: forms-engine agent. Signature final.
 */
import type { OutlineBlock } from "../core/types";
import {
  descendantsW,
  findPlaceholders,
  firstW,
  glyphSlots,
  indexBlocks,
  isW,
  loadDocxDom,
  paragraphSegments,
  segmentsText,
  wAttr,
  type BlockRef,
  type DocxDom,
  type Segment,
  type XmlElement,
} from "./docx-dom";

export interface DocxOutline {
  blocks: OutlineBlock[];
  /** Plain-English caveats, e.g. "Text boxes are not supported; 2 were ignored." */
  warnings: string[];
}

/** Longest text kept per block (long declarations are cut; the analysis only needs to recognise them). */
const MAX_BLOCK_TEXT = 1200;

function tidy(text: string): string {
  const t = text.replace(/[ \t ]+$/gm, "").replace(/\n{3,}/g, "\n\n").trimEnd();
  return t.length > MAX_BLOCK_TEXT ? `${t.slice(0, MAX_BLOCK_TEXT - 1)}…` : t;
}

interface ParagraphFacts {
  segs: Segment[];
  text: string;
  glyphs: number;
  placeholders: { index: number; text: string }[];
  sdts: XmlElement[];
  legacyNames: string[];
}

function paragraphFacts(p: XmlElement): ParagraphFacts {
  const segs = paragraphSegments(p);
  const text = segmentsText(segs);
  const legacyNames: string[] = [];
  for (const s of segs) {
    if (s.fieldBegin && s.legacyField !== undefined && !legacyNames.includes(s.legacyField)) legacyNames.push(s.legacyField);
    if (s.kind === "legacyCheck" && s.fieldBegin) {
      const name = wAttr(firstW(firstW(s.fieldBegin, "ffData"), "name"), "val") ?? "";
      if (!legacyNames.includes(name)) legacyNames.push(name);
    }
  }
  // Legacy FORMTEXT fields with only spaces as their result are fill-in spaces too.
  const placeholders = findPlaceholders(text);
  if (placeholders.length === 0 && segs.some((s) => s.legacyField !== undefined)) {
    const first = segs.find((s) => s.legacyField !== undefined);
    if (first) placeholders.push({ index: text.indexOf(first.text), text: `[form field: ${first.legacyField || "unnamed"}]` });
  }
  return { segs, text, glyphs: glyphSlots(segs).length, placeholders, sdts: descendantsW(p, "sdt"), legacyNames };
}

/** A style missing from styles.xml: "Heading2" → level 2, "Title" → no level. */
function styleFromId(id: string): { name: string; headingLevel?: number } {
  const m = /^Heading(\d)$/i.exec(id);
  return m ? { name: `Heading ${m[1]}`, headingLevel: Number(m[1]) } : { name: id };
}

function styleOf(dom: DocxDom, p: XmlElement): { style?: string; headingLevel?: number } {
  const pPr = firstW(p, "pPr");
  const styleId = wAttr(firstW(pPr, "pStyle"), "val");
  const info = styleId ? (dom.styles.get(styleId) ?? styleFromId(styleId)) : undefined;
  const direct = wAttr(firstW(pPr, "outlineLvl"), "val");
  const directLevel = direct !== null && /^\d$/.test(direct) && Number(direct) < 9 ? Number(direct) + 1 : undefined;
  const headingLevel = directLevel ?? info?.headingLevel;
  return {
    ...(styleId && { style: info?.name ?? styleId }),
    ...(headingLevel !== undefined && { headingLevel }),
  };
}

function blockFromFacts(
  ref: BlockRef,
  facts: ParagraphFacts[],
  extra: Partial<OutlineBlock>,
  inContentControl: boolean,
): OutlineBlock {
  const text = tidy(facts.map((f) => f.text).join("\n"));
  const glyphs = facts.reduce((n, f) => n + f.glyphs, 0);
  const firstPlaceholder = facts.flatMap((f) => f.placeholders)[0];
  const sdts = facts.reduce((n, f) => n + f.sdts.length, 0);
  const legacy = facts.flatMap((f) => f.legacyNames)[0];
  return {
    id: ref.id,
    kind: ref.kind === "cell" ? "cell" : "paragraph",
    text,
    ...extra,
    isEmpty: text.trim() === "" && glyphs === 0 && sdts === 0,
    hasPlaceholder: firstPlaceholder !== undefined,
    ...(firstPlaceholder && { placeholderText: firstPlaceholder.text }),
    ...(glyphs > 0 && { checkboxGlyphs: glyphs }),
    ...((inContentControl || sdts > 0) && { inContentControl: true }),
    ...(legacy !== undefined && { legacyFieldName: legacy }),
  };
}

/** Outline of a Word form. Pure: same bytes → same blocks. Throws 422 FORM_INVALID for unreadable files. */
export function buildDocxOutline(buf: Uint8Array): DocxOutline {
  const dom = loadDocxDom(buf);
  const index = indexBlocks(dom);
  const warnings: string[] = [];
  const blocks: OutlineBlock[] = [];
  const factsCache = new Map<XmlElement, ParagraphFacts>();
  const facts = (p: XmlElement) => {
    let f = factsCache.get(p);
    if (!f) {
      f = paragraphFacts(p);
      factsCache.set(p, f);
    }
    return f;
  };

  for (const ref of index.blocks) {
    if (ref.kind === "cell") {
      const last = ref.path[ref.path.length - 1];
      blocks.push(blockFromFacts(ref, ref.paragraphs.map(facts), { table: { t: last.t, r: last.r, c: last.c } }, ref.inSdt));
      continue;
    }
    // A cell's paragraphs are listed only when the cell has several (question and answer space in one box).
    if (ref.cellPath) {
      const cell = index.byId.get(ref.id.replace(/\.p\d+$/, ""));
      if (!cell || cell.kind !== "cell" || cell.paragraphs.length < 2) continue;
      const last = ref.cellPath[ref.cellPath.length - 1];
      blocks.push(blockFromFacts(ref, [facts(ref.el)], { ...styleOf(dom, ref.el), table: { t: last.t, r: last.r, c: last.c } }, ref.inSdt));
      continue;
    }
    blocks.push(blockFromFacts(ref, [facts(ref.el)], styleOf(dom, ref.el), ref.inSdt));
  }

  if (index.textBoxes > 0) {
    warnings.push(
      `Text boxes are not supported: ${index.textBoxes} text box${index.textBoxes === 1 ? " was" : "es were"} ignored. Questions inside them cannot be completed automatically.`,
    );
  }
  const deleted = descendantsW(dom.body, "del").length;
  if (deleted > 0) warnings.push("The form contains tracked changes. Deleted text is ignored; accept or reject the changes in Word for the clearest result.");
  const legacy = blocks.filter((b) => b.legacyFieldName !== undefined).length;
  if (legacy > 0) warnings.push(`The form uses older Word form fields (${legacy} block${legacy === 1 ? "" : "s"}). They are filled in place; protected-form editing restrictions are kept.`);
  if (blocks.length === 0) warnings.push("No paragraphs or tables were found in the document body.");
  const nested = descendantsW(dom.body, "tbl").filter((t) => isW(t.parentNode, "tc")).length;
  if (nested > 0) warnings.push(`The form has ${nested} table${nested === 1 ? "" : "s"} inside other tables; check the mapping of those answer boxes.`);
  return { blocks, warnings };
}

/** Counts for the analysis summary (FormOutlineSummary): paragraphs, tables, controls and answer spaces. */
export function summariseDocxOutline(outline: DocxOutline): {
  paragraphs: number;
  tables: number;
  fillableFields: number;
  answerSpaces: number;
  headings: string[];
} {
  const paragraphs = outline.blocks.filter((b) => /^p\d+$/.test(b.id)).length;
  const tables = new Set(outline.blocks.filter((b) => b.kind === "cell").map((b) => b.id.split(".")[0])).size;
  const fillableFields = outline.blocks.filter((b) => b.inContentControl || b.legacyFieldName !== undefined).length;
  const answerSpaces = outline.blocks.filter((b) => (b.kind === "cell" && b.isEmpty) || b.hasPlaceholder || (b.checkboxGlyphs ?? 0) > 0).length;
  const headings = outline.blocks
    .filter((b) => b.headingLevel !== undefined && b.text.trim())
    .map((b) => b.text.trim())
    .slice(0, 40);
  return { paragraphs, tables, fillableFields, answerSpaces, headings };
}
