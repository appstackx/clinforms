import "server-only";

/**
 * The parsed referrer form as the analysis sees it: an index of answer spaces for the deterministic
 * checks (post-validation, rules mode), a compact text rendering for the prompt, the outline summary
 * shown to staff, and chunking for long forms.
 *
 * Inputs come from the forms engine: forms/docx-outline.ts buildDocxOutline() (Word) and
 * forms/pdf-outline.ts readPdfForm() (PDF). Pure functions of those outlines – no I/O.
 *
 * Owner: ai agent.
 */
import type { FormOutlineSummary } from "../api/contract";
import { parseBlockId } from "../core/forms";
import type { FormKind, OutlineBlock, PdfBox, PdfFormOutline, PdfOutlineField } from "../core/types";
import { findPlaceholders } from "../forms/docx-dom";
import { detectPdfFieldTables, type DetectedPdfTable } from "../forms/pdf-table";
import { charGroupsOf, detectOptionGroups, unionRect, type OptionGroup } from "./pdf-groups";
import { flatBoxQuestions, labelFor, renderPdfBoxes } from "./form-boxes";
import { pdfSectionAt, pdfSectionTitles } from "../forms/pdf-sections";
import { neutraliseTags } from "./prompts";

/** A parsed form, as handed to the analysis. */
export type ParsedForm =
  | { kind: "docx"; blocks: OutlineBlock[]; warnings: string[] }
  | { kind: "pdf_acroform" | "pdf_flat"; pdf: PdfFormOutline; warnings: string[] };

/* ------------------------------------------------------------------------------------------------
 * Word outlines
 * ----------------------------------------------------------------------------------------------*/

export interface DocxIndex {
  blocks: OutlineBlock[];
  byId: Map<string, OutlineBlock>;
  /** Document order of each block ID. */
  order: Map<string, number>;
  /** Cells that hold a question followed by blank lines for the answer (question-and-answer boxes). */
  qaBoxes: Set<string>;
}

export function indexDocx(blocks: OutlineBlock[]): DocxIndex {
  const byId = new Map<string, OutlineBlock>();
  const order = new Map<string, number>();
  blocks.forEach((b, i) => {
    byId.set(b.id, b);
    order.set(b.id, i);
  });
  const qaBoxes = new Set<string>();
  const seenText = new Set<string>();
  for (const b of blocks) {
    const cell = b.kind === "paragraph" ? cellOfParagraph(b.id) : null;
    if (!cell || !byId.has(cell)) continue;
    if (!b.isEmpty) seenText.add(cell);
    else if (seenText.has(cell)) qaBoxes.add(cell);
  }
  return { blocks, byId, order, qaBoxes };
}

/**
 * The outline block an anchor block ID refers to: the block itself, or – for a paragraph inside a
 * cell ("t0.r1.c1.p0") – its cell. Null when neither exists.
 */
export function resolveDocxBlock(index: DocxIndex, blockId: string): OutlineBlock | null {
  const direct = index.byId.get(blockId);
  if (direct) return direct;
  const parsed = parseBlockId(blockId);
  if (parsed?.kind === "cell" && parsed.p !== undefined) {
    const cellId = blockId.replace(/\.p\d+$/, "");
    return index.byId.get(cellId) ?? null;
  }
  return null;
}

/** Document position of an anchor block (cell paragraphs sort with their cell). */
export function docxOrder(index: DocxIndex, blockId: string): number {
  const block = resolveDocxBlock(index, blockId);
  return block ? (index.order.get(block.id) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
}

/** "t0.r3.c1" → "t0.r3" (the row); null for body paragraphs. */
export function rowKey(blockId: string): string | null {
  const m = /^(.*)\.c\d+$/.exec(blockId);
  return m ? m[1] : null;
}

/** Cell ID of the neighbouring cell in the same row ("t0.r3.c1" + 1 → "t0.r3.c2"). */
export function siblingCellId(blockId: string, delta: number): string | null {
  const m = /^(.*)\.c(\d+)$/.exec(blockId);
  if (!m) return null;
  const c = Number(m[2]) + delta;
  return c < 0 ? null : `${m[1]}.c${c}`;
}

/** True when the block is a place where an answer can go. */
export function isDocxAnswerSpace(block: OutlineBlock): boolean {
  return (
    (block.kind === "cell" && block.isEmpty) ||
    block.hasPlaceholder ||
    (block.checkboxGlyphs ?? 0) > 0 ||
    Boolean(block.inContentControl) ||
    Boolean(block.legacyFieldName)
  );
}

function endsLikeQuestion(text: string): boolean {
  const t = text.trim();
  // "Name:", "Is the claimant fit for work?", or a numbered question ("B1. Presenting symptoms").
  return /[?:]\s*$/.test(t) || /^(?:[A-Z]\d{1,2}|\d{1,2}[a-z]?)[.)]\s+\S/.test(t);
}

