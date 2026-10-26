/**
 * Browser loaders for the original-layout previews (Revision 2). Import these from client components
 * only (they touch `window`, `document` and `Worker`), and only inside effects or event handlers.
 *
 * - docx-preview@0.4.1 renders a (filled) Word form in its original layout: `renderAsync(blob, el)`.
 * - pdfjs-dist@6.4.299, LEGACY build (wider browser support), with a real module worker bundled by
 *   webpack through `new Worker(new URL(..., import.meta.url), {type: "module"})`.
 *   Do NOT set GlobalWorkerOptions.workerSrc to `new URL("…pdf.worker.min.mjs", import.meta.url)`: Next
 *   14 then emits the worker as a raw asset and Terser fails the build ("'import.meta' cannot be used
 *   outside of module code"). Verified with `next build` + Chromium (no console messages).
 *
 * What the preview must guarantee (bh2 WF): every word and mark the form prints is visible – nothing cut off at the page
 * edge or hidden under a header or footer drawing; page geometry is best effort and never changes a download.
 *
 * Shared contract. Owner: WF (copy, preview and guide) – docs/bh2-ownership.json.
 */

type PdfjsBrowser = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type DocxPreview = typeof import("docx-preview");

let pdfjsLoading: Promise<PdfjsBrowser> | null = null;
let docxLoading: Promise<DocxPreview> | null = null;

function browserOnly(name: string): Error {
  return new Error(`${name} runs in the browser only.`);
}

/** pdfjs-dist (legacy build) with its worker, loaded once per page. */
export function loadPdfjsBrowser(): Promise<PdfjsBrowser> {
  if (typeof window === "undefined") return Promise.reject(browserOnly("The PDF preview"));
  if (!pdfjsLoading) {
    pdfjsLoading = (async () => {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      if (!pdfjs.GlobalWorkerOptions.workerPort) {
        pdfjs.GlobalWorkerOptions.workerPort = new Worker(
          new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url),
          { type: "module" },
        );
      }
      return pdfjs;
    })();
    pdfjsLoading.catch(() => {
      pdfjsLoading = null;
    });
  }
  return pdfjsLoading;
}

/** docx-preview, loaded once per page. Use `renderAsync(blob, container, undefined, options)`. */
export function loadDocxPreview(): Promise<DocxPreview> {
  if (typeof window === "undefined") return Promise.reject(browserOnly("The Word preview"));
  if (!docxLoading) {
    docxLoading = import("docx-preview");
    docxLoading.catch(() => {
      docxLoading = null;
    });
  }
  return docxLoading;
}

/**
 * Make a docx-preview rendering of an UNTRUSTED Word file inert. docx-preview copies hyperlink targets
 * into live <a href> elements as they are (including `javascript:` URLs), and a referrer's form comes
 * from outside the clinic. The preview never needs navigation, so every link target, event handler,
 * external resource URL and embedded active element is removed.
 */
export function sanitizeDocxPreview(root: HTMLElement): void {
  root.querySelectorAll("script, iframe, frame, object, embed, applet, form, input, button, textarea, select, link, meta, base").forEach((el) => el.remove());
  root.querySelectorAll<Element>("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith("on") || name === "href" || name === "xlink:href" || name === "action" || name === "formaction" || name === "srcdoc") {
        el.removeAttribute(attr.name);
      } else if ((name === "src" || name === "poster" || name === "data") && !/^(?:data:image\/|blob:)/i.test(value)) {
        el.removeAttribute(attr.name);
      }
    }
  });
  root.querySelectorAll<HTMLElement>("a").forEach((a) => {
    a.setAttribute("rel", "noopener noreferrer");
    a.setAttribute("tabindex", "-1");
    a.style.pointerEvents = "none";
    a.style.cursor = "default";
  });
}

/**
 * Fix round 1 (B0-30): docx-preview ignores a table's indent ("w:tblInd", in twips), so a table Word pulls left into the
 * margin (Proclaim's -680) is drawn shifted right and cut off. The body's table indents, in document order, as CSS
 * margins: read from the file's own document.xml through the parsed package (docx-preview 0.4.1 keeps it as `_package`).
 */
export function tableIndentsOf(documentXml: string): Array<number | null> {
  const out: Array<number | null> = [];
  const re = /<w:tbl(?:Ind)?\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(documentXml))) {
    if (!m[0].startsWith("<w:tblInd")) {
      out.push(null);
      continue;
    }
    const w = /\bw:w="(-?\d+)"/.exec(m[0]);
    const type = /\bw:type="(\w+)"/.exec(m[0])?.[1] ?? "dxa";
    if (w && type === "dxa" && out.length > 0 && out[out.length - 1] === null) out[out.length - 1] = Number(w[1]);
  }
  return out;
}

interface PreviewNode {
  type?: string;
  className?: string;
  cssStyle?: Record<string, string>;
  children?: PreviewNode[];
}

