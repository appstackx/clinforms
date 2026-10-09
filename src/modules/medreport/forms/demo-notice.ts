import "server-only";

/**
 * Demonstration footer (FormDefinition.demoNotice): a demonstration form – e.g. a public insurer form
 * used in a private demo (ai/demo-assets.ts) – carries one line of small grey text on every page of
 * every draft preview and final render, e.g. "Public form used for demonstration only – not affiliated
 * with or endorsed by Bupa. Fictional patient data." (core/wording.ts demoFormNotice).
 *
 * - PDF: drawn in the bottom margin of every page – the form's own pages and the continuation sheets –
 *   after filling and flattening, centred, upright for rotated pages and inside the visible (crop) box.
 *   A DRAFT copy keeps its red "DRAFT – awaiting clinician approval" line (pdf-fill.ts, 12 pt above the
 *   edge); the notice then sits below it.
 * - Word: a footer paragraph, appended to every footer the document's sections show (first-page and
 *   even-page footers included) and added as a new footer where a section shows none; inherited
 *   footers are kept. A Word form converted to PDF carries it through LibreOffice.
 *
 * A form without demoNotice is never touched: the functions return their input unchanged (the same
 * bytes), so real clinic forms are byte-for-byte as before.
 *
 * Called from forms/render-form.ts (POST /forms/fill-preview and POST /render).
 *
 * Owner: forms-engine agent.
 */
