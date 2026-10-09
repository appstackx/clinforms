import "server-only";

/**
 * Shared Word (WordprocessingML) DOM helpers for the forms engine: loading/saving word/document.xml with
 * @xmldom/xmldom, the ONE block traversal both the outline (docx-outline.ts) and the fill
 * (docx-fill.ts) use – so a block ID always means the same element – and paragraph "segments" (the
 * visible characters of a paragraph mapped back to the XML that holds them, across runs, hyperlinks,
 * content controls and legacy form fields).
 *
 * Block IDs (core/forms.ts formatParagraphBlockId / formatCellBlockId), all 0-based in document order:
 *   "p<n>"                    body paragraph n (paragraphs inside block-level content controls count)
 *   "t<n>.r<n>.c<n>"          top-level table n, row n, cell n
 *   "<cell>.p<n>"             paragraph n of a cell
 *   "<cell>.t<n>.r<n>.c<n>"   nested table n inside that cell
 * Our own DRAFT banner paragraph is skipped, so a filled DRAFT re-outlines with the original IDs.
 *
 * Owner: forms-engine agent.
 */
import { DOMParser, XMLSerializer, type Document as XmlDocument, type Element as XmlElement, type Node as XmlNode } from "@xmldom/xmldom";
import PizZip from "pizzip";
import { HttpError } from "../api/http";
import { formatCellBlockId, formatParagraphBlockId, type CellRef } from "../core/forms";
import { ZipLimitError, openZipSafely } from "./zip-guard";

export type { XmlDocument, XmlElement, XmlNode };

export const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const W14_NS = "http://schemas.microsoft.com/office/word/2010/wordml";
export const XML_NS = "http://www.w3.org/XML/1998/namespace";
const DOCUMENT_PART = "word/document.xml";

/** Bookmark name that marks our DRAFT banner paragraph (skipped by the traversal). */
export const DRAFT_BANNER_BOOKMARK = "AppStackX_DraftBanner";

/* ------------------------------------------------------------------------------------------------
 * Element helpers
 * ----------------------------------------------------------------------------------------------*/

export function isElement(node: XmlNode | null | undefined): node is XmlElement {
  return !!node && node.nodeType === 1;
}

/** True for a WordprocessingML element with this local name. */
export function isW(node: XmlNode | null | undefined, local: string): node is XmlElement {
  return isElement(node) && node.localName === local && node.namespaceURI === W_NS;
}

export function childElements(el: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (isElement(n)) out.push(n);
  return out;
}

export function wChildren(el: XmlElement, local: string): XmlElement[] {
  return childElements(el).filter((c) => c.localName === local && c.namespaceURI === W_NS);
}

export function firstW(el: XmlElement | null | undefined, local: string): XmlElement | null {
  if (!el) return null;
  for (let n = el.firstChild; n; n = n.nextSibling) if (isW(n, local)) return n;
  return null;
}

/** All descendant W elements with this local name, in document order. */
export function descendantsW(el: XmlElement, local: string): XmlElement[] {
  const out: XmlElement[] = [];
  const list = el.getElementsByTagNameNS(W_NS, local);
  for (let i = 0; i < list.length; i++) {
    const item = list.item(i);
    if (item) out.push(item);
  }
  return out;
}

export function wAttr(el: XmlElement | null | undefined, local: string): string | null {
  if (!el) return null;
  return el.getAttributeNS(W_NS, local) ?? el.getAttribute(`w:${local}`);
}

export function ancestorW(node: XmlNode, local: string, stopAt?: XmlNode): XmlElement | null {
  for (let n = node.parentNode; n && n !== stopAt; n = n.parentNode) if (isW(n, local)) return n;
  return null;
}

export function textOf(el: XmlElement): string {
  return el.textContent ?? "";
}

/** Characters XML 1.0 cannot hold (C0 controls except tab, LF, CR) – removed from anything we write. */
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function cleanXmlText(text: string): string {
  return text.replace(INVALID_XML_CHARS, "");
}

/* ------------------------------------------------------------------------------------------------
 * Loading and saving
 * ----------------------------------------------------------------------------------------------*/

export interface StyleInfo {
  name: string;
  /** 1-based heading level (from w:outlineLvl or a "heading N" name). */
  headingLevel?: number;
}