/** Every table of the parsed body, in document order (nested tables after the table that holds them). */
function tablesOf(node: PreviewNode | undefined, out: PreviewNode[] = []): PreviewNode[] {
  if (!node) return out;
  if (node.type === "table") out.push(node);
  for (const child of node.children ?? []) tablesOf(child, out);
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Fix round 2 (B1-22): drawings anchored to the page or its margins, placed as Word places them
 * ----------------------------------------------------------------------------------------------*/

/** Page size and margins in points, from a document's last section properties; null when it has none. */
export interface PageGeometry {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function pageGeometryOf(documentXml: string): PageGeometry | null {
  const sizes = documentXml.match(/<w:pgSz\b[^>]*>/g);
  const margins = documentXml.match(/<w:pgMar\b[^>]*>/g);
  if (!sizes || !margins) return null;
  const twips = (tag: string, name: string) => Number(new RegExp(`\\bw:${name}="(-?\\d+)"`).exec(tag)?.[1] ?? NaN) / 20;
  const size = sizes[sizes.length - 1];
  const mar = margins[margins.length - 1];
  const g = { width: twips(size, "w"), height: twips(size, "h"), left: twips(mar, "left"), right: twips(mar, "right"), top: twips(mar, "top"), bottom: twips(mar, "bottom") };
  return Object.values(g).every((v) => Number.isFinite(v)) ? g : null;
}

/** Where an anchored drawing goes on its page, in points from the page's top-left corner. */
export interface AnchorPlacement {
  left: number;
  top: number;
  width: number;
  height: number;
}

const EMU_PER_PT = 12700;

/**
 * One entry per drawing docx-preview renders from this part's XML, in order (it takes an mc:AlternateContent's
 * Fallback): a placement for a drawing anchored by an offset or an alignment to the page, its margin or its column
 * (the TPN logo: 386 pt from the margin, at the top of the page), null for an inline drawing or one anchored to a
 * paragraph or a line (its place depends on the text).
 */
export function anchorPlacementsOf(partXml: string, page: PageGeometry): Array<AnchorPlacement | null> {
  const xml = partXml.replace(/<mc:Choice\b[\s\S]*?<\/mc:Choice>/g, "");
  const out: Array<AnchorPlacement | null> = [];
  for (const m of Array.from(xml.matchAll(/<w:drawing\b[\s\S]*?<\/w:drawing>/g))) {
    const d = m[0];
    const anchor = /<wp:anchor\b[\s\S]*<\/wp:anchor>/.exec(d)?.[0];
    const ext = /<wp:extent\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(d);
    if (!anchor || !ext || /\bsimplePos="1"/.test(anchor)) {
      out.push(null);
      continue;
    }
    const width = Number(ext[1]) / EMU_PER_PT;
    const height = Number(ext[2]) / EMU_PER_PT;
    const axis = (tag: "positionH" | "positionV") => {
      const el = new RegExp(`<wp:${tag}\\b[^>]*relativeFrom="(\\w+)"[^>]*>([\\s\\S]*?)<\\/wp:${tag}>`).exec(anchor);
      if (!el) return null;
      const offset = /<wp:posOffset>(-?\d+)<\/wp:posOffset>/.exec(el[2]);
      return { from: el[1], offset: offset ? Number(offset[1]) / EMU_PER_PT : null, align: /<wp:align>(\w+)<\/wp:align>/.exec(el[2])?.[1] ?? null };
    };
    const place = (pos: ReturnType<typeof axis>, frames: Record<string, [number, number]>, size: number): number | null => {
      const frame = pos ? frames[pos.from] : undefined;
      if (!pos || !frame) return null;
      const [start, length] = frame;
      if (pos.offset !== null) return start + pos.offset;
      if (pos.align === "left" || pos.align === "top" || pos.align === "inside") return start;
      if (pos.align === "right" || pos.align === "bottom" || pos.align === "outside") return start + length - size;
      if (pos.align === "center") return start + (length - size) / 2;
      return null;
    };
    const textWidth = page.width - page.left - page.right;
    const left = place(axis("positionH"), { page: [0, page.width], margin: [page.left, textWidth], column: [page.left, textWidth], leftMargin: [0, page.left], rightMargin: [page.width - page.right, page.right] }, width);
    const top = place(axis("positionV"), { page: [0, page.height], margin: [page.top, page.height - page.top - page.bottom], topMargin: [0, page.top], bottomMargin: [page.height - page.bottom, page.bottom] }, height);
    out.push(left === null || top === null ? null : { left, top, width, height });
  }
  return out;
}

/** Every drawing of a parsed part, in document order. */
function drawingsOf(node: PreviewNode | undefined, out: PreviewNode[] = []): PreviewNode[] {
  if (!node) return out;
  if (node.type === "drawing") out.push(node);
  for (const child of node.children ?? []) drawingsOf(child, out);
  return out;
}

/** The parsed document as renderDocxPreview reads it (docx-preview 0.4.1's own model; best effort). */
interface ParsedDoc {
  _package?: { load(path: string, type?: string): Promise<string | null> };
  documentPart?: { body?: PreviewNode };
  parts?: Array<{ path?: string; rootElement?: PreviewNode; body?: PreviewNode }>;
  settingsPart?: { settings?: { defaultTabStop?: string } };
  stylesPart?: { styles?: Array<{ styles?: Array<{ values?: Record<string, string> }> }> };
}

/** The parts drawn with a page: the body, its headers and its footers. */
const DRAWN_PART = /^word\/(?:document|header\d*|footer\d*)\.xml$/;

/** Render a Word file with docx-preview into `host`, then make it inert (sanitizeDocxPreview). */
export async function renderDocxPreview(blob: Blob, host: HTMLElement, options: Record<string, unknown>): Promise<void> {
  const lib = await loadDocxPreview();
  const doc = (await lib.parseAsync(blob, options)) as unknown as ParsedDoc;
  // A negative table indent, as Word draws it (best effort: an unexpected file renders as before).
  try {
    const xml = (await doc._package?.load("word/document.xml", "string")) ?? "";
    const indents = tableIndentsOf(xml);
    const tables = tablesOf(doc.documentPart?.body);
    if (indents.length === tables.length) {
      tables.forEach((t, i) => {
        const twips = indents[i];
        if (twips !== null && twips < 0 && t.cssStyle && !t.cssStyle["margin-left"]) t.cssStyle["margin-left"] = `${twips / 20}pt`;
      });
    }
  } catch {
    // as docx-preview draws it
  }
  // Fix round 2 (B1-22): a drawing anchored to the page, its margin or its column at the distance from the page's left
  // edge Word gives it (docx-preview places it by the text around it, so the TPN logo overhung the page edge). Its
  // height stays in the text, so nothing is drawn over the form's own words. Each drawing is tagged with a class here
  // and moved across once drawn. Best effort: a part whose drawings do not line up with its XML is drawn as before.
  const placed: AnchorPlacement[] = [];
  let page: PageGeometry | null = null;
  const partXml = new Map<string, string>();
  try {
    const xml = (await doc._package?.load("word/document.xml", "string")) ?? "";
    page = pageGeometryOf(xml);
    for (const part of doc.parts ?? []) {
      if (!part.path || !DRAWN_PART.test(part.path)) continue;
      partXml.set(part.path, part.path === "word/document.xml" ? xml : ((await doc._package?.load(part.path, "string")) ?? ""));
    }
    for (const part of page ? (doc.parts ?? []) : []) {
      const root = part.rootElement ?? part.body;
      if (!root || !part.path || !partXml.has(part.path)) continue;
      const placements = anchorPlacementsOf(partXml.get(part.path) ?? "", page as PageGeometry);
      const drawings = drawingsOf(root);
      if (placements.length !== drawings.length) continue;
      drawings.forEach((d, i) => {
        const at = placements[i];
        if (!at) return;
        d.className = `${d.className ? `${d.className} ` : ""}${ANCHOR_CLASS}${placed.length}`;
        placed.push(at);
      });
    }
  } catch {
    // as docx-preview draws it
  }
  // Fix round 3 (B2-28): page-number fields drawn ("Page  of" when the form holds no number yet), and a paragraph's own
  // tab stops kept (docx-preview writes every tab as one wide space, so a schedule's columns did not line up).
  // bh2 WF (B3-22): also the page-number fields Word keeps as simple fields directly in a paragraph (the RTF conversion's
  // footers) – docx-preview drops those with their result, so Bodycare's footer still read "Page  of".
  let tabs: TabbedParagraphs = { stops: [], defaultStop: 36 };
  let appPages: number | null = null;
  try {
    let savedPages: number | null = null;
    for (const part of doc.parts ?? []) {
      const root = part.rootElement ?? part.body;
      const xml = part.path ? partXml.get(part.path) : undefined;
      if (root && xml) savedPages = applySimplePageFields(root, xml).savedPages ?? savedPages;
    }
    const fieldPages = markPageFields(doc);
    tabs = markTabbedParagraphs(doc);
    // The count Word saved: docProps/app.xml, else (an RTF conversion has none) what its NUMPAGES fields held.
    const saved = [savedPages, fieldPages].filter((n): n is number => n !== null);
    appPages = pagesOfAppXml((await doc._package?.load("docProps/app.xml", "string")) ?? "") ?? (saved.length ? Math.max(...saved) : null);
  } catch {
    // as docx-preview draws it
  }
  // bh2 WF (B3-22): single line spacing at the font's own line height, as Word sets it.
  try {
    applyWordSingleSpacing(doc);
  } catch {
    // as docx-preview draws it
  }
  const nodes = await lib.renderDocument(doc as never, options);
  host.innerHTML = "";
  for (const n of nodes) host.appendChild(n);
  fillPageFields(host, appPages);
  // Fix round 3 (B2-27), kept in bh2 (WF): the drawings are moved by measuring them as drawn, which needs the host on the
  // page. The review's Preview draws into a host not yet on the page (it is made inert first, then shown): the placing
  // then waits until the host is shown – placeDocxDrawings() does it at once, otherwise it is done on the next frames, so
  // TPN's first-page banner is never left cut off whichever screen drew it.
  if (page) {
    const pending = { placed, page, tabs, appPages };
    if (host.isConnected) placeMeasured(host, pending);
    else {
      pendingPlacements.set(host, pending);
      placeWhenShown(host);
    }
  }
  sanitizeDocxPreview(host);
}

interface PendingPlacement {
  placed: AnchorPlacement[];
  page: PageGeometry;
  tabs: TabbedParagraphs;
  appPages: number | null;
}

const pendingPlacements = new WeakMap<HTMLElement, PendingPlacement>();

/** How long a preview drawn off the page is waited for (frames, about 10 s at 60 a second); then it is left as drawn. */
const PLACE_WAIT_FRAMES = 600;

function placeWhenShown(host: HTMLElement, frames = PLACE_WAIT_FRAMES): void {
  if (typeof requestAnimationFrame !== "function") return;
  requestAnimationFrame(() => {
    if (!pendingPlacements.has(host)) return;
    if (host.isConnected) placeDocxDrawings(host);
    else if (frames > 1) placeWhenShown(host, frames - 1);
    else pendingPlacements.delete(host);
  });
}

function placeMeasured(host: HTMLElement, pending: PendingPlacement): void {
  placeAnchoredDrawings(host, pending.placed, pending.page);
  try {
    layoutTabStops(host, pending.tabs, pending.page);
    noteContinuousSheet(host, pending.page, pending.appPages);
  } catch {
    // tabs as docx-preview draws them
  }
}

/** One sheet drawn much longer than a page (a converted form with no page breaks of its own): said so above it. */
function noteContinuousSheet(host: HTMLElement, page: PageGeometry, appPages: number | null): void {
  const pages = Array.from(host.querySelectorAll<HTMLElement>("section.docx"));
  if (pages.length !== 1 || host.querySelector(`.${CONTINUOUS_CLASS}`)) return;
  const r = pages[0].getBoundingClientRect();
  const pageHeight = (r.width / page.width) * page.height;
  if (!(pageHeight > 0) || r.height < pageHeight * 1.25) return;
  addContinuousNote(pages[0], appPages);
}

/** The note above a continuous sheet – with the page count when Word saved one (an estimate could contradict its footer). */
function addContinuousNote(sheet: HTMLElement | undefined, pages: number | null): void {
  if (!sheet?.parentElement) return;
  const note = document.createElement("p");
  note.className = CONTINUOUS_CLASS;
  note.textContent = continuousSheetNote(pages);
  note.setAttribute("style", "margin:0 0 8px;font:12px/1.4 system-ui,sans-serif;color:#475569;");
  sheet.parentElement.insertBefore(note, sheet);
}

/** The note's words: the page count only when Word saved one. */
export function continuousSheetNote(pages: number | null): string {
  return pages && pages > 1
    ? `Shown as one continuous sheet – Word prints this form on ${pages} pages.`
    : "Shown as one continuous sheet – Word splits this form into pages when it prints it.";
}

/**
 * Place the anchored drawings (and tab stops) of a preview drawn into a host that was not on the page yet
 * (renderDocxPreview) – at once, when the caller has just shown it. A no-op for anything else.
 */
export function placeDocxDrawings(host: HTMLElement): void {
  const pending = pendingPlacements.get(host);
  if (!pending || !host.isConnected) return;
  pendingPlacements.delete(host);
  placeMeasured(host, pending);
}

/* ------------------------------------------------------------------------------------------------
 * Fix round 3 (B2-28), kept in bh2 (WF): page numbers, one continuous sheet, tab stops
 * ----------------------------------------------------------------------------------------------*/

interface FieldNode extends PreviewNode {
  charType?: string;
  instruction?: string;
  text?: string;
  fieldRun?: boolean;
  tabs?: Array<{ position?: string; style?: string }>;
}

export const PAGE_TOKEN = "⁠#PAGE#⁠";
export const NUMPAGES_TOKEN = "⁠#NUMPAGES#⁠";

/** The token a page-number field instruction (" PAGE ", "NUMPAGES \\* Arabic") is drawn as, or null. */
export function pageFieldToken(instruction: string | undefined): string | null {
  const m = /^\s*(PAGE|NUMPAGES|SECTIONPAGES)\b/i.exec(instruction ?? "");
  return m ? (m[1].toUpperCase() === "PAGE" ? PAGE_TOKEN : NUMPAGES_TOKEN) : null;
}

/** Every paragraph under `node`, in document order (nested ones – a text box's – after the one that holds them). */
function paragraphsOf(node: PreviewNode | undefined, out: FieldNode[] = []): FieldNode[] {
  if (!node) return out;
  if (node.type === "paragraph") out.push(node as FieldNode);
  for (const child of node.children ?? []) paragraphsOf(child, out);
  return out;
}

function allParagraphs(doc: Pick<ParsedDoc, "documentPart" | "parts">): FieldNode[] {
  const roots = [doc.documentPart?.body, ...(doc.parts ?? []).map((p) => p.rootElement ?? p.body)];
  const seen = new Set<PreviewNode>();
  const out: FieldNode[] = [];
  for (const r of roots) {
    if (!r || seen.has(r)) continue;
    seen.add(r);
    paragraphsOf(r, out);
  }
  return Array.from(new Set(out));
}

/**
 * A PAGE / NUMPAGES field whose result the file does not hold – or a simple field inside a run, which docx-preview
 * does not draw – gets a token in its place, filled with the page's number once drawn (fillPageFields). Returns the page
 * count a NUMPAGES field's result held when the file was saved (bh2 WF), or null.
 */
function markPageFields(doc: ParsedDoc): number | null {
  let savedPages: number | null = null;
  for (const p of allParagraphs(doc)) {
    const runs = (p.children ?? []) as FieldNode[];
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      // <w:r><w:fldSimple w:instr="PAGE"/></w:r>
      const simple = (run.children ?? []).findIndex((c) => (c as FieldNode).type === "simpleField" && pageFieldToken((c as FieldNode).instruction));
      if (run.type === "simpleField" && pageFieldToken(run.instruction)) {
        runs[i] = { type: "run", children: [{ type: "text", text: pageFieldToken(run.instruction) } as FieldNode] };
        continue;
      }
      if (simple >= 0) {
        const c = (run.children as FieldNode[])[simple];
        (run.children as FieldNode[])[simple] = { type: "text", text: pageFieldToken(c.instruction) ?? "" } as FieldNode;
      }
      // begin → instruction → separate → result runs → end
      const begin = (run.children ?? []).some((c) => (c as FieldNode).type === "complexField" && (c as FieldNode).charType === "begin");
      if (!begin) continue;
      let j = i + 1;
      let instruction = "";
      while (j < runs.length && !(runs[j].children ?? []).some((c) => (c as FieldNode).type === "complexField" && /separate|end/.test((c as FieldNode).charType ?? ""))) {
        for (const c of (runs[j].children ?? []) as FieldNode[]) if (c.type === "instruction") instruction += c.text ?? "";
        j += 1;
      }
      const token = pageFieldToken(instruction);
      if (!token || j >= runs.length || !(runs[j].children ?? []).some((c) => (c as FieldNode).charType === "separate")) continue;
      let k = j + 1;
      let result = "";
      while (k < runs.length && !(runs[k].children ?? []).some((c) => (c as FieldNode).charType === "end")) {
        if (!runs[k].fieldRun) for (const c of (runs[k].children ?? []) as FieldNode[]) if (c.type === "text") result += c.text ?? "";
        k += 1;
      }
      if (result.trim()) {
        const n = /^\s*(\d{1,4})\s*$/.exec(result);
        if (token === NUMPAGES_TOKEN && n && Number(n[1]) > 0) savedPages = Math.max(savedPages ?? 0, Number(n[1]));
        continue;
      }
      runs.splice(j + 1, 0, { type: "run", children: [{ type: "text", text: token } as FieldNode] });
      i = k + 1;
    }
  }
  return savedPages;
}

/* ------------------------------------------------------------------------------------------------
 * bh2 WF (B3-22): page-number fields kept as simple fields directly in a paragraph
 * ----------------------------------------------------------------------------------------------*/

/** One part's paragraphs as docx-preview draws their text, and the page-number fields it drops from them. */
export interface SimplePageFields {
  /** Each paragraph's text in document order (w:t only, as docx-preview draws it); null when it cannot be known. */
  texts: Array<string | null>;
  /** The dropped page-number fields: the paragraph's index in `texts`, where in its text the field stood, its token. */
  fields: Array<{ index: number; at: number; token: string }>;
  /** The page count a dropped NUMPAGES field held when the file was last saved (its result), or null. */
  savedPages: number | null;
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function xmlText(raw: string): string {
  return raw.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== "#") return XML_ENTITIES[e.toLowerCase()] ?? m;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

/**
 * Read one part's XML (document.xml, a header or a footer) the way docx-preview 0.4.1 reads its paragraphs: a
 * <w:fldSimple> whose nearest run-or-paragraph is the paragraph is not drawn at all, with its result – Word redraws it.
 * A paragraph holding alternative content (mc:AlternateContent: docx-preview draws one branch) has no known text.
 * Pure (no DOM); a linear scan of the tags.
 */
export function simplePageFieldsOf(xml: string): SimplePageFields {
  const texts: Array<string | null> = [];
  const fields: SimplePageFields["fields"] = [];
  /** Open elements; `dropped`: a paragraph-level w:fldSimple (not drawn, nor what is inside it). */
  const stack: Array<{ name: string; dropped?: boolean; pages?: boolean }> = [];
  const open: Array<{ index: number; dropped: number }> = [];
  let alternate = 0;
  let savedPages: number | null = null;
  /** The result text of the NUMPAGES field being read, else null. */
  let pagesResult: string | null = null;
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const innermost = () => open[open.length - 1];
  const addText = (text: string) => {
    const p = innermost();
    if (!p || stack[stack.length - 1]?.name !== "w:t") return;
    if (pagesResult !== null) pagesResult += text;
    if (p.dropped > 0) return;
    const now = texts[p.index];
    if (now !== null) texts[p.index] = now + text;
  };
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[1] !== undefined) {
      addText(m[1]);
      continue;
    }
    if (m[6] !== undefined) {
      addText(xmlText(m[6]));
      continue;
    }
    const name = m[3];
    if (!name) continue;
    if (m[2] === "/") {
      let at = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === name) {
          at = i;
          break;
        }
      }
      if (at < 0) continue;
      for (let i = stack.length - 1; i >= at; i--) {
        const el = stack[i];
        if (el.name === "w:p") open.pop();
        else if (el.name === "mc:AlternateContent") alternate -= 1;
        else if (el.dropped && innermost()) innermost().dropped -= 1;
        if (el.pages && pagesResult !== null) {
          const n = /^\s*(\d{1,4})\s*$/.exec(pagesResult);
          if (n && Number(n[1]) > 0) savedPages = Math.max(savedPages ?? 0, Number(n[1]));
          pagesResult = null;
        }
      }
      stack.length = at;
      continue;
    }
    const selfClosing = m[5] === "/";
    if (name === "w:p") {
      texts.push(alternate > 0 ? null : "");
      if (!selfClosing) {
        open.push({ index: texts.length - 1, dropped: 0 });
        stack.push({ name });
      }
      continue;
    }
    if (name === "mc:AlternateContent") {
      const p = innermost();
      if (p) texts[p.index] = null;
      if (!selfClosing) {
        alternate += 1;
        stack.push({ name });
      }
      continue;
    }
    if (name === "w:fldSimple") {
      // Its nearest run or paragraph: inside a run docx-preview keeps it (markPageFields); in a paragraph it drops it.
      let inRun = false;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === "w:r") {
          inRun = true;
          break;
        }
        if (stack[i].name === "w:p") break;
      }
      const p = innermost();
      if (!inRun && p) {
        const instr = /\bw:instr\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(m[4] ?? "");
        const token = pageFieldToken(instr ? (instr[1] ?? instr[2]) : undefined);
        const text = texts[p.index];
        if (token && text !== null) fields.push({ index: p.index, at: text.length, token });
        if (!selfClosing) {
          p.dropped += 1;
          const pages = token === NUMPAGES_TOKEN && pagesResult === null;
          if (pages) pagesResult = "";
          stack.push({ name, dropped: true, pages });
        }
        continue;
      }
    }
    if (!selfClosing) stack.push({ name });
  }
  return { texts, fields, savedPages };
}