import { DOMParser, XMLSerializer, type Document as XmlDocument, type Element as XmlElement } from "@xmldom/xmldom";
import { StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import PizZip from "pizzip";
import { makeEncoder, wrapText } from "./pdf-fill";
import { loadPdfDocument } from "./pdf-outline";

/** The notice as printed: one line of plain text, or "" when there is none. */
export function normaliseDemoNotice(notice: string | undefined | null): string {
  return (notice ?? "").replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------------------------------------
 * PDF
 * ----------------------------------------------------------------------------------------------*/

const NOTICE_GREY = rgb(0.42, 0.45, 0.5);
/** Side margin of the notice line (pt). */
const SIDE = 18;
/** Final copies: baseline 8 pt above the visible bottom edge, 6.5 pt type. */
const FINAL = { baseline: 8, size: 6.5 } as const;
/** DRAFT copies: below pdf-fill.ts's red DRAFT line (baseline 12 pt, 7.5 pt bold). */
const DRAFT = { baseline: 3.5, size: 6 } as const;
const MIN_SIZE = 4.5;

/** A point in the page's visible (rotated, cropped) frame → user space, for /Rotate 0, 90, 180 or 270. */
function toUserSpace(box: { x: number; y: number; width: number; height: number }, rotation: number, vx: number, vy: number): { x: number; y: number } {
  const x0 = box.x;
  const y0 = box.y;
  const x1 = box.x + box.width;
  const y1 = box.y + box.height;
  switch (rotation) {
    case 90:
      return { x: x1 - vy, y: y0 + vx };
    case 180:
      return { x: x1 - vx, y: y1 - vy };
    case 270:
      return { x: x0 + vy, y: y1 - vx };
    default:
      return { x: x0 + vx, y: y0 + vy };
  }
}

function drawNoticeOnPage(page: PDFPage, font: PDFFont, text: string, draft: boolean): void {
  const box = page.getCropBox();
  const rotation = (((page.getRotation().angle % 360) + 360) % 360) as number;
  const quarter = rotation === 90 || rotation === 270 ? rotation : rotation === 180 ? 180 : 0;
  const visibleWidth = quarter === 90 || quarter === 270 ? box.height : box.width;
  const maxWidth = Math.max(40, visibleWidth - 2 * SIDE);
  const spec = draft ? DRAFT : FINAL;
  let size: number = spec.size;
  while (size > MIN_SIZE && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.25;
  const lines = font.widthOfTextAtSize(text, size) <= maxWidth ? [text] : wrapText(text, font, size, maxWidth);
  const lineHeight = size * 1.2;
  lines.forEach((line, i) => {
    const vy = spec.baseline + (lines.length - 1 - i) * lineHeight;
    const vx = Math.max(SIDE, (visibleWidth - font.widthOfTextAtSize(line, size)) / 2);
    const at = toUserSpace(box, quarter, vx, vy);
    page.drawText(line, { x: at.x, y: at.y, size, font, color: NOTICE_GREY, rotate: degrees(quarter) });
  });
}

/**
 * The filled PDF with the demonstration notice in the bottom margin of every page (continuation sheets
 * included). Returns `bytes` itself when there is no notice.
 */
export async function stampPdfDemoNotice(bytes: Uint8Array, notice: string | undefined, opts: { draft: boolean }): Promise<Uint8Array> {
  const text = normaliseDemoNotice(notice);
  if (!text) return bytes;
  const doc = await loadPdfDocument(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const printable = makeEncoder(font)(text);
  for (const page of doc.getPages()) drawNoticeOnPage(page, font, printable, opts.draft);
  // Same writer settings as pdf-fill.ts: a classic cross-reference table for the widest reader support.
  return doc.save({ useObjectStreams: false });
}

/* ------------------------------------------------------------------------------------------------
 * Word
 * ----------------------------------------------------------------------------------------------*/

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const XMLNS_NS = "http://www.w3.org/2000/xmlns/";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const FOOTER_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer";
const FOOTER_CT = "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml";
const DOCUMENT_PART = "word/document.xml";
const DOCUMENT_RELS = "word/_rels/document.xml.rels";
const SETTINGS_PART = "word/settings.xml";
const CONTENT_TYPES = "[Content_Types].xml";
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
/** Grey (#6B7280), 7 pt (14 half-points), centred. */
const WORD_GREY = "6B7280";
const WORD_HALF_POINTS = "14";

type FooterType = "default" | "first" | "even";

function parseXml(xml: string): XmlDocument {
  return new DOMParser({
    onError: (level, message) => {
      if (level === "fatalError") throw new Error(message);
    },
  }).parseFromString(xml, "application/xml");
}

function serialize(doc: XmlDocument): string {
  const xml = new XMLSerializer().serializeToString(doc);
  return xml.startsWith("<?xml") ? xml : `${XML_DECL}${xml}`;
}

function childrenNS(el: XmlElement, ns: string, local: string): XmlElement[] {
  const out: XmlElement[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as XmlElement).namespaceURI === ns && (n as XmlElement).localName === local) out.push(n as XmlElement);
  }
  return out;
}

function wVal(el: XmlElement, local: string): string | null {
  return el.getAttributeNS(W_NS, local) || el.getAttribute(`w:${local}`) || null;
}

/** An on/off property element (w:titlePg, w:evenAndOddHeaders): present and not switched off. */
function isOn(el: XmlElement | undefined): boolean {
  if (!el) return false;
  const v = wVal(el, "val");
  return v === null || !/^(0|false|off)$/i.test(v);
}

/** The prefix a document binds to a namespace, or `fallback` (declared on the root when missing). */
function prefixFor(doc: XmlDocument, ns: string, fallback: string): string {
  const root = doc.documentElement;
  if (!root) return fallback;
  if (root.namespaceURI === ns && root.prefix) return root.prefix;
  const found = root.lookupPrefix(ns);
  if (found) return found;
  root.setAttributeNS(XMLNS_NS, `xmlns:${fallback}`, ns);
  return fallback;
}

/** The notice paragraph: centred, small grey text. */
function noticeParagraph(doc: XmlDocument, w: string, text: string): XmlElement {
  const el = (local: string, attrs: Record<string, string> = {}) => {
    const e = doc.createElementNS(W_NS, `${w}:${local}`);
    for (const [k, v] of Object.entries(attrs)) e.setAttributeNS(W_NS, `${w}:${k}`, v);
    return e;
  };
  const p = el("p");
  const pPr = el("pPr");
  pPr.appendChild(el("spacing", { before: "60", after: "0" }));
  pPr.appendChild(el("jc", { val: "center" }));
  p.appendChild(pPr);
  const r = el("r");
  const rPr = el("rPr");
  rPr.appendChild(el("color", { val: WORD_GREY }));
  rPr.appendChild(el("sz", { val: WORD_HALF_POINTS }));
  rPr.appendChild(el("szCs", { val: WORD_HALF_POINTS }));
  r.appendChild(rPr);
  const t = el("t");
  t.setAttributeNS(XML_NS, "xml:space", "preserve");
  t.appendChild(doc.createTextNode(text));
  r.appendChild(t);
  p.appendChild(r);
  return p;
}

/** A relationship target ("footer1.xml", "/word/footer1.xml", "../word/x.xml") → its part name in the zip. */
function partFromTarget(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = `word/${target}`.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}

/**
 * The filled Word file with the demonstration notice as a footer paragraph on every page. Returns
 * `bytes` itself when there is no notice, or when the file has no Word body (nothing to label).
 */
export function addDocxDemoNotice(bytes: Uint8Array, notice: string | undefined): Uint8Array {
  const text = normaliseDemoNotice(notice);
  if (!text) return bytes;
  const zip = new PizZip(bytes);
  const docXml = zip.file(DOCUMENT_PART)?.asText();
  if (!docXml) return bytes;
  const doc = parseXml(docXml);
  const root = doc.documentElement;
  const body = root ? childrenNS(root, W_NS, "body")[0] : undefined;
  if (!root || !body) return bytes;
  const w = prefixFor(doc, W_NS, "w");

  // Relationships of the main document (created when missing).
  const relsDoc = parseXml(zip.file(DOCUMENT_RELS)?.asText() ?? `${XML_DECL}<Relationships xmlns="${PKG_REL_NS}"/>`);
  const relsRoot = relsDoc.documentElement!;
  const rels = new Map<string, { type: string; target: string; external: boolean }>();
  for (const rel of childrenNS(relsRoot, PKG_REL_NS, "Relationship")) {
    rels.set(rel.getAttribute("Id") ?? "", { type: rel.getAttribute("Type") ?? "", target: rel.getAttribute("Target") ?? "", external: rel.getAttribute("TargetMode") === "External" });
  }

  const settingsXml = zip.file(SETTINGS_PART)?.asText();
  let evenAndOdd = false;
  if (settingsXml) {
    try {
      const settings = parseXml(settingsXml).documentElement;
      evenAndOdd = settings ? isOn(childrenNS(settings, W_NS, "evenAndOddHeaders")[0]) : false;
    } catch {
      evenAndOdd = false;
    }
  }

  // Every section (paragraph-level section breaks, then the body's own), in document order. A
  // sectPr inside a tracked change (w:sectPrChange) is history, not a section.
  const sections: XmlElement[] = [];
  const all = body.getElementsByTagNameNS(W_NS, "sectPr");
  for (let i = 0; i < all.length; i++) {
    const s = all.item(i);
    const parent = s?.parentNode as XmlElement | null;
    if (s && !(parent && parent.namespaceURI === W_NS && parent.localName === "sectPrChange")) sections.push(s);
  }
  let documentChanged = false;
  if (sections.length === 0) {
    const sectPr = doc.createElementNS(W_NS, `${w}:sectPr`);
    body.appendChild(sectPr);
    sections.push(sectPr);
    documentChanged = true;
  }

  // Footers the sections show: their own, or inherited from the previous section. A type a section
  // shows but no section defines gets a new footer holding only the notice.
  const newParts = new Map<string, string>();
  const rIdsToLabel = new Set<string>();
  let inherited: Partial<Record<FooterType, string>> = {};
  let counter = 0;
  const freshPart = (): { rId: string; part: string } => {
    for (;;) {
      counter += 1;
      const rId = `rIdDemoNotice${counter}`;
      const part = `word/footer-demo-notice-${counter}.xml`;
      if (!rels.has(rId) && !zip.file(part)) return { rId, part };
    }
  };
  for (const sectPr of sections) {
    const refs = childrenNS(sectPr, W_NS, "footerReference");
    const own: Partial<Record<FooterType, string>> = {};
    for (const ref of refs) {
      const type = (wVal(ref, "type") ?? "default") as FooterType;
      const rId = ref.getAttributeNS(R_NS, "id") || ref.getAttribute("r:id") || "";
      if (rId && (type === "default" || type === "first" || type === "even")) own[type] = rId;
    }
    const shown: FooterType[] = ["default"];
    if (isOn(childrenNS(sectPr, W_NS, "titlePg")[0])) shown.push("first");
    if (evenAndOdd) shown.push("even");
    const effective = { ...inherited, ...own };
    for (const type of shown) {
      if (effective[type]) continue;
      const { rId, part } = freshPart();
      newParts.set(rId, part);
      rels.set(rId, { type: FOOTER_REL, target: part.slice("word/".length), external: false });
      const ref = doc.createElementNS(W_NS, `${w}:footerReference`);
      ref.setAttributeNS(W_NS, `${w}:type`, type);
      ref.setAttributeNS(R_NS, `${prefixFor(doc, R_NS, "r")}:id`, rId);
      // Header and footer references come first in a w:sectPr.
      const lastRef = childrenNS(sectPr, W_NS, "headerReference").concat(childrenNS(sectPr, W_NS, "footerReference")).pop();
      sectPr.insertBefore(ref, lastRef ? lastRef.nextSibling : sectPr.firstChild);
      effective[type] = rId;
      own[type] = rId;
      documentChanged = true;
    }
    for (const rId of Object.values(own)) if (rId) rIdsToLabel.add(rId);
    inherited = effective;
  }

  // Append the notice to each footer part once (several relationships may point at the same part).
  const labelled = new Set<string>();
  for (const rId of Array.from(rIdsToLabel)) {
    const rel = rels.get(rId);
    if (!rel || rel.external || rel.type !== FOOTER_REL) continue;
    const part = newParts.get(rId) ?? partFromTarget(rel.target);
    if (labelled.has(part)) continue;
    labelled.add(part);
    if (newParts.has(rId)) {
      const ftr = parseXml(`${XML_DECL}<w:ftr xmlns:w="${W_NS}" xmlns:r="${R_NS}"/>`);
      ftr.documentElement!.appendChild(noticeParagraph(ftr, "w", text));
      zip.file(part, serialize(ftr));
      continue;
    }
    const xml = zip.file(part)?.asText();
    if (!xml) continue;
    let ftr: XmlDocument;
    try {
      ftr = parseXml(xml);
    } catch {
      continue;
    }
    if (!ftr.documentElement) continue;
    ftr.documentElement.appendChild(noticeParagraph(ftr, prefixFor(ftr, W_NS, "w"), text));
    zip.file(part, serialize(ftr));
  }

  if (newParts.size > 0) {
    for (const [rId, part] of Array.from(newParts)) {
      const rel = relsDoc.createElementNS(PKG_REL_NS, "Relationship");
      rel.setAttribute("Id", rId);
      rel.setAttribute("Type", FOOTER_REL);
      rel.setAttribute("Target", part.slice("word/".length));
      relsRoot.appendChild(rel);
    }
    zip.file(DOCUMENT_RELS, serialize(relsDoc));
    const ctXml = zip.file(CONTENT_TYPES)?.asText();
    if (ctXml) {
      const ct = parseXml(ctXml);
      const ctRoot = ct.documentElement!;
      for (const part of Array.from(newParts.values())) {
        const o = ct.createElementNS(CT_NS, "Override");
        o.setAttribute("PartName", `/${part}`);
        o.setAttribute("ContentType", FOOTER_CT);
        ctRoot.appendChild(o);
      }
      zip.file(CONTENT_TYPES, serialize(ct));
    }
  }
  if (documentChanged) zip.file(DOCUMENT_PART, serialize(doc));
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}
