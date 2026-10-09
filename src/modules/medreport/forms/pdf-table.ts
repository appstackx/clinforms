import "server-only";

/**
 * Tables with repeated rows on PDF forms (S2): finding them in a fillable PDF's outline, writing a
 * table answer into them, and printing the rows that do not fit on the continuation sheet as a table.
 *
 * Detection (detectPdfFieldTables): a table is two or more COLUMNS of fields whose names number the
 * rows ("…Row1", "…Row 2", "…_3") – same page, same left edge and width – with the same row heights,
 * plus any other column of fields that lines up with every row next to it (Freedom's "YESNO7…1", whose
 * numbering runs bottom to top). Rows are ordered by their position on the page, top to bottom, never
 * by the number in the name. Headers come from the text printed above the first row; the question's
 * label from the numbered heading or question printed above the table.
 *
 * Filling: `pdf_table` writes row i's cells into the fields of printed row i; `pdf_overlay_table`
 * draws them into the printed cells of a flat PDF. A cell shrinks its text (to 8 pt), then wraps onto
 * two lines where the cell is tall enough; text that still does not fit is shortened with "…" and its
 * row is repeated in full on the continuation sheet. Rows beyond the printed table go to the
 * continuation sheet as a table, with a warning. A cell that has its choices printed in it ("Yes / No"
 * under "Has this bill been paid?") gets the chosen word circled instead of text written over it.
 *
 * Owner: S2 (pdf-tables-flat).
 */
import { PDFCheckBox, PDFTextField, rgb, type PDFDocument, type PDFFont, type PDFForm, type PDFPage } from "pdf-lib";
import { appointmentColumnFromHeader } from "../core/form-tables";
import { ensureTextFieldDA, onValueFor, setCheckBoxState } from "./pdf-acro-fill";
import { widgetPage, widgetPageIndex } from "./pdf-outline";
import { loadPdfjs, pdfjsDocumentParams } from "./pdfjs";
import type { FormAnswerRow, FormField, FormTableColumn, PdfFormOutline, PdfOutlineField, PdfOverlayTableAnchor, PdfTableAnchor } from "../core/types";

/* ------------------------------------------------------------------------------------------------
 * Detection (fillable PDFs)
 * ----------------------------------------------------------------------------------------------*/

export interface DetectedPdfTable {
  page: number;
  /** Columns left to right; x / width are the column's field box. */
  columns: Array<FormTableColumn & { x: number; width: number }>;
  /** Printed rows top to bottom: column key → field name. */
  rows: Array<Record<string, string>>;
  /** Top edge of each printed row (PDF points), top to bottom. */
  rowTops: number[];
  rowHeight: number;
  /** The question printed above the table ("Details of the medical expenses you are claiming for"). */
  label: string;
  /** Instructions printed between that question and the table. */
  guidance: string;
  /** Every field name in the table. */
  fieldNames: string[];
}

/** "Date of treatmentRow1" → {base, n: 1}; "Fee_3" → {base, n: 3}. Null without a row-number suffix. */
export function rowNumberedName(name: string): { base: string; n: number } | null {
  const last = name.split(".").pop() ?? name;
  const row = /^(.*?)[\s_.-]*row[\s_.-]*(\d{1,3})$/i.exec(last);
  if (row && row[1].trim()) return { base: row[1].trim(), n: Number(row[2]) };
  const underscored = /^(.*?)_(\d{1,3})$/.exec(last);
  if (underscored && underscored[1].trim()) return { base: underscored[1].trim(), n: Number(underscored[2]) };
  return null;
}

/** A trailing number of any kind ("YESNO7" → {base: "YESNO", n: 7}). */
function numberedName(name: string): { base: string; n: number } | null {
  const last = name.split(".").pop() ?? name;
  const m = /^(.*?)[\s_.-]*(\d{1,3})$/.exec(last);
  return m && m[1].trim() ? { base: m[1].trim(), n: Number(m[2]) } : null;
}

const top = (f: PdfOutlineField) => f.rect.y + f.rect.height;
const midY = (f: PdfOutlineField) => f.rect.y + f.rect.height / 2;

interface Column {
  base: string;
  fields: PdfOutlineField[];
  x: number;
  width: number;
}