/** The text docx-preview draws for a parsed paragraph: its text nodes, a nested paragraph's (a text box's) left out. */
function parsedText(node: PreviewNode, top = true): string {
  if (!top && node.type === "paragraph") return "";
  if (node.type === "text") return (node as FieldNode).text ?? "";
  return (node.children ?? []).map((c) => parsedText(c, false)).join("");
}

/** The nearest run before (else after) a place in a paragraph – a token drawn in its type and size. */
function formatOfRunNear(paragraph: PreviewNode, at: number): PreviewNode | null {
  const runs: Array<{ run: PreviewNode; start: number }> = [];
  let offset = 0;
  const walk = (node: PreviewNode) => {
    for (const c of node.children ?? []) {
      if (c.type === "paragraph") continue;
      if (c.type === "run") runs.push({ run: c, start: offset });
      if (c.type === "text") offset += ((c as FieldNode).text ?? "").length;
      else walk(c);
    }
  };
  walk(paragraph);
  const before = runs.filter((r) => r.start < at || (r.start === at && parsedText(r.run).length === 0));
  return (before.length ? before[before.length - 1] : runs[0])?.run ?? null;
}

/** A run holding `token`, formatted as `like` (its classes and styles; never its id or children). */
function tokenRun(token: string, like: PreviewNode | null): PreviewNode {
  const format: Record<string, unknown> = {};
  if (like) {
    for (const [k, v] of Object.entries(like)) if (k !== "children" && k !== "parent" && k !== "id" && k !== "fieldRun") format[k] = v;
  }
  return { ...format, type: "run", children: [{ type: "text", text: token } as FieldNode] } as PreviewNode;
}

