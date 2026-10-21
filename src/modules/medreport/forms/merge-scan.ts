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

/** A character reference's code point as text; "" for one no string can hold (e.g. &#x110000;). */
function codePoint(n: number): string {
  return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => codePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

interface ElementRange {
  /** Where the start tag begins. */
  start: number;
  /** The start tag (with its attributes). */
  tag: string;
  /** The content between the start and end tag ("" for `<name …/>`). */
  inner: string;
  /** Just after the end tag. */
  end: number;
}

/**
 * The `<name …>…</name>` (and `<name …/>`) elements of a part, in order, not nested – in ONE linear pass
 * (indexOf, never a lazy `[\s\S]*?` regex): a part (headers and footers are not parsed as XML first) full
 * of unclosed or self-closing tags cannot make the scan quadratic. `withContent: false` only reads start
 * tags (e.g. w:fldSimple, whose instruction is an attribute).
 */
function elements(xml: string, name: string, withContent = true): ElementRange[] {
  const out: ElementRange[] = [];
  const open = `<${name}`;
  const close = `</${name}>`;
  let i = 0;
  while ((i = xml.indexOf(open, i)) >= 0) {
    let j = i + open.length;
    const next = xml.charCodeAt(j);
    // The name must end here ("<w:t" is not "<w:tab").
    if (!(next === 0x20 || next === 0x09 || next === 0x0a || next === 0x0d || next === 0x2f || next === 0x3e)) {
      i = j;
      continue;
    }
    while (j < xml.length && xml.charCodeAt(j) !== 0x3e && xml.charCodeAt(j) !== 0x3c) j++;
    if (j >= xml.length) break; // a start tag that never ends: nothing more to read
    if (xml.charCodeAt(j) === 0x3c) {
      i = j; // malformed (a "<" inside the tag): carry on from there
      continue;
    }
    const tag = xml.slice(i, j + 1);
    if (!withContent || xml.charCodeAt(j - 1) === 0x2f) {
      out.push({ start: i, tag, inner: "", end: j + 1 });
      i = j + 1;
      continue;
    }
    const c = xml.indexOf(close, j + 1);
    if (c < 0) break; // never closed: there is no complete element after this one either
    out.push({ start: i, tag, inner: xml.slice(j + 1, c), end: c + close.length });
    i = c + close.length;
  }
  return out;
}

/** The part without these elements. */
function withoutElements(xml: string, name: string): string {
  const found = elements(xml, name);
  if (found.length === 0) return xml;
  let out = "";
  let pos = 0;
  for (const e of found) {
    out += xml.slice(pos, e.start);
    pos = e.end;
  }
  return out + xml.slice(pos);
}

/** Visible text of a WordprocessingML part: paragraphs on their own lines; no deleted text, no field codes. */
function visibleText(xml: string): string {
  // `[^<>]` (not `[^>]`) so a run of start tags without a ">" is read once, not once per tag (linear).
  return decodeEntities(
    withoutElements(withoutElements(xml, "w:delText"), "w:instrText")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:(?:tab|br|cr)\b[^<>]*\/>/g, " ")
      .replace(/<[^<>]+>/g, ""),
  );
}

/** Field codes (complex and simple fields) of a part, joined, in document order. */
function fieldCodes(xml: string): string {
  const codes: Array<{ at: number; text: string }> = elements(xml, "w:instrText").map((e) => ({ at: e.start, text: e.inner }));
  for (const e of elements(xml, "w:fldSimple", false)) {
    const m = /\bw:instr="([^"]*)"/.exec(e.tag);
    if (m) codes.push({ at: e.start, text: m[1] });
  }
  codes.sort((a, b) => a.at - b.at);
  return codes.map((c) => decodeEntities(c.text)).join("");
}

function textBoxes(xml: string): string {
  return elements(xml, "w:txbxContent")
    .map((e) => visibleText(e.inner))
    .join("\n");
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
