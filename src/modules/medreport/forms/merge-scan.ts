import "server-only";

/**
 * Mail-merge fields in a referrer's form file (10/2026; the rules are in core/merge-fields.ts).
 *
 * findFormMergeFields(file)  – at analysis (POST /forms/analyse): every «Name» / <<Name>> / MERGEFIELD in
 *   the file, recorded on the map (FormAnalysis.mergeFields): Word body text by block ID (an answered
 *   question replacing it clears it); page headers and footers, text boxes and Word field codes as
 *   `fixed` (they cannot be completed here); a fillable PDF's field values by field name; text printed
 *   on a PDF page as `fixed`.
 * mergeTokensInOutput(bytes, kind) – at render: the merge fields still in a COMPLETED file (Word: body,
 *   text boxes, field codes, headers and footers; PDF: the page text of the flattened file). A final copy
 *   with any is refused (forms/render-form.ts).
 *
 * Deleted (tracked) text is ignored. Never throws for an unreadable part: what cannot be read is not scanned.
 */
import { PDFDocument, PDFTextField } from "pdf-lib";
import { findMergeTokens } from "../core/merge-fields";
import type { FormMergeField } from "../core/types";
import { buildDocxOutline } from "./docx-outline";
import { DOCX_MIME, PDF_MIME, type DecodedFormFile } from "./file";
import { loadPdfjs, pdfjsDocumentParams } from "./pdfjs";
import { openZipSafely } from "./zip-guard";

/** Most entries recorded for one form (one per occurrence). */
const MAX_ENTRIES = 500;

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Visible text of a WordprocessingML part: paragraphs on their own lines; no deleted text, no field codes. */
function visibleText(xml: string): string {
  return decodeEntities(
    xml
      .replace(/<w:delText\b[^>]*>[\s\S]*?<\/w:delText>/g, "")
      .replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, "")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:(?:tab|br|cr)\b[^>]*\/>/g, " ")
      .replace(/<[^>]+>/g, ""),
  );
}

/** Field codes (complex and simple fields) of a part, joined. */
function fieldCodes(xml: string): string {
  const out: string[] = [];
  const re = /<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>|<w:fldSimple\b[^>]*\bw:instr="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(decodeEntities(m[1] ?? m[2] ?? ""));
  return out.join("");
}

function textBoxes(xml: string): string {
  const out: string[] = [];
  const re = /<w:txbxContent\b[^>]*>([\s\S]*?)<\/w:txbxContent>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(visibleText(m[1]));
  return out.join("\n");
}

interface DocxParts {
  document: string;
  headers: string[];
  footers: string[];
}

function docxParts(bytes: Uint8Array): DocxParts | null {
  try {
    const zip = openZipSafely(bytes);
    const read = (name: string) => zip.file(name)?.asText() ?? "";
    const names = Object.keys(zip.files).sort();
    return {
      document: read("word/document.xml"),
      headers: names.filter((n) => /^word\/header\d*\.xml$/.test(n)).map(read),
      footers: names.filter((n) => /^word\/footer\d*\.xml$/.test(n)).map(read),
    };
  } catch {
    return null;
  }
}

/** "table 1, row 3" / "paragraph 12" for a block ID (t/r 0-based in the ID, 1-based in words). */
function describeBlock(id: string): string {
  const cell = /^t(\d+)\.r(\d+)\.c(\d+)/.exec(id);
  if (cell) return `table ${Number(cell[1]) + 1}, row ${Number(cell[2]) + 1}`;
  const p = /^p(\d+)$/.exec(id);
  return p ? `paragraph ${Number(p[1]) + 1}` : id;
}

async function pdfPageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument(pdfjsDocumentParams(bytes));
  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      pages.push(content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : "")).join(""));
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

/** The merge fields in a referrer's form file, for the map (see the file comment). */
export async function findFormMergeFields(file: Pick<DecodedFormFile, "bytes" | "mimeType">): Promise<FormMergeField[]> {
  const out: FormMergeField[] = [];
  const add = (e: FormMergeField) => {
    if (out.length < MAX_ENTRIES) out.push(e);
  };
  if (file.mimeType === DOCX_MIME) {
    const parts = docxParts(file.bytes);
    if (!parts) return out;
    // Body text by block: a cell, or a paragraph outside tables (a cell's own paragraphs are inside the cell).
    if (parts.document && findMergeTokens(visibleText(parts.document)).length > 0) {
      try {
        for (const block of buildDocxOutline(file.bytes).blocks) {
          if (block.kind === "paragraph" && /\.p\d+$/.test(block.id)) continue;
          for (const text of findMergeTokens(block.text)) add({ text, where: describeBlock(block.id), blockId: block.id });
        }
      } catch {
        // Unreadable here: the final render's scan still applies.
      }
    }
    for (const text of findMergeTokens(textBoxes(parts.document))) add({ text, where: "a text box", fixed: true });
    for (const text of findMergeTokens(fieldCodes(parts.document)).filter((t) => t === "MERGEFIELD")) add({ text, where: "a Word field code", fixed: true });
    for (const xml of parts.headers) for (const text of findMergeTokens(`${visibleText(xml)}\n${fieldCodes(xml)}`)) add({ text, where: "the page header", fixed: true });
    for (const xml of parts.footers) for (const text of findMergeTokens(`${visibleText(xml)}\n${fieldCodes(xml)}`)) add({ text, where: "the page footer", fixed: true });
    return out;
  }
  if (file.mimeType === PDF_MIME) {
    try {
      (await pdfPageTexts(file.bytes)).forEach((page, i) => {
        for (const text of findMergeTokens(page)) add({ text, where: `page ${i + 1}`, fixed: true });
      });
    } catch {
      // Unreadable here: the final render's scan still applies.
    }
    try {
      const doc = await PDFDocument.load(file.bytes, { ignoreEncryption: true, updateMetadata: false });
      for (const field of doc.getForm().getFields()) {
        if (!(field instanceof PDFTextField)) continue;
        const value = field.getText() ?? "";
        for (const text of findMergeTokens(value)) add({ text, where: `the form field “${field.getName()}”`.slice(0, 120), fieldName: field.getName() });
      }
    } catch {
      // No readable AcroForm.
    }
  }
  return out;
}

/** The merge fields still in a completed file (Word or flattened PDF). */
export async function mergeTokensInOutput(bytes: Uint8Array, kind: "docx" | "pdf"): Promise<string[]> {
  if (kind === "docx") {
    const parts = docxParts(bytes);
    if (!parts) return [];
    const all = [parts.document, ...parts.headers, ...parts.footers];
    return all.flatMap((xml) => findMergeTokens(`${visibleText(xml)}\n${fieldCodes(xml)}`));
  }
  try {
    return (await pdfPageTexts(bytes)).flatMap((page) => findMergeTokens(page));
  } catch {
    return [];
  }
}
