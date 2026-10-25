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
 * Shared contract (orchestrator-owned).
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

/** Render a Word file with docx-preview into `host`, then make it inert (sanitizeDocxPreview). */
export async function renderDocxPreview(blob: Blob, host: HTMLElement, options: Record<string, unknown>): Promise<void> {
  const lib = await loadDocxPreview();
  const doc = (await lib.parseAsync(blob, options)) as unknown as {
    _package?: { load(path: string, type?: string): Promise<string | null> };
    documentPart?: { body?: PreviewNode };
    parts?: Array<{ path?: string; rootElement?: PreviewNode; body?: PreviewNode }>;
  };
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
  try {
    const xml = (await doc._package?.load("word/document.xml", "string")) ?? "";
    page = pageGeometryOf(xml);
    for (const part of page ? (doc.parts ?? []) : []) {
      const root = part.rootElement ?? part.body;
      if (!root || !part.path || !/^word\/(?:document|header\d*|footer\d*)\.xml$/.test(part.path)) continue;
      const partXml = part.path === "word/document.xml" ? xml : ((await doc._package?.load(part.path, "string")) ?? "");
      const placements = anchorPlacementsOf(partXml, page as PageGeometry);
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
  let tabs: TabbedParagraphs = { stops: [], defaultStop: 36 };
  let appPages: number | null = null;
  try {
    markPageFields(doc);
    tabs = markTabbedParagraphs(doc);
    appPages = pagesOfAppXml((await doc._package?.load("docProps/app.xml", "string")) ?? "");
  } catch {
    // as docx-preview draws it
  }
  const nodes = await lib.renderDocument(doc as never, options);
  host.innerHTML = "";
  for (const n of nodes) host.appendChild(n);
  fillPageFields(host, appPages);
  // Fix round 3 (B2-27): the drawings are moved by measuring them as drawn, which needs the host on the page. The
  // review's Preview draws into a host not yet on the page (it is made inert first): there the placing waits for
  // placeDocxDrawings(), called once the host is shown – it was skipped, so TPN's first-page banner stayed cut off.
  if (page) {
    const pending = { placed, page, tabs, appPages };
    if (host.isConnected) placeMeasured(host, pending);
    else pendingPlacements.set(host, pending);
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
  addContinuousNote(pages[0], appPages ?? Math.ceil(r.height / pageHeight));
}

function addContinuousNote(sheet: HTMLElement | undefined, pages: number): void {
  if (!sheet?.parentElement) return;
  const note = document.createElement("p");
  note.className = CONTINUOUS_CLASS;
  note.textContent = `Shown as one continuous sheet – Word prints this form on ${pages} pages.`;
  note.setAttribute("style", "margin:0 0 8px;font:12px/1.4 system-ui,sans-serif;color:#475569;");
  sheet.parentElement.insertBefore(note, sheet);
}

/** Place the anchored drawings (and tab stops) of a preview drawn into a host that was not on the page yet (renderDocxPreview). */
export function placeDocxDrawings(host: HTMLElement): void {
  const pending = pendingPlacements.get(host);
  if (!pending || !host.isConnected) return;
  pendingPlacements.delete(host);
  placeMeasured(host, pending);
}

/* ------------------------------------------------------------------------------------------------
 * Fix round 3 (B2-28): page numbers, one continuous sheet, tab stops
 * ----------------------------------------------------------------------------------------------*/

interface FieldNode extends PreviewNode {
  charType?: string;
  instruction?: string;
  text?: string;
  fieldRun?: boolean;
  tabs?: Array<{ position?: string; style?: string }>;
}

export const PAGE_TOKEN = "\u2060#PAGE#\u2060";
export const NUMPAGES_TOKEN = "\u2060#NUMPAGES#\u2060";

/** The token a page-number field instruction (" PAGE ", "NUMPAGES \\* Arabic") is drawn as, or null. */
export function pageFieldToken(instruction: string | undefined): string | null {
  const m = /^\s*(PAGE|NUMPAGES|SECTIONPAGES)\b/i.exec(instruction ?? "");
  return m ? (m[1].toUpperCase() === "PAGE" ? PAGE_TOKEN : NUMPAGES_TOKEN) : null;
}

/** Every paragraph of the parsed document (body, headers, footers). */
function paragraphsOf(node: PreviewNode | undefined, out: FieldNode[] = []): FieldNode[] {
  if (!node) return out;
  if (node.type === "paragraph") out.push(node as FieldNode);
  for (const child of node.children ?? []) paragraphsOf(child, out);
  return out;
}

type ParsedDoc = { documentPart?: { body?: PreviewNode }; parts?: Array<{ rootElement?: PreviewNode; body?: PreviewNode }>; settingsPart?: { settings?: { defaultTabStop?: string } } };

function allParagraphs(doc: ParsedDoc): FieldNode[] {
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
 * A PAGE / NUMPAGES field whose result the file does not hold (Bodycare's "Page  of") – or a simple field, which
 * docx-preview does not draw – gets a token in its place, filled with the page's number once drawn (fillPageFields).
 */
function markPageFields(doc: ParsedDoc): void {
  for (const p of allParagraphs(doc)) {
    const runs = (p.children ?? []) as FieldNode[];
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      // <w:fldSimple w:instr="PAGE">
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
      let hasText = false;
      while (k < runs.length && !(runs[k].children ?? []).some((c) => (c as FieldNode).charType === "end")) {
        if (!runs[k].fieldRun && (runs[k].children ?? []).some((c) => (c as FieldNode).type === "text" && ((c as FieldNode).text ?? "").trim())) hasText = true;
        k += 1;
      }
      if (hasText) continue;
      runs.splice(j + 1, 0, { type: "run", children: [{ type: "text", text: token } as FieldNode] });
      i = k + 1;
    }
  }
}

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
    const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue || n.nodeValue.indexOf("\u2060#") < 0) continue;
      n.nodeValue = n.nodeValue.split(PAGE_TOKEN).join(continuous ? "1" : String(i + 1)).split(NUMPAGES_TOKEN).join(String(total));
    }
  });
  if (continuous && !host.querySelector(`.${CONTINUOUS_CLASS}`)) addContinuousNote(pages[0], appPages as number);
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
    const spans = Array.from(p.querySelectorAll<HTMLElement>("span")).filter((s) => s.childElementCount === 0 && s.textContent === "\u2003");
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

/** The preview's page rules, scoped to `scope` (".mr-preview"). */
export function docxPageCss(scope: string): string {
  return [DOCX_PAGE_OVERFLOW_CSS, DOCX_NO_HYPHENATION_CSS].map((rule) => rule.replace(/^([^{]+)\{/, (_m, sel: string) => `${sel.split(",").map((x) => `${scope} ${x.trim()}`).join(", ")} {`)).join("\n");
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