/** Fields of one page that share a base name, left edge and width → one column, sorted top to bottom. */
function columnsOf(fields: PdfOutlineField[], baseOf: (name: string) => { base: string; n: number } | null): Column[] {
  const groups = new Map<string, PdfOutlineField[]>();
  for (const f of fields) {
    const parsed = baseOf(f.name);
    if (!parsed) continue;
    const key = `${f.page}|${parsed.base.toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const out: Column[] = [];
  for (const [key, members] of Array.from(groups.entries())) {
    // Split a base name's fields into runs with the same left edge and width.
    const runs: PdfOutlineField[][] = [];
    for (const f of members) {
      const run = runs.find((r) => Math.abs(r[0].rect.x - f.rect.x) <= 4 && Math.abs(r[0].rect.width - f.rect.width) <= 6);
      if (run) run.push(f);
      else runs.push([f]);
    }
    for (const run of runs) {
      if (run.length < 2) continue;
      const sorted = run.slice().sort((a, b) => top(b) - top(a));
      // Distinct rows only (two fields on one row are not a column).
      if (sorted.some((f, i) => i > 0 && Math.abs(midY(f) - midY(sorted[i - 1])) < f.rect.height * 0.5)) continue;
      void key;
      out.push({ base: baseOf(sorted[0].name)?.base ?? "", fields: sorted, x: Math.min(...sorted.map((f) => f.rect.x)), width: Math.max(...sorted.map((f) => f.rect.width)) });
    }
  }
  return out;
}

/** Two columns line up row for row (same number of rows, each row's middle within tolerance). */
function sameRows(a: Column, b: Column): boolean {
  if (a.fields.length !== b.fields.length) return false;
  return a.fields.every((f, i) => Math.abs(midY(f) - midY(b.fields[i])) <= Math.max(4, f.rect.height * 0.35));
}

/** Rows touch or nearly touch (a table, not a list of separate questions). */
function tightRows(c: Column): boolean {
  for (let i = 1; i < c.fields.length; i += 1) {
    const gap = c.fields[i - 1].rect.y - top(c.fields[i]);
    if (gap > Math.max(6, c.fields[i].rect.height * 0.6)) return false;
  }
  return true;
}

type Line = { y: number; text: string; x: number };

/** Page text grouped into lines (y within 3 pt), top to bottom. */
function textLines(pdf: PdfFormOutline, page: number): Line[] {
  const items = (pdf.pageText.find((p) => p.page === page)?.items ?? []).filter((it) => it.str.trim() !== "");
  const lines: Array<{ y: number; items: Array<{ x: number; str: string }> }> = [];
  for (const it of items.slice().sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= 3);
    if (line) line.items.push({ x: it.x, str: it.str });
    else lines.push({ y: it.y, items: [{ x: it.x, str: it.str }] });
  }
  return lines.map((l) => {
    const sorted = l.items.sort((a, b) => a.x - b.x);
    return { y: l.y, x: sorted[0].x, text: sorted.map((i) => i.str.trim()).join(" ").replace(/\s+/g, " ").trim() };
  });
}

function prettify(base: string): string {
  return base
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The text printed just above a column's first row (its header), lines joined top to bottom, and the
 * top of that text (rowTop when there is none).
 */
function headerAbove(pdf: PdfFormOutline, page: number, x: number, width: number, rowTop: number): { text: string; top: number } {
  const items = (pdf.pageText.find((p) => p.page === page)?.items ?? [])
    .filter((it) => it.str.trim() && it.x >= x - 6 && it.x < x + width - 2 && it.y >= rowTop - 2 && it.y <= rowTop + 48)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const kept: typeof items = [];
  let lastY = rowTop;
  for (const it of items) {
    if (it.y - lastY > 16) break;
    kept.push(it);
    lastY = Math.max(lastY, it.y);
  }
  // Top to bottom, left to right within a line.
  kept.sort((a, b) => (Math.abs(a.y - b.y) <= 3 ? a.x - b.x : b.y - a.y));
  const text = kept
    .map((it) => it.str.trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return { text, top: kept.length ? Math.max(...kept.map((it) => it.y)) + 8 : rowTop };
}

const STOP = new Set(["of", "the", "a", "an", "eg", "e", "g", "ie", "i", "and", "or", "to", "for", "in", "this", "has", "been", "is", "was"]);

function slugKey(header: string, used: Set<string>): string {
  const words = header
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w));
  let key = (words.slice(0, 2).join("_") || "column").slice(0, 30);
  if (used.has(key)) {
    let n = 2;
    while (used.has(`${key}_${n}`)) n += 1;
    key = `${key}_${n}`;
  }
  used.add(key);
  return key;
}

/** Text cut at a sentence or word boundary to at most `max` characters. */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const sentence = cut.lastIndexOf(". ");
  if (sentence > max * 0.5) return cut.slice(0, sentence + 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).trimEnd()}…`;
}

/** The question above the table: the closest numbered heading or line ending in ":" / "?" (within ~110 pt). */
function labelAbove(pdf: PdfFormOutline, page: number, headerTop: number, left: number, right: number): { label: string; guidance: string } {
  const lines = textLines(pdf, page).filter((l) => l.y > headerTop + 1 && l.y <= headerTop + 110 && l.x < right && l.x >= left - 40);
  // Closest first.
  lines.sort((a, b) => a.y - b.y);
  const between: string[] = [];
  for (const l of lines) {
    if (/^\d+(?:\.\d+)*[.)]?\s+\S/.test(l.text) || /[:?]$/.test(l.text)) {
      return { label: l.text.replace(/^\d+(?:\.\d+)*[.)]?\s+/, "").replace(/[\s:]+$/, "").trim(), guidance: shorten(between.reverse().join(" "), 300) };
    }
    between.push(l.text);
  }
  return { label: "", guidance: "" };
}

