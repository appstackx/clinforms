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

/** Join wrapped lines to the labelled line they continue; drop page furniture and repeated headers. */
export function rebuildNotesText(pages: string[][]): string {
  // A line printed on every page (running header or footer) is page furniture.
  const seen = new Map<string, number>();
  for (const lines of pages) Array.from(new Set(lines)).forEach((l) => seen.set(l, (seen.get(l) ?? 0) + 1));
  const repeated = new Set(pages.length > 1 ? Array.from(seen.entries()).filter(([, n]) => n === pages.length).map(([l]) => l) : []);

  const out: string[] = [];
  let started = false;
  for (const lines of pages) {
    for (const line of lines) {
      if (!line || FURNITURE.test(line) || repeated.has(line)) continue;
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

/** Text of a printed-notes PDF, in the pasted-notes format. Throws ImportError with plain-English issues. */
export async function printedNotesToText(base64: string): Promise<{ text: string; pages: number }> {
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
  const text = rebuildNotesText(pages);
  if (text.trim().length < 20) {
    throw new ImportError([
      {
        where: "file",
        message: "This PDF has no readable text (it may be a scan or a photo). Print or save the notes as a PDF from the clinic system, or upload a CSV or JSON export.",
      },
    ]);
  }
  return { text, pages: pages.length };
}
