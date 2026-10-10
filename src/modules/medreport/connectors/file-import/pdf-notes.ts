import "server-only";

/**
 * Printed notes (PDF) → the pasted-notes text format (./format.ts, format "text").
 *
 * Clinic systems can print or save a patient's clinical notes as a PDF. When that PDF has a text layer
 * laid out as a notes report – "Key: value" patient lines at the top, then one note per dated heading
 * ("18/03/2026 09:00 – Initial assessment – Sarah Reid (PH-DEMO-01)") with labelled S/O/A/P lines – the
 * text is extracted (pdfjs, no rendering), lines are rebuilt from the positioned text, wrapped lines are
 * joined back to the label they continue, page furniture (page numbers, running headers/footers) is
 * dropped, and the result is parsed exactly like pasted notes.
 *
 * A scanned PDF (no text layer) is refused with a plain-English message; OCR is out of scope here.
 *
 * Owner: integration agent.
 */
import { MAX_FORM_FILE_BYTES } from "../../config.public";
import { loadPdfjs, pdfjsDocumentParams } from "../../forms/pdfjs";
import { ZipLimitError, assertPdfWithinLimits } from "../../forms/zip-guard";
import type { NotesBlock } from "./general-notes";
import { ImportError } from "./parser";

interface Item {
  str: string;
  x: number;
  y: number;
  w: number;
}

/** Lines of one page, top to bottom; items within ~3 pt vertically form one line. */
function pageLines(items: Item[]): string[] {
  const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Item[][] = [];
  for (const it of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0].y - it.y) <= 3) line.push(it);
    else lines.push([it]);
  }
  return lines.map((line) => {
    const parts = line.sort((a, b) => a.x - b.x);
    let out = "";
    let end = -Infinity;
    for (const p of parts) {
      const gap = p.x - end;
      out += out && gap > 1.5 && !out.endsWith(" ") && !p.str.startsWith(" ") ? ` ${p.str}` : p.str;
      end = p.x + p.w;
    }
    return out.replace(/\s+/g, " ").trim();
  });
}

const DATE_HEADING = /^\s*(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4})\b/;
const LABELLED = /^\s*(?:S|O|A|P|Subjective|Objective|Assessment|Plan|PMH|Past medical history|SH|Social history|Outcome measures?|Outcomes?|Scores?)\s*[:\-–]/i;
const HEADER_KEY = /^\s*[A-Z][A-Za-z ]{1,30}:\s/;
const FURNITURE = /^(?:page \d+(?: of \d+)?|\d+\s*\/\s*\d+|continued(?: overleaf)?\.?)$/i;

/**
 * A line as a running header or footer prints it on every page: page numbers ("Page 2 of 3", "2/3", "2 of 3")
 * become "#", so "Printed … by A. Okafor  Page 1 of 3" and "… Page 2 of 3" are the same line (fix wave 3).
 */
function furnitureKey(line: string): string {
  if (line.length > 300) return line;
  return line
    .replace(/\bpage\s*\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?\b/gi, "page #")
    .replace(/(^|\s)\d{1,4}\s*(?:of|\/)\s*\d{1,4}$/i, "$1#");
}

const EDGE_LINES = 3;

/**
 * Lines printed at the top or bottom of every page (running headers and footers), by furnitureKey. Only the
 * first and last three lines of a page count, and only there is a line dropped: a note's own line that happens
 * to appear on every page ("Status: Attended") is not furniture.
 */
function runningLines(pages: string[][]): { top: Set<string>; bottom: Set<string> } {
  if (pages.length < 2) return { top: new Set(), bottom: new Set() };
  const tops = pages.map((lines) => new Set(lines.slice(0, EDGE_LINES).map(furnitureKey)));
  const bottoms = pages.map((lines) => new Set(lines.slice(-EDGE_LINES).map(furnitureKey)));
  const everywhere = (sets: Array<Set<string>>, others: Array<Set<string>>) =>
    new Set(Array.from(new Set(sets.flatMap((x) => Array.from(x)))).filter((k) => sets.every((x, i) => x.has(k) || others[i].has(k))));
  return { top: everywhere(tops, bottoms), bottom: everywhere(bottoms, tops) };
}

/** Whether line `i` of a page (of `count` lines) is in its top or bottom edge and printed on every page. */
function isRunning(running: { top: Set<string>; bottom: Set<string> }, line: string, i: number, count: number): "top" | "bottom" | null {
  const key = furnitureKey(line);
  if (i < EDGE_LINES && (running.top.has(key) || running.bottom.has(key))) return "top";
  if (i >= count - EDGE_LINES && (running.bottom.has(key) || running.top.has(key))) return "bottom";
  return null;
}