/** Tables of fields in a fillable PDF's outline (see the file comment). */
export function detectPdfFieldTables(pdf: PdfFormOutline): DetectedPdfTable[] {
  const tables: DetectedPdfTable[] = [];
  const pages = Array.from(new Set(pdf.fields.map((f) => f.page))).sort((a, b) => a - b);
  for (const page of pages) {
    const onPage = pdf.fields.filter((f) => f.page === page && (f.type === "text" || f.type === "checkbox"));
    const strong = columnsOf(onPage, rowNumberedName).filter(tightRows);
    const usedNames = new Set<string>();
    const claimed = new Set<Column>();
    for (const seed of strong) {
      if (claimed.has(seed)) continue;
      const group = strong.filter((c) => !claimed.has(c) && sameRows(seed, c));
      if (group.length < 2) continue;
      group.forEach((c) => claimed.add(c));
      group.forEach((c) => c.fields.forEach((f) => usedNames.add(f.name)));
      // Other numbered fields lining up with every row, just beside the table (e.g. "YESNO7…1").
      const left = Math.min(...group.map((c) => c.x));
      const right = Math.max(...group.map((c) => c.x + c.width));
      const weak = columnsOf(
        onPage.filter((f) => !usedNames.has(f.name)),
        numberedName,
      ).filter((c) => sameRows(seed, c) && c.x + c.width >= left - 24 && c.x <= right + 24);
      weak.forEach((c) => c.fields.forEach((f) => usedNames.add(f.name)));
      const columns = group.concat(weak).sort((a, b) => a.x - b.x);
      const rowTops = seed.fields.map((_, i) => Math.round(Math.max(...columns.map((c) => top(c.fields[i]))) * 10) / 10);
      const heights = columns.flatMap((c) => c.fields.map((f) => f.rect.height)).sort((a, b) => a - b);
      const rowHeight = Math.round(heights[Math.floor(heights.length / 2)] * 10) / 10;
      const used = new Set<string>();
      let headerTop = rowTops[0];
      const cols = columns.map((c) => {
        const printed = headerAbove(pdf, page, c.x, c.width, rowTops[0]);
        headerTop = Math.max(headerTop, printed.top);
        const header = printed.text || prettify(c.base);
        const what = appointmentColumnFromHeader(header);
        const key = what && !used.has(what) ? (used.add(what), what) : slugKey(header, used);
        return { key, header, x: Math.round(c.x * 10) / 10, width: Math.round(c.width * 10) / 10, fields: c.fields };
      });
      const rows = seed.fields.map((_, i) => {
        const row: Record<string, string> = {};
        for (const c of cols) row[c.key] = c.fields[i].name;
        return row;
      });
      const { label, guidance } = labelAbove(pdf, page, headerTop, left, right);
      tables.push({
        page,
        columns: cols.map(({ key, header, x, width }) => ({ key, header, x, width })),
        rows,
        rowTops,
        rowHeight,
        label: label || `Table: ${cols.map((c) => c.header).join(" / ")}`.slice(0, 200),
        guidance,
        fieldNames: cols.flatMap((c) => c.fields.map((f) => f.name)),
      });
    }
  }
  return tables;
}

