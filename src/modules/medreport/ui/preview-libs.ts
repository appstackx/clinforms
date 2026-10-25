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
  // Fix round 2 (B1-22): a drawing anchored to the page, its margin or its column where Word puts it – positioned on its
  // page (docx-preview places it by the text around it, so the TPN logo overhung the page edge). docx-preview draws
  // every drawing "position: relative", so each is tagged with a class here and placed once drawn. Best effort: a part
  // whose drawings do not line up with its XML is drawn as before.
  const placed: AnchorPlacement[] = [];
  try {
    const xml = (await doc._package?.load("word/document.xml", "string")) ?? "";
    const page = pageGeometryOf(xml);
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
  const nodes = await lib.renderDocument(doc as never, options);
  host.innerHTML = "";
  for (const n of nodes) host.appendChild(n);
  placeAnchoredDrawings(host, placed);
  sanitizeDocxPreview(host);
}

const ANCHOR_CLASS = "mr-anchor-";

/** Each tagged drawing on its page (its section), at the placement its tag names (fix round 2, B1-22). */
function placeAnchoredDrawings(host: HTMLElement, placed: readonly AnchorPlacement[]): void {
  if (placed.length === 0) return;
  host.querySelectorAll<HTMLElement>(`[class*="${ANCHOR_CLASS}"]`).forEach((el) => {
    const n = new RegExp(`(?:^|\\s)${ANCHOR_CLASS}(\\d+)(?:\\s|$)`).exec(el.className)?.[1];
    const at = n === undefined ? undefined : placed[Number(n)];
    if (!at) return;
    Object.assign(el.style, { position: "absolute", display: "block", float: "none", margin: "0", left: `${at.left}pt`, top: `${at.top}pt`, width: `${at.width}pt`, height: `${at.height}pt`, zIndex: "2" });
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