/** Insert `run` where the paragraph's drawn text reaches `at` (between children; inside a hyperlink when it is there). */
function insertRunAt(paragraph: PreviewNode, at: number, run: PreviewNode): boolean {
  let offset = 0;
  const walk = (parent: PreviewNode): boolean => {
    const kids = parent.children ?? (parent.children = []);
    for (let i = 0; i < kids.length; i++) {
      const kid = kids[i];
      if (offset === at) {
        kids.splice(i, 0, run);
        return true;
      }
      const length = kid.type === "paragraph" ? 0 : parsedText(kid, true).length;
      if (offset + length > at && kid.type !== "run" && kid.type !== "text") return walk(kid);
      if (offset + length > at) return false;
      offset += length;
    }
    if (offset === at && parent === paragraph) {
      kids.push(run);
      return true;
    }
    return false;
  };
  return walk(paragraph);
}

/**
 * Put a token where each page-number field docx-preview dropped from a paragraph of this part stood (simplePageFieldsOf),
 * filled with the page's number once drawn (fillPageFields). A paragraph is found by its drawn text and its place among
 * the part's paragraphs with that text; nothing is changed for a text whose count differs between the XML and what
 * docx-preview parsed. Returns how many tokens were put in, and the page count the file saved in a NUMPAGES field (Word's
 * count when there is no docProps/app.xml, as in an RTF conversion). Pure (the parsed tree only).
 */