export interface DocxDom {
  zip: PizZip;
  doc: XmlDocument;
  body: XmlElement;
  /** Prefix bound to the WordprocessingML namespace in document.xml (almost always "w"). */
  prefix: string;
  /** Paragraph styles by style ID. */
  styles: Map<string, StyleInfo>;
}

function invalid(detail: string): HttpError {
  return new HttpError(422, "This Word file could not be read", { code: "FORM_INVALID", detail });
}

function parseXml(xml: string): XmlDocument {
  return new DOMParser({
    onError: (level, message) => {
      if (level === "fatalError") throw new Error(message);
    },
  }).parseFromString(xml, "application/xml");
}

function readStyles(zip: PizZip): Map<string, StyleInfo> {
  const styles = new Map<string, StyleInfo>();
  const xml = zip.file("word/styles.xml")?.asText();
  if (!xml) return styles;
  let doc: XmlDocument;
  try {
    doc = parseXml(xml);
  } catch {
    return styles;
  }
  const list = doc.getElementsByTagNameNS(W_NS, "style");
  for (let i = 0; i < list.length; i++) {
    const style = list.item(i);
    if (!style || wAttr(style, "type") !== "paragraph") continue;
    const id = wAttr(style, "styleId");
    if (!id) continue;
    const name = wAttr(firstW(style, "name"), "val") ?? id;
    const outline = wAttr(firstW(firstW(style, "pPr"), "outlineLvl"), "val");
    const byName = /^heading\s*(\d)$/i.exec(name) ?? /^Heading(\d)$/.exec(id);
    const level = outline !== null && /^\d$/.test(outline) && Number(outline) < 9 ? Number(outline) + 1 : byName ? Number(byName[1]) : undefined;
    styles.set(id, { name: name.replace(/^heading\s*(\d)$/i, "Heading $1"), ...(level !== undefined && { headingLevel: level }) });
  }
  return styles;
}

/** Open a .docx for reading/writing its body. Throws 422 FORM_INVALID when it is not a readable Word file. */
export function loadDocxDom(buf: Uint8Array): DocxDom {
  let zip: PizZip;
  try {
    zip = openZipSafely(buf);
  } catch (err) {
    if (err instanceof ZipLimitError) throw invalid(`${err.message} Upload the referrer's form as an ordinary Word file.`);
    throw invalid("The file is not a valid .docx (it could not be opened as a Word document).");
  }
  const xml = zip.file(DOCUMENT_PART)?.asText();
  if (!xml) throw invalid("The file has no Word document body (word/document.xml).");
  let doc: XmlDocument;
  try {
    doc = parseXml(xml);
  } catch {
    throw invalid("The Word document body could not be read. Open the form in Word, save it again as .docx and re-upload it.");
  }
  const root = doc.documentElement;
  const body = root ? firstW(root, "body") : null;
  if (!root || !body) throw invalid("The Word document has no body.");
  return { zip, doc, body, prefix: body.prefix || "w", styles: readStyles(zip) };
}

