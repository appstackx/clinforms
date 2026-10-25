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

/** Render a Word file with docx-preview into `host`, then make it inert (sanitizeDocxPreview). */
export async function renderDocxPreview(blob: Blob, host: HTMLElement, options: Record<string, unknown>): Promise<void> {
  const lib = await loadDocxPreview();
  const doc = (await lib.parseAsync(blob, options)) as unknown as {
    _package?: { load(path: string, type?: string): Promise<string | null> };
    documentPart?: { body?: PreviewNode };
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
  const nodes = await lib.renderDocument(doc as never, options);
  host.innerHTML = "";
  for (const n of nodes) host.appendChild(n);
  sanitizeDocxPreview(host);
}

/**
 * Fix round 1 (B0-30): a page's content wider than its text column (a logo, a footer, a table pulled into the margin)
 * is shown, not cut off at the page's edge (docx-preview draws each page with overflow: hidden).
 */
export const DOCX_PAGE_OVERFLOW_CSS = "section.docx { overflow: visible !important; }";

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