/** Join wrapped lines to the labelled line they continue; drop page furniture and repeated headers. */
export function rebuildNotesText(pages: string[][]): string {
  // A line printed on every page (running header or footer) is page furniture.
  const running = runningLines(pages);

  const out: string[] = [];
  let started = false;
  for (const lines of pages) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || FURNITURE.test(line) || isRunning(running, line, i, lines.length)) continue;
      // The report's own title lines (before the first "Key: value" or dated note) are not data.
      if (!started && !(DATE_HEADING.test(line) || HEADER_KEY.test(line))) continue;
      started = true;
      const starts = DATE_HEADING.test(line) || LABELLED.test(line) || HEADER_KEY.test(line);
      if (!starts && out.length > 0 && out[out.length - 1] !== "") out[out.length - 1] = `${out[out.length - 1]} ${line}`;
      else {
        if (DATE_HEADING.test(line) && out.length > 0 && out[out.length - 1] !== "") out.push("");
        out.push(line);
      }
    }
  }
  return `${out.join("\n").trim()}\n`;
}

/**
 * The pages' lines for the general notes reader (wave 3): page numbers and lines printed at the top or bottom of
 * every page (running headers and footers, page numbers aside) are dropped – except that a repeated "Label: value"
 * line in the HEADER of the first page (the patient's details in a running header) is kept once. A running FOOTER
 * is always dropped (fix wave 3: "Patient: <name> (<number>) CONFIDENTIAL…" and "Printed … Page 1 of 3" must never
 * become part of a note). Lines are NOT joined: each note keeps its printed lines.
 */
export function pdfPagesToBlocks(pages: string[][]): NotesBlock[] {
  const running = runningLines(pages);
  const blocks: NotesBlock[] = [];
  pages.forEach((lines, p) => {
    lines.forEach((line, i) => {
      if (!line || FURNITURE.test(line)) return;
      const edge = isRunning(running, line, i, lines.length);
      if (edge && !(edge === "top" && p === 0 && HEADER_KEY.test(line))) return;
      blocks.push({ kind: "line", text: line, where: `page ${p + 1}`, ...(/^\s*[•◦▪‣]\s+\S/.test(line.slice(0, 8)) ? { bullet: true } : {}) });
    });
  });
  return blocks;
}

/** Text of a printed-notes PDF, in the pasted-notes format. Throws ImportError with plain-English issues. */
export async function printedNotesToText(base64: string): Promise<{ text: string; pages: number }> {
  const read = await readPrintedNotes(base64);
  return { text: read.text, pages: read.pages };
}

/** A printed-notes PDF read once: the pasted-notes text (strict format) and the raw page lines (general reader). */
export async function readPrintedNotes(base64: string): Promise<{ text: string; pages: number; pageLines: string[][] }> {
  const bytes = new Uint8Array(Buffer.from(base64.replace(/^data:[^,]*,/, ""), "base64"));
  if (bytes.byteLength === 0 || Buffer.from(bytes.subarray(0, 1024)).indexOf("%PDF-", 0, "latin1") < 0) {
    throw new ImportError([{ where: "file", message: "This is not a PDF file." }]);
  }
  if (bytes.byteLength > MAX_FORM_FILE_BYTES) {
    throw new ImportError([{ where: "file", message: `The PDF is larger than ${(MAX_FORM_FILE_BYTES / (1024 * 1024)).toFixed(1)} MB.` }]);
  }
  try {
    assertPdfWithinLimits(bytes);
  } catch (err) {
    if (err instanceof ZipLimitError) throw new ImportError([{ where: "file", message: err.message }]);
    throw err;
  }
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument(pdfjsDocumentParams(bytes));
  const pages: string[][] = [];
  try {
    const pdf = await task.promise;
    for (let n = 1; n <= pdf.numPages && n <= 200; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const items: Item[] = [];
      for (const raw of content.items) {
        if (!("str" in raw) || !raw.str.trim()) continue;
        const t = raw.transform as number[];
        items.push({ str: raw.str, x: t[4], y: t[5], w: raw.width });
      }
      pages.push(pageLines(items));
    }
  } catch {
    throw new ImportError([{ where: "file", message: "The PDF could not be read. Save the notes as a PDF from the clinic system again and upload that file." }]);
  } finally {
    await task.destroy();
  }
  // A scan has no text layer at all (a notes PDF in another layout still has text: the general reader takes it).
  const printed = pages.reduce((n, lines) => n + lines.join("").replace(/\s+/g, "").length, 0);
  if (printed < 20) {
    throw new ImportError([
      {
        where: "file",
        message:
          "This PDF has no readable text (it may be a scan or a photo), and scanned notes cannot be read. Print or save the notes as a PDF from the clinic system, or paste the notes as text.",
      },
    ]);
  }
  return { text: rebuildNotesText(pages), pages: pages.length, pageLines: pages };
}