/** Write the (modified) body back into the package. Only word/document.xml changes. */
export function saveDocxDom(dom: DocxDom): Buffer {
  const xml = new XMLSerializer().serializeToString(dom.doc);
  dom.zip.file(DOCUMENT_PART, xml);
  return dom.zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Create a W element (w:<local>) with optional w:attributes. */
export function wEl(dom: Pick<DocxDom, "doc" | "prefix">, local: string, attrs: Record<string, string> = {}): XmlElement {
  const el = dom.doc.createElementNS(W_NS, `${dom.prefix}:${local}`);
  for (const [k, v] of Object.entries(attrs)) el.setAttributeNS(W_NS, `${dom.prefix}:${k}`, v);
  return el;
}

export function setWAttr(dom: Pick<DocxDom, "prefix">, el: XmlElement, local: string, value: string): void {
  if (el.hasAttributeNS(W_NS, local)) el.setAttributeNS(W_NS, el.getAttributeNodeNS(W_NS, local)?.name ?? `${dom.prefix}:${local}`, value);
  else el.setAttributeNS(W_NS, `${dom.prefix}:${local}`, value);
}

/* ------------------------------------------------------------------------------------------------
 * Block traversal (shared by outline and fill)
 * ----------------------------------------------------------------------------------------------*/

export interface ParagraphRef {
  kind: "paragraph";
  id: string;
  el: XmlElement;
  /** Inside a block-level content control. */
  inSdt: boolean;
  /** Set for paragraphs inside a table cell. */
  cellPath?: CellRef[];
}

export interface CellRef2 {
  kind: "cell";
  id: string;
  el: XmlElement;
  path: CellRef[];
  /** The cell's own paragraphs (not those of nested tables), in order. */
  paragraphs: XmlElement[];
  inSdt: boolean;
  hasNestedTables: boolean;
}

export type BlockRef = ParagraphRef | CellRef2;

export interface BlockIndex {
  /** Every block in document order (cells before their own paragraphs and nested tables). */
  blocks: BlockRef[];
  byId: Map<string, BlockRef>;
  /** Number of top-level tables and body paragraphs. */
  tables: number;
  paragraphs: number;
  textBoxes: number;
}

function isDraftBanner(p: XmlElement): boolean {
  return wChildren(p, "bookmarkStart").some((b) => wAttr(b, "name") === DRAFT_BANNER_BOOKMARK);
}

interface ContentItem {
  el: XmlElement;
  inSdt: boolean;
}

/** w:p / w:tbl children of a container in order, flattening block-level content controls and custom XML. */
function contentItems(container: XmlElement, inSdt = false): ContentItem[] {
  const out: ContentItem[] = [];
  for (const child of childElements(container)) {
    if (child.namespaceURI !== W_NS) continue;
    if (child.localName === "p" || child.localName === "tbl") out.push({ el: child, inSdt });
    else if (child.localName === "sdt") {
      const content = firstW(child, "sdtContent");
      if (content) out.push(...contentItems(content, true));
    } else if (child.localName === "customXml" || child.localName === "ins" || child.localName === "moveTo") {
      out.push(...contentItems(child, inSdt));
    }
  }
  return out;
}

/** Elements of a given W name among the children, flattening sdt / customXml wrappers (rows, cells). */
function wrappedChildren(container: XmlElement, local: string, inSdt = false): ContentItem[] {
  const out: ContentItem[] = [];
  for (const child of childElements(container)) {
    if (child.namespaceURI !== W_NS) continue;
    if (child.localName === local) out.push({ el: child, inSdt });
    else if (child.localName === "sdt") {
      const content = firstW(child, "sdtContent");
      if (content) out.push(...wrappedChildren(content, local, true));
    } else if (child.localName === "customXml") out.push(...wrappedChildren(child, local, inSdt));
  }
  return out;
}

/** Index every block of the body. Deterministic: the same bytes always give the same IDs. */
export function indexBlocks(dom: DocxDom): BlockIndex {
  const blocks: BlockRef[] = [];
  const byId = new Map<string, BlockRef>();
  const add = (ref: BlockRef) => {
    blocks.push(ref);
    byId.set(ref.id, ref);
  };

  const walkTable = (tbl: XmlElement, path: CellRef[], t: number, inSdt: boolean) => {
    wrappedChildren(tbl, "tr", inSdt).forEach((row, r) => {
      wrappedChildren(row.el, "tc", row.inSdt).forEach((cell, c) => {
        const cellPath = [...path, { t, r, c }];
        const items = contentItems(cell.el, cell.inSdt);
        const paragraphs = items.filter((i) => isW(i.el, "p")).map((i) => i.el);
        const ref: CellRef2 = {
          kind: "cell",
          id: formatCellBlockId(cellPath),
          el: cell.el,
          path: cellPath,
          paragraphs,
          inSdt: cell.inSdt,
          hasNestedTables: items.some((i) => isW(i.el, "tbl")),
        };
        add(ref);
        let pIdx = 0;
        let tIdx = 0;
        for (const item of items) {
          if (isW(item.el, "p")) {
            add({ kind: "paragraph", id: formatCellBlockId(cellPath, pIdx++), el: item.el, inSdt: item.inSdt, cellPath });
          } else {
            walkTable(item.el, cellPath, tIdx++, item.inSdt);
          }
        }
      });
    });
  };

  let p = 0;
  let t = 0;
  for (const item of contentItems(dom.body)) {
    if (isW(item.el, "p")) {
      if (isDraftBanner(item.el)) continue;
      add({ kind: "paragraph", id: formatParagraphBlockId(p++), el: item.el, inSdt: item.inSdt });
    } else {
      walkTable(item.el, [], t++, item.inSdt);
    }
  }
  const textBoxes = dom.body.getElementsByTagNameNS(W_NS, "txbxContent").length;
  return { blocks, byId, tables: t, paragraphs: p, textBoxes };
}

/* ------------------------------------------------------------------------------------------------
 * Paragraph segments: visible characters → the XML that holds them
 * ----------------------------------------------------------------------------------------------*/

export const UNCHECKED_GLYPHS = "☐□";
export const CHECKED_GLYPHS = "☑☒";
export const CHECKED_GLYPH = "☒";
export const UNCHECKED_GLYPH = "☐";

export type SegmentKind = "text" | "tab" | "break" | "sym" | "legacyCheck";

export interface Segment {
  kind: SegmentKind;
  /** w:t, w:tab, w:br/w:cr, w:sym, or the w:fldChar (begin) of a legacy check box. */
  el: XmlElement;
  /** The run that holds `el` (null for a legacy check box's virtual glyph). */
  run: XmlElement | null;
  /** Visible text: the w:t text, " " for a tab, "\n" for a break, ☐/☒ for a tick box. */
  text: string;
  /** Name of the legacy FORMTEXT field whose result holds this text. */
  legacyField?: string;
  /** The legacy field's begin fldChar (FORMTEXT result text and FORMCHECKBOX). */
  fieldBegin?: XmlElement;
}

/** A tick box found in a paragraph, in text order. */
export interface GlyphSlot {
  checked: boolean;
  segment: Segment;
  /** Offset of the glyph inside a text segment (0 for sym / legacy boxes). */
  offset: number;
}

interface SymInfo {
  checked: boolean;
}

const WINGDINGS_UNCHECKED = new Set([0xf06f, 0xf0a8, 0xf071, 0xf072]);
const WINGDINGS_CHECKED = new Set([0xf0fe, 0xf0fd, 0xf078]);
const WINGDINGS2_UNCHECKED = new Set([0xf0a3, 0xf0a2, 0xf02a]);
const WINGDINGS2_CHECKED = new Set([0xf054, 0xf053, 0xf052, 0xf051, 0xf050]);

function symCode(el: XmlElement): number | null {
  const raw = wAttr(el, "char");
  if (!raw || !/^[0-9a-f]{1,6}$/i.test(raw)) return null;
  return parseInt(raw, 16);
}

/** Whether a w:sym is a tick box, and its state. */
export function symCheckbox(el: XmlElement): SymInfo | null {
  const code = symCode(el);
  if (code === null) return null;
  const font = (wAttr(el, "font") ?? "").toLowerCase();
  const pua = code < 0x100 ? code + 0xf000 : code;
  if (font.startsWith("wingdings 2")) {
    if (WINGDINGS2_UNCHECKED.has(pua)) return { checked: false };
    if (WINGDINGS2_CHECKED.has(pua)) return { checked: true };
    return null;
  }
  if (font.startsWith("wingdings")) {
    if (WINGDINGS_UNCHECKED.has(pua)) return { checked: false };
    if (WINGDINGS_CHECKED.has(pua)) return { checked: true };
    return null;
  }
  if (code >= 0x2000) {
    const ch = String.fromCodePoint(code);
    if (UNCHECKED_GLYPHS.includes(ch)) return { checked: false };
    if (CHECKED_GLYPHS.includes(ch)) return { checked: true };
  }
  return null;
}

/** The w:sym char value for a ticked/unticked box in the same font. */
export function symCharFor(el: XmlElement, checked: boolean): string {
  const font = (wAttr(el, "font") ?? "").toLowerCase();
  if (font.startsWith("wingdings 2")) return checked ? "F054" : "F0A3";
  if (font.startsWith("wingdings")) return checked ? "F0FD" : "F0A8";
  return checked ? "2612" : "2610";
}

/** Run-level containers whose content is visible text. */
const TRANSPARENT = new Set(["hyperlink", "smartTag", "sdt", "sdtContent", "ins", "fldSimple", "customXml", "bdo", "dir", "moveTo"]);
/** Never visible / never ours to read. */
const SKIPPED = new Set(["pPr", "rPr", "sdtPr", "sdtEndPr", "del", "moveFrom", "instrText", "delText", "drawing", "pict", "object", "commentReference", "footnoteReference", "endnoteReference"]);

interface FieldState {
  begin: XmlElement;
  name: string;
  type: "text" | "check" | "other";
  phase: "instr" | "result";
}

function legacyFieldInfo(begin: XmlElement): { name: string; type: "text" | "check" | "other" } {
  const ff = firstW(begin, "ffData");
  if (!ff) return { name: "", type: "other" };
  const name = wAttr(firstW(ff, "name"), "val") ?? "";
  if (firstW(ff, "checkBox")) return { name, type: "check" };
  if (firstW(ff, "textInput")) return { name, type: "text" };
  return { name, type: "other" };
}

/** Whether a legacy FORMCHECKBOX is ticked (w:checked, else w:default). */
export function legacyCheckState(begin: XmlElement): boolean {
  const box = firstW(firstW(begin, "ffData"), "checkBox");
  if (!box) return false;
  const checked = firstW(box, "checked");
  if (checked) return wAttr(checked, "val") !== "0" && wAttr(checked, "val") !== "false";
  const def = firstW(box, "default");
  return def ? wAttr(def, "val") === "1" || wAttr(def, "val") === "true" : false;
}

/**
 * The visible characters of a paragraph as ordered segments. Follows runs inside hyperlinks, smart
 * tags, run-level content controls and insertions; skips deleted text, field instructions, drawings
 * and text boxes. Legacy FORMTEXT results are text tagged with the field name; a legacy FORMCHECKBOX
 * appears as a virtual ☐/☒.
 */
export function paragraphSegments(p: XmlElement): Segment[] {
  const segs: Segment[] = [];
  const fields: FieldState[] = [];
  const inInstr = () => fields.some((f) => f.phase === "instr");
  const currentTextField = () => {
    for (let i = fields.length - 1; i >= 0; i--) if (fields[i].type === "text" && fields[i].phase === "result") return fields[i];
    return null;
  };

  const visitRun = (run: XmlElement) => {
    for (const child of childElements(run)) {
      if (child.namespaceURI !== W_NS) continue;
      const local = child.localName;
      if (local === "fldChar") {
        const type = wAttr(child, "fldCharType");
        if (type === "begin") {
          const info = legacyFieldInfo(child);
          fields.push({ begin: child, ...info, phase: "instr" });
          if (info.type === "check") segs.push({ kind: "legacyCheck", el: child, run: null, text: legacyCheckState(child) ? CHECKED_GLYPH : UNCHECKED_GLYPH, fieldBegin: child });
        } else if (type === "separate") {
          const f = fields[fields.length - 1];
          if (f) f.phase = "result";
        } else if (type === "end") {
          fields.pop();
        }
        continue;
      }
      if (inInstr()) continue;
      const field = currentTextField();
      const tag = field ? { legacyField: field.name, fieldBegin: field.begin } : {};
      if (local === "t") segs.push({ kind: "text", el: child, run, text: child.textContent ?? "", ...tag });
      else if (local === "tab" || local === "ptab") segs.push({ kind: "tab", el: child, run, text: " ", ...tag });
      else if (local === "br" || local === "cr") segs.push({ kind: "break", el: child, run, text: "\n", ...tag });
      else if (local === "noBreakHyphen") segs.push({ kind: "text", el: child, run, text: "-", ...tag });
      else if (local === "sym") {
        const box = symCheckbox(child);
        const code = symCode(child);
        const ch = box ? (box.checked ? CHECKED_GLYPH : UNCHECKED_GLYPH) : code !== null && code >= 0x20 && code < 0xe000 ? String.fromCodePoint(code) : "";
        if (ch) segs.push({ kind: "sym", el: child, run, text: ch });
      }
    }
  };

  const visit = (el: XmlElement) => {
    for (const child of childElements(el)) {
      if (child.namespaceURI !== W_NS) {
        // mc:AlternateContent etc. – not text we can address.
        continue;
      }
      const local = child.localName ?? "";
      if (SKIPPED.has(local)) continue;
      if (local === "r") visitRun(child);
      else if (TRANSPARENT.has(local)) visit(child);
    }
  };
  visit(p);
  return segs;
}

export function segmentsText(segs: Segment[]): string {
  return segs.map((s) => s.text).join("");
}

/** Visible text of a paragraph. */
export function paragraphText(p: XmlElement): string {
  return segmentsText(paragraphSegments(p));
}

/** The tick boxes of a paragraph in text order (☐/☒ characters, symbol boxes, legacy check boxes). */
export function glyphSlots(segs: Segment[]): GlyphSlot[] {
  const slots: GlyphSlot[] = [];
  for (const seg of segs) {
    if (seg.kind === "sym" || seg.kind === "legacyCheck") {
      if (UNCHECKED_GLYPHS.includes(seg.text) || CHECKED_GLYPHS.includes(seg.text)) {
        slots.push({ checked: CHECKED_GLYPHS.includes(seg.text), segment: seg, offset: 0 });
      }
    } else if (seg.kind === "text") {
      for (let i = 0; i < seg.text.length; i++) {
        const ch = seg.text[i];
        if (UNCHECKED_GLYPHS.includes(ch)) slots.push({ checked: false, segment: seg, offset: i });
        else if (CHECKED_GLYPHS.includes(ch)) slots.push({ checked: true, segment: seg, offset: i });
      }
    }
  }
  return slots;
}

/* ------------------------------------------------------------------------------------------------
 * Placeholders and answer space
 * ----------------------------------------------------------------------------------------------*/

/** Content-control placeholder texts Word inserts. */
export const CONTROL_PLACEHOLDER_RE = /Click or tap here to enter text\.?|Click here to enter text\.?|Click or tap to enter a date\.?|Click here to enter a date\.?|Choose an item\.?/i;

const PLACEHOLDER_PATTERNS: RegExp[] = [
  CONTROL_PLACEHOLDER_RE,
  /\[[^\]\n]{0,60}\]/,
  /_{4,}/,
  /(?:\.[  ]?){5,}/,
  /…(?:[  ]?…)+/,
];