/** The pdf_table anchor of a detected table. */
export function pdfTableAnchorOf(table: DetectedPdfTable): PdfTableAnchor {
  return { kind: "pdf_table", columns: table.columns.map(({ key, header }) => ({ key, header })), rows: table.rows.map((r) => ({ ...r })) };
}

/* ------------------------------------------------------------------------------------------------
 * Filling
 * ----------------------------------------------------------------------------------------------*/

/** What the table writer needs from the PDF fill (forms/pdf-fill.ts passes its own context). */
export interface TableFillDeps {
  doc: PDFDocument;
  pdfForm: PDFForm;
  font: PDFFont;
  bold: PDFFont;
  encode(text: string, lost?: string[]): string;
  warn(message: string): void;
  fitText(text: string, font: PDFFont, box: { width: number; height: number }, preferred: number, multiline: boolean): { size: number; text: string; overflow: boolean };
  wrapText(text: string, font: PDFFont, size: number, width: number): string[];
  /** Print overlay cells in capitals (FormDefinition.uppercase). */
  uppercase: boolean;
  /** Rows for the continuation sheet. */
  addTableContinuation(field: FormField, table: ContinuationTable): void;
  /** The text printed on a page (1-based), with positions – see printedTextLoader(). */
  printedText?(page: number): Promise<PrintedText[]>;
}