/** Answer spaces of a Word form, in document order (empty paragraphs count only after a question). */
export function docxAnswerSpaces(blocks: OutlineBlock[]): OutlineBlock[] {
  const out: OutlineBlock[] = [];
  let waitingForAnswer = false;
  for (const b of blocks) {
    if (isDocxAnswerSpace(b)) {
      out.push(b);
      waitingForAnswer = false;
    } else if (b.kind === "paragraph" && b.isEmpty) {
      if (waitingForAnswer) out.push(b);
      waitingForAnswer = false;
    } else {
      waitingForAnswer = b.kind === "paragraph" && endsLikeQuestion(b.text);
    }
  }
  return out;
}

const MAX_BLOCK_TEXT = 400;

function quote(text: string): string {
  const t = neutraliseTags(text.replace(/\s+/g, " ").trim());
  return JSON.stringify(t.length > MAX_BLOCK_TEXT ? `${t.slice(0, MAX_BLOCK_TEXT)}…` : t);
}

/**
 * Every fill-in placeholder in a block, in order and with repeats ("Name: ____ Date of birth: ____" →
 * two). The forms engine records only the first one (OutlineBlock.placeholderText); the analysis must
 * see them all, or it maps only the first question on such a line (form-analysis-3).
 */
export function blockPlaceholders(b: Pick<OutlineBlock, "text" | "hasPlaceholder" | "placeholderText">): string[] {
  if (!b.hasPlaceholder) return [];
  const all = findPlaceholders(b.text).map((m) => m.text);
  if (all.length === 0) return b.placeholderText ? [b.placeholderText] : [];
  return all;
}

function blockDescription(b: OutlineBlock, withText = true): string {
  const parts: string[] = [];
  if (withText) parts.push(b.isEmpty ? "(empty)" : quote(b.text));
  const placeholders = blockPlaceholders(b);
  if (placeholders.length > 1) parts.push(`placeholders=[${placeholders.map(quote).join(", ")}]`);
  else if (b.hasPlaceholder) parts.push(`placeholder=${quote(placeholders[0] ?? b.placeholderText ?? "")}`);
  if (b.checkboxGlyphs) parts.push(`tickboxes=${b.checkboxGlyphs}`);
  if (b.inContentControl) parts.push("content-control");
  if (b.legacyFieldName) parts.push(`legacy-field=${quote(b.legacyFieldName)}`);
  return parts.join(" ");
}

/** "t2.r1.c0.p1" → "t2.r1.c0" (a paragraph inside a cell); null otherwise. */
export function cellOfParagraph(blockId: string): string | null {
  const m = /^(.*\.c\d+)\.p\d+$/.exec(blockId);
  return m ? m[1] : null;
}

/** "t2.r1.c0.p1" / "t2.r1.c0.t0.r0.c0" → "t2.r1" (the top-level table row); null for body paragraphs. */
export function outerRowOf(blockId: string): string | null {
  return /^(t\d+\.r\d+)\./.exec(blockId)?.[1] ?? null;
}

/**
 * Compact rendering of a Word outline for the prompt: one line per body paragraph, one line per table
 * row (cells separated by " | "; a cell with several paragraphs lists them inside ⟨ ⟩ with their own
 * IDs), runs of empty body paragraphs collapsed to their first block.
 */