/** A bare answer label at the end of a line, e.g. "Answer:" with nothing after it. */
const BARE_LABEL_RE = /\b(?:Answer|Response|Comments?|Details|Reply)\s*:\s*$/i;

export interface PlaceholderMatch {
  index: number;
  text: string;
}

/** Every fill-in placeholder in the text, in order (non-overlapping). */
export function findPlaceholders(text: string): PlaceholderMatch[] {
  const found: PlaceholderMatch[] = [];
  for (const re of PLACEHOLDER_PATTERNS) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = g.exec(text))) {
      if (m[0].length === 0) {
        g.lastIndex++;
        continue;
      }
      const start = m.index;
      const end = start + m[0].length;
      if (!found.some((f) => start < f.index + f.text.length && end > f.index)) found.push({ index: start, text: m[0].replace(/[  ]+$/, "") });
    }
  }
  if (found.length === 0) {
    const bare = BARE_LABEL_RE.exec(text);
    if (bare) found.push({ index: bare.index, text: bare[0].trim() });
  }
  return found.sort((a, b) => a.index - b.index);
}

/** True when the text is a bare label ("Answer:") used as a placeholder (the answer goes after it). */
export function isBareLabel(placeholder: string): boolean {
  return /^(?:Answer|Response|Comments?|Details|Reply)\s*:$/i.test(placeholder.trim());
}

const FILL_CHARS_RE = /[\s_.…  ·-]/g;

/** A paragraph that is only answer space: blank, or a line of dots / underscores (no text, boxes or controls). */
export function isAnswerSpaceParagraph(p: XmlElement): boolean {
  if (descendantsW(p, "sdt").length > 0 || descendantsW(p, "fldChar").length > 0) return false;
  if (descendantsW(p, "drawing").length > 0 || descendantsW(p, "pict").length > 0) return false;
  const segs = paragraphSegments(p);
  if (glyphSlots(segs).length > 0) return false;
  const text = segmentsText(segs);
  return text.replace(FILL_CHARS_RE, "") === "" || CONTROL_PLACEHOLDER_RE.test(text) && text.replace(CONTROL_PLACEHOLDER_RE, "").replace(FILL_CHARS_RE, "") === "";
}

/** A line of dots/underscores with no blank-only meaning (removed once the answer has used the space). */
export function isFillLine(p: XmlElement): boolean {
  const text = paragraphText(p);
  return /[_.…]/.test(text) && text.replace(FILL_CHARS_RE, "") === "";
}