export function applySimplePageFields(root: PreviewNode, partXml: string): { inserted: number; savedPages: number | null } {
  if (partXml.indexOf("fldSimple") < 0) return { inserted: 0, savedPages: null };
  const scan = simplePageFieldsOf(partXml);
  if (scan.fields.length === 0) return { inserted: 0, savedPages: scan.savedPages };
  const parsed = paragraphsOf(root);
  const parsedTexts = parsed.map((p) => parsedText(p));
  const count = (list: Array<string | null>, text: string) => list.reduce((n, t) => (t === text ? n + 1 : n), 0);
  let inserted = 0;
  const byParagraph = new Map<number, Array<{ at: number; token: string }>>();
  for (const f of scan.fields) byParagraph.set(f.index, [...(byParagraph.get(f.index) ?? []), f]);
  for (const [index, list] of Array.from(byParagraph.entries())) {
    const text = scan.texts[index];
    if (text === null || text === undefined || count(scan.texts, text) !== count(parsedTexts, text)) continue;
    const nth = scan.texts.slice(0, index).filter((t) => t === text).length;
    const target = parsed.filter((_p, i) => parsedTexts[i] === text)[nth];
    if (!target) continue;
    // From the last field back, so the earlier places still hold.
    for (const f of list.slice().sort((a, b) => b.at - a.at)) {
      if (insertRunAt(target, f.at, tokenRun(f.token, formatOfRunNear(target, f.at)))) inserted += 1;
    }
  }
  return { inserted, savedPages: scan.savedPages };
}