export function renderDocxOutline(blocks: OutlineBlock[]): string {
  const ids = new Set(blocks.map((b) => b.id));
  const cellParas = new Map<string, OutlineBlock[]>();
  for (const b of blocks) {
    const cell = b.kind === "paragraph" ? cellOfParagraph(b.id) : null;
    if (cell && ids.has(cell)) cellParas.set(cell, [...(cellParas.get(cell) ?? []), b]);
  }
  const isCellParagraph = (b: OutlineBlock) => b.kind === "paragraph" && cellParas.has(cellOfParagraph(b.id) ?? "");
  const renderCell = (c: OutlineBlock) => {
    const paras = cellParas.get(c.id);
    if (!paras?.length) return `[${c.id}] ${blockDescription(c)}`;
    const markers = blockDescription(c, false);
    return `[${c.id}]${markers ? ` ${markers}` : ""} ⟨ ${paras.map((p) => `[${p.id}] ${blockDescription(p)}`).join(" · ")} ⟩`;
  };

  const lines: string[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (isCellParagraph(b)) {
      i += 1;
      continue;
    }
    if (b.kind === "cell") {
      const row = rowKey(b.id);
      const cells: OutlineBlock[] = [];
      while (i < blocks.length && ((blocks[i].kind === "cell" && rowKey(blocks[i].id) === row) || isCellParagraph(blocks[i]))) {
        if (blocks[i].kind === "cell") cells.push(blocks[i]);
        i += 1;
      }
      lines.push(`${row}: ${cells.map(renderCell).join(" | ")}`);
      continue;
    }
    if (b.isEmpty && !isDocxAnswerSpace(b)) {
      let run = 1;
      while (i + run < blocks.length && blocks[i + run].kind === "paragraph" && blocks[i + run].isEmpty && !isDocxAnswerSpace(blocks[i + run]) && !isCellParagraph(blocks[i + run])) run += 1;
      lines.push(`[${b.id}] (empty${run > 1 ? ` ×${run}` : ""})`);
      i += run;
      continue;
    }
    const style = b.headingLevel ? ` (heading ${b.headingLevel})` : b.style && /title|heading/i.test(b.style) ? ` (${b.style})` : "";
    lines.push(`[${b.id}]${style} ${blockDescription(b)}`);
    i += 1;
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------------------------------------
 * PDF outlines
 * ----------------------------------------------------------------------------------------------*/

export interface PdfIndex {
  pdf: PdfFormOutline;
  byName: Map<string, PdfOutlineField>;
  /** Field order: page, then top to bottom, then left to right. */
  order: Map<string, number>;
}

export function sortedPdfFields(pdf: PdfFormOutline): PdfOutlineField[] {
  return pdf.fields
    .slice()
    .sort((a, b) => a.page - b.page || Math.round(b.rect.y + b.rect.height) - Math.round(a.rect.y + a.rect.height) || a.rect.x - b.rect.x);
}

export function indexPdf(pdf: PdfFormOutline): PdfIndex {
  const byName = new Map<string, PdfOutlineField>();
  const order = new Map<string, number>();
  sortedPdfFields(pdf).forEach((f, i) => {
    byName.set(f.name, f);
    order.set(f.name, i);
  });
  return { pdf, byName, order };
}

const r = (n: number) => Math.round(n);

function renderPdfField(f: PdfOutlineField): string {
  const opts = f.options?.length ? ` options=${JSON.stringify(f.options.map((o) => neutraliseTags(o)))}` : "";
  // The label printed beside each option, when it is not the option value itself ("Choice5" printed "Mrs").
  const labels =
    f.options && f.options.length > 1 && f.optionLabels?.length === f.options.length && f.optionLabels.some((l, i) => l.trim() && l.trim() !== f.options![i])
      ? ` printed=${JSON.stringify(f.optionLabels.map((o) => neutraliseTags(o.trim())))}`
      : "";
  const near = f.nearbyText.trim() ? ` near=${quote(f.nearbyText)}` : "";
  return `field ${JSON.stringify(f.name)} ${f.type} page ${f.page} box x=${r(f.rect.x)} y=${r(f.rect.y)} w=${r(f.rect.width)} h=${r(f.rect.height)}${opts}${labels}${near}${sectionAttrs(f)}`;
}

/** ` section="…" completedBy=…` for a field (forms/pdf-sections.ts), or "". */
function sectionAttrs(f: Pick<PdfOutlineField, "section" | "completedBy">): string {
  const section = f.section ? ` section=${quote(f.section)}` : "";
  const party = f.completedBy ? ` completedBy=${f.completedBy}` : "";
  return `${section}${party}`;
}

/** A run of one-character boxes, rendered as ONE answer space named by its first box. */
function renderCharGroup(members: PdfOutlineField[]): string {
  const first = members[0];
  const box = unionRect(members);
  const near = first.nearbyText.trim() ? ` near=${quote(first.nearbyText)}` : "";
  return `field ${JSON.stringify(first.name)} character-boxes=${members.length} (one character per box, ${JSON.stringify(first.name)} to ${JSON.stringify(members[members.length - 1].name)}: map as ONE question with this field name) page ${first.page} box x=${r(box.x)} y=${r(box.y)} w=${r(box.width)} h=${r(box.height)}${near}${sectionAttrs(first)}`;
}

/**
 * The answer spaces of a fillable PDF in reading order: one entry per field, except a run of
 * one-character boxes, which is one entry (its members, left to right).
 */
export function pdfAnswerSpaces(pdf: PdfFormOutline): PdfOutlineField[][] {
  const groups = charGroupsOf(pdf);
  const out: PdfOutlineField[][] = [];
  const done = new Set<string>();
  for (const f of sortedPdfFields(pdf)) {
    if (f.charGroup && groups.has(f.charGroup)) {
      if (done.has(f.charGroup)) continue;
      done.add(f.charGroup);
      out.push(groups.get(f.charGroup)!);
      continue;
    }
    out.push([f]);
  }
  return out;
}

/** Tables of fields with fewer printed rows are listed field by field (a split date or phone number read as a "table"). */
export const OUTLINE_TABLE_MIN_ROWS = 3;

/**
 * One answer space of a fillable PDF as the LIVE analysis sees it (form-analysis-4 outline): a field, a
 * run of one-character boxes, a group of separate tick boxes that answer one question (one box per
 * option – pdf-groups.ts detectOptionGroups), a table of fields (forms/pdf-table.ts, at least
 * OUTLINE_TABLE_MIN_ROWS rows), or a printed signature box no field covers. A group or table is listed
 * once and never split across chunks, so it is mapped as one question.
 */
export type PdfOutlineSpace =
  | { kind: "field"; fields: PdfOutlineField[] }
  | { kind: "chars"; fields: PdfOutlineField[] }
  | { kind: "options"; fields: PdfOutlineField[]; group: OptionGroup }
  | { kind: "table"; fields: PdfOutlineField[]; table: DetectedPdfTable }
  | { kind: "box"; fields: PdfOutlineField[]; box: PdfBox; label: string };

/**
 * A fillable PDF's printed boxes that no field covers and that are labelled as a signature (AXA's
 * "Signature" box beside the fields for the printed name and date) – the same boxes rules mode maps
 * (form-rules.ts printedSignatureBoxes). Logos and table headings are left out.
 */
export function printedSignatureBoxesOf(pdf: PdfFormOutline): Array<{ box: PdfBox; label: string }> {
  const boxes = (pdf.boxes ?? []).filter((b) => b.kind === "box");
  return boxes.flatMap((box) => {
    const label = labelFor(box, pdf, boxes).replace(/\s+/g, " ").replace(/[:\s]+$/, "").trim();
    if (!/\bsignature\b|^signed\b/i.test(label) || /\b(?:date|name|print)\b/i.test(label) || label.length > 80) return [];
    return [{ box, label }];
  });
}

export function pdfOutlineSpaces(pdf: PdfFormOutline): PdfOutlineSpace[] {
  const byName = new Map<string, PdfOutlineSpace>();
  for (const table of detectPdfFieldTables(pdf)) {
    if (table.rows.length < OUTLINE_TABLE_MIN_ROWS) continue;
    const fields = table.fieldNames.map((n) => pdf.fields.find((f) => f.name === n)).filter((f): f is PdfOutlineField => f !== undefined);
    if (fields.length === 0) continue;
    // The first cell (top row, first column) names the table.
    const first = pdf.fields.find((f) => f.name === table.rows[0][table.columns[0].key]);
    const ordered = first ? [first, ...fields.filter((f) => f !== first)] : fields;
    const space: PdfOutlineSpace = { kind: "table", fields: ordered, table };
    fields.forEach((f) => byName.set(f.name, space));
  }
  for (const group of detectOptionGroups(pdf)) {
    if (group.fields.some((f) => byName.has(f.name))) continue;
    const space: PdfOutlineSpace = { kind: "options", fields: group.fields, group };
    group.fields.forEach((f) => byName.set(f.name, space));
  }
  const chars = charGroupsOf(pdf);
  const out: PdfOutlineSpace[] = [];
  const done = new Set<PdfOutlineSpace>();
  const doneChars = new Set<string>();
  for (const f of sortedPdfFields(pdf)) {
    const grouped = byName.get(f.name);
    if (grouped) {
      if (!done.has(grouped)) {
        done.add(grouped);
        out.push(grouped);
      }
      continue;
    }
    if (f.charGroup && chars.has(f.charGroup)) {
      if (doneChars.has(f.charGroup)) continue;
      doneChars.add(f.charGroup);
      out.push({ kind: "chars", fields: chars.get(f.charGroup)! });
      continue;
    }
    out.push({ kind: "field", fields: [f] });
  }
  // Printed signature boxes, at their place in reading order (page, then top to bottom).
  for (const { box, label } of printedSignatureBoxesOf(pdf)) {
    const top = box.y + box.height;
    const at = out.findIndex((s) => s.kind !== "box" && (s.fields[0].page > box.page || (s.fields[0].page === box.page && s.fields[0].rect.y + s.fields[0].rect.height < top - 1)));
    const space: PdfOutlineSpace = { kind: "box", fields: [], box, label };
    if (at < 0) out.push(space);
    else out.splice(at, 0, space);
  }
  return out;
}

/** "page 4 box x=56 y=666 w=218 h=56": how a printed box is named in the outline and a chunk's instruction. */
export function printedBoxRef(box: Pick<PdfBox, "page" | "x" | "y" | "width" | "height">): string {
  return `page ${box.page} box x=${r(box.x)} y=${r(box.y)} w=${r(box.width)} h=${r(box.height)}`;
}

/** A group of separate tick boxes that answer one question: ONE entry listing every box with its printed option. */
function renderOptionGroup(space: Extract<PdfOutlineSpace, { kind: "options" }>): string {
  const first = space.fields[0];
  const boxes = space.fields.map((f, i) => `${JSON.stringify(f.name)}=${JSON.stringify(neutraliseTags(space.group.options[i] ?? ""))}`).join(", ");
  const near = first.nearbyText.trim() ? ` near=${quote(first.nearbyText)}` : "";
  return `tick-box group page ${first.page} (separate tick boxes, one per option – map as ONE question and list EVERY box in optionAnchors, in this order) boxes: ${boxes}${near}${sectionAttrs(first)}`;
}

/** A table of fields (repeated rows): ONE entry named by its first cell. */
function renderTable(space: Extract<PdfOutlineSpace, { kind: "table" }>): string {
  const { table } = space;
  const first = space.fields[0];
  const box = unionRect(space.fields);
  const columns = JSON.stringify(table.columns.map((c) => neutraliseTags(c.header.replace(/\s+/g, " ").trim())));
  const label = table.label.trim() ? ` near=${quote([table.label, table.guidance].filter(Boolean).join(" | "))}` : "";
  return `table of fields page ${first.page} rows=${table.rows.length} columns=${columns} (ONE question for the whole table: anchorRef ${JSON.stringify(first.name)}, its first cell; code writes every row and cell) box x=${r(box.x)} y=${r(box.y)} w=${r(box.width)} h=${r(box.height)}${label}${sectionAttrs(first)}`;
}

/** A printed signature box no field covers. */
function renderPrintedBox(pdf: PdfFormOutline, space: Extract<PdfOutlineSpace, { kind: "box" }>): string {
  const at = pdfSectionAt(pdf, space.box.page, space.box.y + space.box.height + 1);
  return `printed box with no field (map it as pdf_overlay with this box) ${printedBoxRef(space.box)} near=${quote(space.label)}${sectionAttrs(at)}`;
}

/** Positioned page text grouped into lines (same page, y within 3 pt), top to bottom. */
export function pdfTextLines(pdf: PdfFormOutline, page: number): Array<{ y: number; items: Array<{ x: number; str: string }>; section?: string; completedBy?: string }> {
  const items = (pdf.pageText.find((p) => p.page === page)?.items ?? []).filter((it) => it.str.trim() !== "");
  const lines: Array<{ y: number; items: Array<{ x: number; str: string }>; section?: string; completedBy?: string }> = [];
  for (const it of items.slice().sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= 3);
    if (line) line.items.push({ x: it.x, str: it.str });
    else lines.push({ y: it.y, items: [{ x: it.x, str: it.str }], ...(it.section && { section: it.section }), ...(it.completedBy && { completedBy: it.completedBy }) });
  }
  lines.forEach((l) => l.items.sort((a, b) => a.x - b.x));
  return lines;
}

/**
 * Rendering of a PDF outline for the prompt. Fillable PDFs: the answer spaces of pdfOutlineSpaces() – each
 * field (with nearby text), a run of character boxes, a tick-box group and a table of fields as ONE line
 * each, and printed signature boxes no field covers. Flat PDFs:
 * the positioned text, line by line, so answer boxes can be placed (the PDF itself is attached too),
 * then the printed answer boxes and tick boxes of the page (form-boxes.ts renderPdfBoxes).
 */
export function renderPdfOutline(pdf: PdfFormOutline, kind: "pdf_acroform" | "pdf_flat", pages?: number[]): string {
  const lines: string[] = [`pages: ${pdf.pages}`];
  const wanted = (p: number) => !pages || pages.indexOf(p) >= 0;
  if (kind === "pdf_acroform") {
    for (const space of pdfOutlineSpaces(pdf)) {
      if (!wanted(space.kind === "box" ? space.box.page : space.fields[0].page)) continue;
      switch (space.kind) {
        case "field":
          lines.push(renderPdfField(space.fields[0]));
          break;
        case "chars":
          lines.push(renderCharGroup(space.fields));
          break;
        case "options":
          lines.push(renderOptionGroup(space));
          break;
        case "table":
          lines.push(renderTable(space));
          break;
        case "box":
          lines.push(renderPrintedBox(pdf, space));
          break;
      }
    }
    return lines.join("\n");
  }
  for (let page = 1; page <= pdf.pages; page += 1) {
    if (!wanted(page)) continue;
    lines.push(`page ${page}:`);
    let section = "";
    for (const line of pdfTextLines(pdf, page)) {
      // Where a new section of the form starts (forms/pdf-sections.ts), and who completes it.
      if (line.section && line.section !== section) {
        section = line.section;
        lines.push(`  section ${quote(section)}${line.completedBy ? ` completedBy=${line.completedBy}` : ""}`);
      }
      lines.push(`  y=${r(line.y)}: ${line.items.map((it) => `x=${r(it.x)} ${quote(it.str)}`).join("  ")}`);
    }
    lines.push(...renderPdfBoxes(pdf, page));
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------------------------------------
 * Summary (shown before the proposed mapping)
 * ----------------------------------------------------------------------------------------------*/

export function headingsOf(blocks: OutlineBlock[]): string[] {
  return blocks
    .filter((b) => !b.isEmpty && (b.headingLevel !== undefined || (b.style !== undefined && /heading|title/i.test(b.style))))
    .map((b) => b.text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 40);
}

export function summariseParsedForm(form: ParsedForm): FormOutlineSummary {
  if (form.kind === "docx") {
    const tables = new Set<string>();
    for (const b of form.blocks) {
      const m = /^(t\d+)\./.exec(b.id);
      if (m) tables.add(m[1]);
    }
    return {
      kind: "docx",
      paragraphs: form.blocks.filter((b) => b.kind === "paragraph").length,
      tables: tables.size,
      fillableFields: form.blocks.filter((b) => b.inContentControl || b.legacyFieldName).length,
      answerSpaces: docxAnswerSpaces(form.blocks).length,
      headings: headingsOf(form.blocks),
      warnings: form.warnings.slice(),
    };
  }
  const flatSpaces = form.kind === "pdf_flat" ? (form.pdf.boxes?.length ? flatBoxQuestions(form.pdf) : pdfFlatLabelCandidates(form.pdf)).length : 0;
  return {
    kind: form.kind,
    pages: form.pdf.pages,
    fillableFields: form.pdf.fields.length,
    answerSpaces: form.kind === "pdf_acroform" ? pdfAnswerSpaces(form.pdf).length : flatSpaces,
    headings: pdfSectionTitles(form.pdf).slice(0, 40),
    warnings: form.warnings.slice(),
  };
}

/** Flat PDFs: text lines that look like a label waiting for an answer ("Name:", "Date of accident"). */
export function pdfFlatLabelCandidates(pdf: PdfFormOutline): Array<{ page: number; y: number; x: number; text: string; endX: number }> {
  const out: Array<{ page: number; y: number; x: number; text: string; endX: number }> = [];
  for (let page = 1; page <= pdf.pages; page += 1) {
    for (const line of pdfTextLines(pdf, page)) {
      const text = line.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
      if (!text || text.length > 120) continue;
      const blank = /(?:_{3,}|\.{4,}|…{2,})\s*$/.test(text);
      if (!endsLikeQuestion(text) && !blank) continue;
      const last = line.items[line.items.length - 1];
      out.push({
        page,
        y: line.y,
        x: line.items[0].x,
        text: text.replace(/(?:_{3,}|\.{4,}|…{2,})\s*$/, "").trim(),
        endX: last.x + Math.max(30, last.str.length * 5),
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Chunking long forms (each chunk is one Claude call; all calls run in parallel)
 * ----------------------------------------------------------------------------------------------*/

/**
 * Answer spaces per analysis call: keeps one call's output (and latency) well inside the time limit
 * (measured at medium effort: 11 fields per call in 21–34 s).
 */
export const ANSWER_SPACES_PER_CHUNK = 10;
/** Hard cap on parallel analysis calls for one form. */
export const MAX_ANALYSIS_CHUNKS = 6;

export type AnalysisChunk =
  /** `parts`: the chunk's top-level blocks in order – "[p3]" or "table t2 (rows t2.r0 to t2.r9)" (form-analysis-3). */
  | { kind: "blocks"; fromId: string; toId: string; answerSpaces: number; parts?: string[] }
  /** `boxes`: printed boxes with no field in this chunk (printedBoxRef), e.g. a signature box. */
  | { kind: "fields"; names: string[]; boxes?: string[] }
  | { kind: "pages"; pages: number[] };

function chunkCount(n: number): number {
  return Math.max(1, Math.min(MAX_ANALYSIS_CHUNKS, Math.ceil(n / ANSWER_SPACES_PER_CHUNK)));
}

/**
 * The top-level blocks of a chunk in document order, for the chunk's instruction: body paragraphs by ID
 * and each table (or the run of its rows in this chunk) as one item. Spelling the range out stops a
 * reader from mapping the questions of a neighbouring table it can see in the outline.
 */
export function chunkParts(slice: OutlineBlock[]): string[] {
  const parts: string[] = [];
  let i = 0;
  while (i < slice.length) {
    const table = /^(t\d+)\./.exec(slice[i].id)?.[1];
    if (!table) {
      parts.push(`[${slice[i].id}]`);
      i += 1;
      continue;
    }
    const rows: number[] = [];
    while (i < slice.length && slice[i].id.startsWith(`${table}.`)) {
      const row = /^t\d+\.r(\d+)/.exec(slice[i].id);
      if (row && rows.indexOf(Number(row[1])) < 0) rows.push(Number(row[1]));
      i += 1;
    }
    rows.sort((a, b) => a - b);
    const first = rows[0];
    const last = rows[rows.length - 1];
    parts.push(rows.length === 0 ? `table ${table}` : first === last ? `table ${table} (row ${table}.r${first})` : `table ${table} (rows ${table}.r${first} to ${table}.r${last})`);
  }
  return parts;
}

/**
 * Word: contiguous block ranges with about equal numbers of answer spaces, cut just before a heading
 * (or a table) when one is close to the ideal cut.
 */
export function chunkDocx(blocks: OutlineBlock[]): AnalysisChunk[] {
  if (blocks.length === 0) return [];
  const spaces = new Set(docxAnswerSpaces(blocks).map((b) => b.id));
  const n = chunkCount(spaces.size);
  if (n === 1) return [{ kind: "blocks", fromId: blocks[0].id, toId: blocks[blocks.length - 1].id, answerSpaces: spaces.size }];

  const isBoundary = (i: number) => {
    const b = blocks[i];
    if (b.headingLevel !== undefined) return true;
    // Start of a new table.
    const prev = blocks[i - 1];
    const t = /^(t\d+)\./.exec(b.id)?.[1];
    return Boolean(t) && (!prev || /^(t\d+)\./.exec(prev.id)?.[1] !== t);
  };
  const cumulative: number[] = [];
  let count = 0;
  blocks.forEach((b) => {
    if (spaces.has(b.id)) count += 1;
    cumulative.push(count);
  });
  const total = count;
  const cuts: number[] = [];
  for (let k = 1; k < n; k += 1) {
    const target = (total * k) / n;
    let ideal = cumulative.findIndex((c) => c >= target);
    if (ideal < 0) ideal = blocks.length - 1;
    // Look for a heading/table start within ±25% of a chunk's worth of blocks.
    const window = Math.max(3, Math.round(blocks.length / n / 4));
    let best = ideal;
    for (let d = 0; d <= window; d += 1) {
      if (ideal - d > (cuts[cuts.length - 1] ?? 0) && isBoundary(ideal - d)) {
        best = ideal - d;
        break;
      }
      if (ideal + d < blocks.length && isBoundary(ideal + d)) {
        best = ideal + d;
        break;
      }
    }
    // Never cut a table row in half.
    while (best > 0 && outerRowOf(blocks[best].id) !== null && outerRowOf(blocks[best].id) === outerRowOf(blocks[best - 1].id)) best -= 1;
    if (best > (cuts[cuts.length - 1] ?? 0)) cuts.push(best);
  }
  const chunks: AnalysisChunk[] = [];
  let start = 0;
  for (const cut of cuts.concat([blocks.length])) {
    if (cut <= start) continue;
    const slice = blocks.slice(start, cut);
    chunks.push({
      kind: "blocks",
      fromId: slice[0].id,
      toId: slice[slice.length - 1].id,
      answerSpaces: slice.filter((b) => spaces.has(b.id)).length,
      parts: chunkParts(slice),
    });
    start = cut;
  }
  return chunks.filter((c) => c.kind !== "blocks" || c.answerSpaces > 0);
}

/**
 * Fillable PDF: answer spaces in page order, split into equal groups. A run of character boxes, a group of
 * tick boxes and a table stay together (each counts as one answer space); a printed signature box goes
 * with the fields around it.
 */
export function chunkPdfFields(pdf: PdfFormOutline): AnalysisChunk[] {
  const spaces = pdfOutlineSpaces(pdf);
  if (spaces.length === 0) return [];
  const n = chunkCount(spaces.length);
  const chunks: AnalysisChunk[] = [];
  let start = 0;
  for (let g = 0; g < n; g += 1) {
    const take = Math.ceil((spaces.length - start) / (n - g));
    const mine = spaces.slice(start, start + take);
    const names = mine.reduce<string[]>((acc, sp) => acc.concat(sp.fields.map((f) => f.name)), []);
    const boxes = mine.flatMap((sp) => (sp.kind === "box" ? [printedBoxRef(sp.box)] : []));
    chunks.push({ kind: "fields", names, ...(boxes.length && { boxes }) });
    start += take;
  }
  return chunks;
}

/** Flat PDF: pages split into groups with about equal numbers of label candidates. */
export function chunkPdfPages(pdf: PdfFormOutline): AnalysisChunk[] {
  const perPage: number[] = [];
  const candidates: Array<{ page: number }> = pdf.boxes?.length ? flatBoxQuestions(pdf) : pdfFlatLabelCandidates(pdf);
  for (let p = 1; p <= pdf.pages; p += 1) perPage.push(candidates.filter((c) => c.page === p).length);
  const total = perPage.reduce((a, b) => a + b, 0);
  const n = Math.min(chunkCount(total), Math.max(1, pdf.pages));
  if (n === 1) return [{ kind: "pages", pages: Array.from({ length: pdf.pages }, (_, i) => i + 1) }];
  const chunks: AnalysisChunk[] = [];
  let current: number[] = [];
  let acc = 0;
  const per = total / n;
  for (let p = 1; p <= pdf.pages; p += 1) {
    current.push(p);
    acc += perPage[p - 1];
    if (acc >= per * (chunks.length + 1) && chunks.length < n - 1) {
      chunks.push({ kind: "pages", pages: current });
      current = [];
    }
  }
  if (current.length) chunks.push({ kind: "pages", pages: current });
  return chunks;
}

export function chunkParsedForm(form: ParsedForm): AnalysisChunk[] {
  if (form.kind === "docx") return chunkDocx(form.blocks);
  return form.kind === "pdf_acroform" ? chunkPdfFields(form.pdf) : chunkPdfPages(form.pdf);
}

/** The FormKind of a parsed form. */
export function formKindOf(form: ParsedForm): FormKind {
  return form.kind;
}
