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

/** Render a Word file with docx-preview into `host`, then make it inert (sanitizeDocxPreview). */
export async function renderDocxPreview(blob: Blob, host: HTMLElement, options: Record<string, unknown>): Promise<void> {
  const lib = await loadDocxPreview();
  await lib.renderAsync(blob, host, undefined, options);
  sanitizeDocxPreview(host);
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