/* ------------------------------------------------------------------------------------------------
 * bh2 WF (B3-22): single line spacing as Word sets it
 * ----------------------------------------------------------------------------------------------*/

/**
 * Word's single line spacing (w:spacing line="240", rule "auto") is the font's own line height – what a browser calls
 * "normal". docx-preview writes it as line-height 1.00, a line exactly as tall as the font size, so a full cell's last
 * line sat on the cell's border (Proclaim's history box, Ascenti's appointment dates against the bar below). Other
 * spacings are left as docx-preview writes them.
 */
export function wordLineHeight(cssValue: string): string {
  return cssValue.trim() === "1.00" ? "normal" : cssValue;
}

/** Single spacing as Word sets it, in the parsed styles (document defaults and styles) and in each paragraph's own. */
export function applyWordSingleSpacing(doc: Pick<ParsedDoc, "stylesPart" | "documentPart" | "parts">): void {
  for (const style of doc.stylesPart?.styles ?? []) {
    for (const sub of style.styles ?? []) {
      if (sub.values?.["line-height"]) sub.values["line-height"] = wordLineHeight(sub.values["line-height"]);
    }
  }
  for (const p of allParagraphs(doc)) {
    if (p.cssStyle?.["line-height"]) p.cssStyle["line-height"] = wordLineHeight(p.cssStyle["line-height"]);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Page counts and tab stops (fix round 3, B2-28)
 * ----------------------------------------------------------------------------------------------*/

/** The pages Word counted when it last saved the file (docProps/app.xml), or null. */
export function pagesOfAppXml(appXml: string): number | null {
  const n = Number(/<Pages>(\d+)<\/Pages>/.exec(appXml)?.[1] ?? NaN);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const CONTINUOUS_CLASS = "mr-continuous-note";

/**
 * Page-number tokens filled with each drawn page's number and the page count. A form drawn as one continuous sheet that
 * Word prints on several pages (docx-preview breaks pages only where the file does) is said to be so above the sheet.
 */
export function fillPageFields(host: HTMLElement, appPages: number | null): void {
  const pages = Array.from(host.querySelectorAll<HTMLElement>("section.docx"));
  const continuous = pages.length === 1 && appPages !== null && appPages > 1;
  const total = continuous ? (appPages as number) : Math.max(1, pages.length);
  pages.forEach((page, i) => {
    const walker = page.ownerDocument.createTreeWalker(page, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue || n.nodeValue.indexOf("⁠#") < 0) continue;
      n.nodeValue = fillPageTokens(n.nodeValue, continuous ? 1 : i + 1, total);
    }
  });
  if (continuous && !host.querySelector(`.${CONTINUOUS_CLASS}`)) addContinuousNote(pages[0], appPages as number);
}

/** A drawn text's page-number tokens filled in. */
export function fillPageTokens(text: string, page: number, total: number): string {
  return text.split(PAGE_TOKEN).join(String(page)).split(NUMPAGES_TOKEN).join(String(total));
}

interface TabbedParagraphs {
  /** The custom tab stops (points, sorted) of each tagged paragraph. */
  stops: Array<Array<{ pos: number; style: string }>>;
  /** The document's default tab stop, in points. */
  defaultStop: number;
}

const TABS_CLASS = "mr-tabs-";

/** Paragraphs with tab stops of their own, tagged for layoutTabStops(). */
function markTabbedParagraphs(doc: ParsedDoc): TabbedParagraphs {
  const out: TabbedParagraphs = { stops: [], defaultStop: parseFloat(doc.settingsPart?.settings?.defaultTabStop ?? "") || 36 };
  for (const p of allParagraphs(doc)) {
    const own = (p.tabs ?? []).map((t) => ({ pos: parseFloat(t.position ?? ""), style: t.style ?? "left" })).filter((t) => Number.isFinite(t.pos)).sort((a, b) => a.pos - b.pos);
    if (own.length === 0) continue;
    p.className = `${p.className ? `${p.className} ` : ""}${TABS_CLASS}${out.stops.length}`;
    out.stops.push(own);
  }
  return out;
}

/**
 * The next tab stop after `at` (points from the column's left edge): a custom stop of the paragraph, else a default stop
 * after the last custom one – Word clears the default stops left of a custom tab.
 */
export function nextTabStop(at: number, stops: ReadonlyArray<{ pos: number; style: string }>, defaultStop: number): number {
  const custom = stops.find((t) => t.style !== "clear" && t.pos > at + 0.5);
  if (custom) return custom.pos;
  const last = stops.filter((t) => t.style !== "clear").reduce((m, t) => Math.max(m, t.pos), 0);
  const from = Math.max(at, last);
  return (Math.floor(from / defaultStop + 1e-6) + 1) * defaultStop;
}

/** Each tab of a tagged paragraph widened to its stop – measured as drawn, so a zoomed preview is laid out in proportion. */
function layoutTabStops(host: HTMLElement, tabs: TabbedParagraphs, page: PageGeometry): void {
  if (tabs.stops.length === 0) return;
  host.querySelectorAll<HTMLElement>(`p[class*="${TABS_CLASS}"]`).forEach((p) => {
    const n = new RegExp(`(?:^|\\s)${TABS_CLASS}(\\d+)(?:\\s|$)`).exec(p.className)?.[1];
    const stops = n === undefined ? undefined : tabs.stops[Number(n)];
    const section = p.closest("section");
    if (!stops || !section) return;
    const pxPerPt = section.getBoundingClientRect().width / page.width;
    if (!(pxPerPt > 0)) return;
    const origin = p.getBoundingClientRect().left - (parseFloat(getComputedStyle(p).marginLeft) || 0) * pxPerPt * (72 / 96);
    const spans = Array.from(p.querySelectorAll<HTMLElement>("span")).filter((s) => s.childElementCount === 0 && s.textContent === " ");
    for (const span of spans) {
      const at = (span.getBoundingClientRect().left - origin) / pxPerPt;
      const width = nextTabStop(at, stops, tabs.defaultStop) - at;
      span.textContent = "";
      span.style.display = "inline-block";
      span.style.width = `${Math.max(1, Math.round(width * 10) / 10)}pt`;
    }
  });
}

const ANCHOR_CLASS = "mr-anchor-";

/**
 * Each tagged drawing moved across its page (its section) to the left edge its tag names (fix round 2, B1-22) – measured
 * as drawn, so a zoomed preview is moved in proportion. It stays in the text's flow ("position: relative").
 */
function placeAnchoredDrawings(host: HTMLElement, placed: readonly AnchorPlacement[], page: PageGeometry): void {
  if (placed.length === 0) return;
  host.querySelectorAll<HTMLElement>(`[class*="${ANCHOR_CLASS}"]`).forEach((el) => {
    const n = new RegExp(`(?:^|\\s)${ANCHOR_CLASS}(\\d+)(?:\\s|$)`).exec(el.className)?.[1];
    const at = n === undefined ? undefined : placed[Number(n)];
    const section = el.closest("section");
    if (!at || !section) return;
    const pxPerPt = section.getBoundingClientRect().width / page.width;
    if (!(pxPerPt > 0)) return;
    const now = (el.getBoundingClientRect().left - section.getBoundingClientRect().left) / pxPerPt;
    const left = el.style.left.endsWith("pt") ? parseFloat(el.style.left) || 0 : 0;
    el.style.left = `${Math.round((left + at.left - now) * 10) / 10}pt`;
  });
}

/**
 * Fix round 1 (B0-30) made a page's content wider than its text column visible past the page; fix round 2 (B1-22): with
 * table indents and anchored drawings now where Word puts them, the page is cut at its edge as Word prints it – a footer
 * text box wider than the paper (TPN's) is not drawn over the grey around the sheet.
 */
export const DOCX_PAGE_OVERFLOW_CSS = "section.docx { overflow: hidden !important; }";

/** Fix round 2 (B1-22): no automatic hyphenation – Word breaks only where the form has a hyphen (Physio-Link). */
export const DOCX_NO_HYPHENATION_CSS = ".docx, .docx * { hyphens: manual !important; -webkit-hyphens: manual !important; }";

/**
 * bh2 WF (B3-22): headers and footers drawn behind the page's text, as Word draws them. docx-preview stacks the footer
 * over the body, so a footer band anchored near the foot of the page (TPN's) hid the last rows of a long completed form.
 */
export const DOCX_HEADER_FOOTER_BEHIND_CSS = "section.docx > header, section.docx > footer { z-index: 0 !important; }";

/** The preview's page rules, scoped to `scope` (".mr-preview"). */
export function docxPageCss(scope: string): string {
  return [DOCX_PAGE_OVERFLOW_CSS, DOCX_NO_HYPHENATION_CSS, DOCX_HEADER_FOOTER_BEHIND_CSS].map((rule) => rule.replace(/^([^{]+)\{/, (_m, sel: string) => `${sel.split(",").map((x) => `${scope} ${x.trim()}`).join(", ")} {`)).join("\n");
}

/** docx-preview options that keep the referrer's layout (page size, margins, headers and footers). */
export const DOCX_PREVIEW_OPTIONS = {
  inWrapper: true,
  ignoreWidth: false,
  ignoreHeight: false,
  ignoreFonts: false,
  breakPages: true,
  ignoreLastRenderedPageBreak: true,
  renderHeaders: true,
  renderFooters: true,
  renderFootnotes: true,
  useBase64URL: true,
  experimental: false,
} as const;
