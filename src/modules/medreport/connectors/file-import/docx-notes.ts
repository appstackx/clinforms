import "server-only";

/**
 * Notes written or saved as a Word document (.docx) → text for the notes reader (production wave 3).
 *
 * Reads the document body in order with the forms engine's Word helpers (forms/docx-dom.ts): every paragraph
 * is one line of text (line breaks inside a paragraph become new lines), every table becomes a table block
 * (one row of cells per table row; a cell's paragraphs joined with line breaks), and content controls are
 * read through. Headers, footers, comments and tracked deletions are not read. Nothing is rendered.
 *
 * Owner: integration agent.
 */
import { HttpError } from "../../api/http";
import { MAX_FORM_FILE_BYTES } from "../../config.public";
import { childElements, firstW, isW, loadDocxDom, paragraphText, wChildren, type XmlElement } from "../../forms/docx-dom";
import type { NotesBlock } from "./general-notes";
import { ImportError } from "./parser";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** w:p and w:tbl children of a container, reading through content controls and custom XML. */
function blockChildren(container: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  for (const child of childElements(container)) {
    if (child.namespaceURI !== W_NS) continue;
    if (child.localName === "p" || child.localName === "tbl") out.push(child);
    else if (child.localName === "sdt") {
      const content = firstW(child, "sdtContent");
      if (content) out.push(...blockChildren(content));
    } else if (child.localName === "customXml" || child.localName === "ins") out.push(...blockChildren(child));
  }
  return out;
}

function rowsOf(tbl: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  for (const child of childElements(tbl)) {
    if (isW(child, "tr")) out.push(child);
    else if (isW(child, "sdt")) {
      const content = firstW(child, "sdtContent");
      if (content) out.push(...wChildren(content, "tr"));
    }
  }
  return out;
}

function cellText(tc: XmlElement): string {
  return blockChildren(tc)
    .map((el) => (isW(el, "p") ? paragraphText(el) : rowsOf(el).map((r) => wChildren(r, "tc").map(cellText).join(" | ")).join("\n")))
    .join("\n")
    .replace(/ /g, " ")
    .trim();
}

/** The document's text as blocks ("paragraph N" / "table N"), and as plain text (tables as " | " rows). */
export function docxNotesToBlocks(base64: string): { blocks: NotesBlock[]; text: string } {
  const bytes = new Uint8Array(Buffer.from(base64.replace(/^data:[^,]*,/, ""), "base64"));
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new ImportError([{ where: "file", message: "This is not a Word document (.docx). Save the notes as .docx, PDF or text and upload that file." }]);
  }
  if (bytes.byteLength > MAX_FORM_FILE_BYTES) {
    throw new ImportError([{ where: "file", message: `The Word document is larger than ${(MAX_FORM_FILE_BYTES / (1024 * 1024)).toFixed(1)} MB.` }]);
  }
  let body: XmlElement;
  try {
    body = loadDocxDom(bytes).body;
  } catch (err) {
    if (err instanceof HttpError) {
      throw new ImportError([{ where: "file", message: "This Word document could not be read. Open it in Word, save it again as .docx and upload it." }]);
    }
    throw err;
  }
  const blocks: NotesBlock[] = [];
  const text: string[] = [];
  let p = 0;
  let t = 0;
  for (const el of blockChildren(body)) {
    if (isW(el, "p")) {
      p += 1;
      const lines = paragraphText(el).replace(/ /g, " ").split(/\r?\n|\u000b/);
      for (const line of lines) {
        blocks.push({ kind: "line", text: line.replace(/\s+$/, ""), where: `paragraph ${p}` });
        text.push(line.replace(/\s+$/, ""));
      }
    } else {
      t += 1;
      const rows = rowsOf(el).map((r) => wChildren(r, "tc").map(cellText));
      blocks.push({ kind: "table", rows, where: `table ${t}, row 1` });
      rows.forEach((cells) => text.push(cells.filter(Boolean).join(" | ")));
    }
  }
  return { blocks, text: `${text.join("\n")}\n` };
}