/** A run of text printed on a page: baseline start (x, y), width and height in PDF points. */
export interface PrintedText {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Loads the printed text of a PDF's pages on first use (pdf.js), one page at a time, cached. */
export function printedTextLoader(buf: Uint8Array): (page: number) => Promise<PrintedText[]> {
  const cache = new Map<number, Promise<PrintedText[]>>();
  return (page: number) => {
    let hit = cache.get(page);
    if (!hit) {
      hit = (async () => {
        try {
          const pdfjs = await loadPdfjs();
          const task = pdfjs.getDocument(pdfjsDocumentParams(buf));
          try {
            const pdf = await task.promise;
            if (page < 1 || page > pdf.numPages) return [];
            const content = await (await pdf.getPage(page)).getTextContent();
            const out: PrintedText[] = [];
            for (const raw of content.items) {
              if (!("str" in raw) || !raw.str.trim()) continue;
              const t = raw.transform as number[];
              out.push({ str: raw.str, x: t[4], y: t[5], w: raw.width, h: raw.height || Math.abs(t[3]) || 8 });
            }
            return out;
          } finally {
            await task.destroy();
          }
        } catch {
          return [];
        }
      })();
      cache.set(page, hit);
    }
    return hit;
  };
}

/** A printed "Yes / No" (or "Y / N") inside a cell, and where the chosen word is. */
function printedChoice(items: readonly PrintedText[], cell: { x: number; y: number; width: number; height: number }, value: string, font: PDFFont): { x: number; y: number; w: number; h: number } | null {
  const want = /^(?:yes|y|true|paid)$/i.test(value.trim()) ? "yes" : /^(?:no|n|false|unpaid)$/i.test(value.trim()) ? "no" : null;
  if (!want) return null;
  for (const it of items) {
    const midY = it.y + it.h / 2;
    if (it.x < cell.x - 2 || it.x + it.w > cell.x + cell.width + 2 || midY < cell.y || midY > cell.y + cell.height) continue;
    const m = /\b(yes|y)\b\s*\/\s*\b(no|n)\b/i.exec(it.str);
    if (!m) continue;
    const start = want === "yes" ? m.index + m[0].indexOf(m[1]) : m.index + m[0].lastIndexOf(m[2]);
    const word = want === "yes" ? m[1] : m[2];
    // Positions within the printed run, in proportion to the standard font's widths.
    const total = font.widthOfTextAtSize(it.str, 10) || 1;
    const scale = it.w / total;
    const x = it.x + font.widthOfTextAtSize(it.str.slice(0, start), 10) * scale;
    const w = font.widthOfTextAtSize(word, 10) * scale;
    return { x, y: it.y, w, h: it.h };
  }
  return null;
}

export interface ContinuationTable {
  columns: FormTableColumn[];
  /** Rows to print, each with the printed row number it belongs to (1-based; beyond the form's rows = "extra"). */
  rows: Array<{ n: number; cells: FormAnswerRow; shortened: boolean }>;
  /** Rows the printed table holds. */
  capacity: number;
}

const MIN_FONT = 8;
const CELL_FONT = 9;
const ANSWER_COLOR = rgb(0.06, 0.09, 0.2);
const ELLIPSIS = "…";

function where(field: FormField): string {
  return `${field.id} (“${field.label}”)`;
}

const lineHeight = (font: PDFFont, size: number) => font.heightAtSize(size) * 1.18;

/** Cut text at a word boundary so that it plus "…" fits one line at the minimum size. */
function shortenToWidth(text: string, font: PDFFont, width: number): string {
  if (font.widthOfTextAtSize(text, MIN_FONT) <= width) return text;
  let cut = text;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}${ELLIPSIS}`, MIN_FONT) > width) {
    const space = cut.lastIndexOf(" ");
    cut = space > 0 ? cut.slice(0, space).trimEnd() : cut.slice(0, -1);
  }
  // "INITIAL ASSESSMENT;…" reads as a typo: no separator before the ellipsis.
  const trimmed = cut.replace(/[\s,;:.\u2013\u2014-]+$/, "");
  return `${trimmed || cut}${ELLIPSIS}`;
}

/**
 * Text for one cell: one line shrunk to fit; else two or more lines when the cell is tall enough;
 * else shortened with "…" (shortened: true – the row is repeated on the continuation sheet).
 */
function fitCell(deps: TableFillDeps, text: string, box: { width: number; height: number }, preferred: number): { size: number; lines: string[]; shortened: boolean } {
  const single = deps.fitText(text, deps.font, box, preferred, false);
  if (!single.overflow) return { size: single.size, lines: [single.text], shortened: false };
  if (box.height >= 2 * lineHeight(deps.font, MIN_FONT)) {
    const multi = deps.fitText(text, deps.font, box, Math.min(preferred, CELL_FONT), true);
    if (!multi.overflow) return { size: multi.size, lines: deps.wrapText(multi.text, deps.font, multi.size, box.width), shortened: false };
  }
  return { size: MIN_FONT, lines: [shortenToWidth(text, deps.font, box.width)], shortened: true };
}

function isYes(text: string): boolean {
  return /^(?:yes|y|true|x|ticked|paid|✓|✔)$/i.test(text.trim());
}

/** Write a table answer into a fillable PDF's table fields (pdf_table). */
export async function fillPdfFieldTable(deps: TableFillDeps, field: FormField, anchor: PdfTableAnchor, rows: readonly FormAnswerRow[]): Promise<void> {
  const extra: ContinuationTable["rows"] = [];
  const pages = deps.doc.getPages();
  const pageIndex = widgetPageIndex(deps.doc);
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const printed = anchor.rows[i];
    if (!printed) {
      extra.push({ n: i + 1, cells: row, shortened: false });
      continue;
    }
    let shortened = false;
    for (const col of anchor.columns) {
      const raw = (row[col.key] ?? "").trim();
      const name = printed[col.key];
      if (!raw || !name) continue;
      let pdfField;
      try {
        pdfField = deps.pdfForm.getField(name);
      } catch {
        deps.warn(`${where(field)}: the form has no field called “${name}”, so that cell was left blank. Check the form mapping.`);
        continue;
      }
      if (pdfField instanceof PDFCheckBox) {
        // Every widget's state set by hand, with a visible tick (forms/pdf-acro-fill.ts).
        if (isYes(raw)) setCheckBoxState(pdfField, onValueFor(pdfField, undefined));
        continue;
      }
      if (!(pdfField instanceof PDFTextField)) continue;
      ensureTextFieldDA(deps.pdfForm, pdfField);
      const text = deps.encode(raw);
      const widget = pdfField.acroField.getWidgets()[0];
      const max = pdfField.getMaxLength();
      if (!widget) {
        pdfField.setText(max !== undefined ? text.slice(0, max) : text);
        continue;
      }
      const rect = widget.getRectangle();
      // Choices printed in the cell ("Yes / No"): circle the chosen one, write nothing over them.
      if (deps.printedText) {
        const pageNo = widgetPage(deps.doc, widget, pageIndex);
        const choice = printedChoice(await deps.printedText(pageNo + 1), rect, raw, deps.font);
        if (choice && pages[pageNo]) {
          pages[pageNo].drawEllipse({
            x: choice.x + choice.w / 2,
            y: choice.y + choice.h * 0.32,
            // Just round the word: clear of the "/" beside it and of the cell's border.
            xScale: choice.w / 2 + 1.2,
            yScale: Math.max(5, choice.h * 0.62),
            borderColor: ANSWER_COLOR,
            borderWidth: 1.1,
          });
          continue;
        }
      }
      const pad = (widget.getBorderStyle()?.getWidth() ?? 1) + 1.5;
      const box = { width: rect.width - 2 * pad - 2, height: rect.height - 2 * pad };
      const fit = fitCell(deps, max !== undefined ? text.slice(0, max) : text, box, Math.min(CELL_FONT, Math.max(MIN_FONT, rect.height - 2 * pad)));
      if (fit.lines.length > 1) pdfField.enableMultiline();
      pdfField.setText(fit.lines.join("\n"));
      pdfField.setFontSize(fit.size);
      if (fit.shortened || (max !== undefined && text.length > max)) shortened = true;
    }
    if (shortened) extra.push({ n: i + 1, cells: row, shortened: true });
  }
  report(deps, field, anchor.columns, anchor.rows.length, extra);
}

/** Draw a table answer into a flat PDF's printed table (pdf_overlay_table). */
export function drawOverlayTable(deps: TableFillDeps, field: FormField, anchor: PdfOverlayTableAnchor, rows: readonly FormAnswerRow[]): void {
  const page = deps.doc.getPages()[anchor.page - 1];
  if (!page) {
    deps.warn(`${where(field)}: page ${anchor.page} does not exist in this PDF.`);
    return;
  }
  const extra: ContinuationTable["rows"] = [];
  const cased = (row: FormAnswerRow): FormAnswerRow => (deps.uppercase ? upperRow(row) : row);
  const cellBox = (col: PdfOverlayTableAnchor["columns"][number], rowTop: number) => ({ x: col.x + 2, y: rowTop - anchor.rowHeight + 1.5, width: col.width - 4, height: anchor.rowHeight - 3 });
  const cellText = (row: FormAnswerRow, key: string) => deps.encode(cased(row)[key]?.trim() ?? "");
  // One font size for the whole printed table: the smallest any of its cells needs (8 pt at least), so a
  // row never mixes sizes. Cells that only fit shortened do not set it.
  let tableSize = CELL_FONT;
  rows.forEach((row, i) => {
    const rowTop = anchor.rowTops[i];
    if (rowTop === undefined) return;
    for (const col of anchor.columns) {
      const text = cellText(row, col.key);
      if (!text) continue;
      const box = cellBox(col, rowTop);
      const fit = fitCell(deps, text, box, Math.min(CELL_FONT, Math.max(MIN_FONT, box.height - 2)));
      if (!fit.shortened) tableSize = Math.min(tableSize, fit.size);
    }
  });
  rows.forEach((row, i) => {
    const rowTop = anchor.rowTops[i];
    if (rowTop === undefined) {
      extra.push({ n: i + 1, cells: cased(row), shortened: false });
      return;
    }
    let shortened = false;
    for (const col of anchor.columns) {
      const text = cellText(row, col.key);
      if (!text) continue;
      const box = cellBox(col, rowTop);
      const fit = fitCell(deps, text, box, Math.max(MIN_FONT, Math.min(tableSize, box.height - 2)));
      const lh = lineHeight(deps.font, fit.size);
      const blockHeight = fit.lines.length === 1 ? fit.size * 0.72 : fit.lines.length * lh;
      // Single lines sit in the middle of the cell; wrapped lines start at its top.
      let y = fit.lines.length === 1 ? box.y + (box.height - blockHeight) / 2 : box.y + box.height - fit.size;
      for (const line of fit.lines) {
        if (line) page.drawText(line, { x: box.x, y, size: fit.size, font: deps.font, color: ANSWER_COLOR });
        y -= lh;
      }
      if (fit.shortened) shortened = true;
    }
    if (shortened) extra.push({ n: i + 1, cells: cased(row), shortened: true });
  });
  report(deps, field, anchor.columns.map(({ key, header }) => ({ key, header })), anchor.rowTops.length, extra);
}

/** A table row in BLOCK CAPITALS (forms that ask for them – on the form and on its continuation sheet). */
function upperRow(row: FormAnswerRow): FormAnswerRow {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "string" ? v.toLocaleUpperCase("en-GB") : v])) as FormAnswerRow;
}

/** Longest question label repeated in a continuation heading (characters). */
const HEADING_LABEL_MAX = 120;

/**
 * The heading of a field's part of the continuation sheet: "<section> – <label> (continued)", without
 * the section when the label already says it (or the section is the label), the label cut at about
 * 120 characters.
 */
export function continuationHeading(field: Pick<FormField, "section" | "label">): string {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  let label = field.label.replace(/\s+/g, " ").trim();
  if (label.length > HEADING_LABEL_MAX) {
    const cut = label.slice(0, HEADING_LABEL_MAX);
    const space = cut.lastIndexOf(" ");
    label = `${(space > 60 ? cut.slice(0, space) : cut).replace(/[\s,;:.\u2013\u2014-]+$/, "")}${ELLIPSIS}`;
  }
  const section = (field.section ?? "").replace(/\s+/g, " ").trim();
  const s = norm(section);
  const l = norm(field.label);
  const showSection = s !== "" && !l.includes(s) && !s.includes(l);
  return `${showSection ? `${section} – ` : ""}${label} (continued)`;
}

/** Draw a bold heading wrapped to the sheet's width; returns the y below it. */
export function drawWrappedHeading(page: PDFPage, text: string, font: PDFFont, x: number, y: number, width: number, size = 10): number {
  const lines = wrapLines(text, font, size, width);
  const lh = lineHeight(font, size);
  lines.forEach((line, i) => page.drawText(line, { x, y: y - i * lh, size, font, color: rgb(0.1, 0.12, 0.2) }));
  return y - (lines.length - 1) * lh;
}

function report(deps: TableFillDeps, field: FormField, columns: FormTableColumn[], capacity: number, extra: ContinuationTable["rows"]): void {
  if (extra.length === 0) return;
  const beyond = extra.filter((r) => r.n > capacity).length;
  const shortened = extra.length - beyond;
  if (beyond > 0) {
    deps.warn(`${where(field)}: the table on the form has ${capacity} row${capacity === 1 ? "" : "s"}; the other ${beyond} row${beyond === 1 ? " is" : "s are"} on the continuation sheet at the end of the form.`);
  }
  if (shortened > 0) {
    deps.warn(`${where(field)}: ${shortened} row${shortened === 1 ? " was" : "s were"} too long for the table's cells; ${shortened === 1 ? "it is" : "they are"} shortened on the form and printed in full on the continuation sheet.`);
  }
  deps.addTableContinuation(field, { columns, rows: extra, capacity });
}

/* ------------------------------------------------------------------------------------------------
 * Continuation sheet: rows as a table
 * ----------------------------------------------------------------------------------------------*/

export interface SheetCursor {
  page: PDFPage;
  y: number;
}

/**
 * Draw a continuation table at the cursor (heading, header row, rows with cell borders), starting new
 * pages with `newPage()` as needed (the header row is repeated). Returns the cursor below the table.
 */
export function drawContinuationTable(
  deps: Pick<TableFillDeps, "font" | "bold" | "encode">,
  field: FormField,
  table: ContinuationTable,
  cursor: SheetCursor,
  layout: { margin: number; width: number; newPage(): SheetCursor },
): SheetCursor {
  const { font, bold, encode } = deps;
  const size = 8.5;
  const lh = lineHeight(font, size);
  const pad = 3;
  let { page, y } = cursor;
  const heading = encode(continuationHeading(field));
  if (y - lh * 5 < layout.margin) ({ page, y } = layout.newPage());
  y = drawWrappedHeading(page, heading, bold, layout.margin, y, layout.width);
  y -= lh * 1.3;
  const beyond = table.rows.filter((r) => r.n > table.capacity).length;
  const note =
    beyond === table.rows.length
      ? `Rows ${table.capacity + 1} onwards – the table on the form has ${table.capacity} rows.`
      : beyond > 0
        ? `Rows shortened on the form, in full, and rows ${table.capacity + 1} onwards (the table on the form has ${table.capacity} rows).`
        : "Rows shortened on the form, in full.";
  page.drawText(encode(note), { x: layout.margin, y, size: 8, font, color: rgb(0.38, 0.42, 0.48) });
  y -= lh * 1.4;

  // Column widths: a narrow "Row" column; each other column at least as wide as its longest word or
  // date (never broken), the rest shared by content length.
  const numberWidth = 28;
  const avail = layout.width - numberWidth;
  const words = (t: string) => encode(t).split(/\s+/).filter(Boolean);
  const widest = (texts: string[], f: PDFFont) => Math.max(0, ...texts.flatMap(words).map((w) => f.widthOfTextAtSize(w, size) + 2 * pad + 1));
  const mins = table.columns.map((c) =>
    Math.min(avail / table.columns.length, Math.max(24, widest([c.header], bold), widest(table.rows.map((r) => r.cells[c.key] ?? ""), font))),
  );
  const wants = table.columns.map((c, i) =>
    Math.max(mins[i], Math.min(220, Math.max(font.widthOfTextAtSize(encode(c.header), size) * 0.55, ...table.rows.map((r) => font.widthOfTextAtSize(encode(r.cells[c.key] ?? ""), size) + 2 * pad + 1)))),
  );
  const minTotal = mins.reduce((a, b) => a + b, 0);
  const extraWant = wants.reduce((a, w, i) => a + (w - mins[i]), 0);
  const spare = Math.max(0, avail - minTotal);
  const widths = mins.map((m, i) => (extraWant > 0 ? m + (spare * (wants[i] - m)) / extraWant : m + spare / mins.length));
  const xs: number[] = [layout.margin + numberWidth];
  widths.forEach((w, i) => xs.push(xs[i] + w));
  const border = rgb(0.75, 0.78, 0.82);

  const drawRow = (cells: string[], f: PDFFont): void => {
    const wrapped = cells.map((text, i) => {
      const width = (i === 0 ? numberWidth : widths[i - 1]) - 2 * pad;
      return wrapLines(encode(text), f, size, width);
    });
    const lines = Math.max(1, ...wrapped.map((w) => w.length));
    const height = lines * lh + 2 * pad;
    if (y - height < layout.margin) {
      ({ page, y } = layout.newPage());
      drawHeader();
    }
    const left = layout.margin;
    const right = xs[xs.length - 1];
    page.drawRectangle({ x: left, y: y - height, width: right - left, height, borderColor: border, borderWidth: 0.6 });
    [layout.margin + numberWidth, ...xs.slice(1, -1)].forEach((x) => page.drawLine({ start: { x, y }, end: { x, y: y - height }, thickness: 0.6, color: border }));
    wrapped.forEach((cellLines, i) => {
      const x = (i === 0 ? layout.margin : xs[i - 1]) + pad;
      let ty = y - pad - size;
      for (const line of cellLines) {
        if (line) page.drawText(line, { x, y: ty, size, font: f, color: f === bold ? rgb(0.1, 0.12, 0.2) : ANSWER_COLOR });
        ty -= lh;
      }
    });
    y -= height;
  };
  const drawHeader = () => drawRow(["Row", ...table.columns.map((c) => c.header)], bold);

  drawHeader();
  for (const r of table.rows) drawRow([`${r.n}${r.shortened ? "*" : ""}`, ...table.columns.map((c) => r.cells[c.key] ?? "")], font);
  if (table.rows.some((r) => r.shortened)) {
    y -= lh;
    if (y < layout.margin) ({ page, y } = layout.newPage());
    page.drawText(encode("* shortened on the form – shown here in full."), { x: layout.margin, y, size: 8, font, color: rgb(0.38, 0.42, 0.48) });
  }
  return { page, y: y - lh };
}

/** Greedy wrap that also breaks words wider than the cell. */
function wrapLines(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    let rest = word;
    while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
      let n = rest.length - 1;
      while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n -= 1;
      lines.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}
