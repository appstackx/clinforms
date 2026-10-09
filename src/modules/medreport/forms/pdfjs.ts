import "server-only";

/**
 * Loads pdfjs-dist@6.4.299 (legacy build) for SERVER-side text and field extraction in Node 22.
 *
 * - The legacy build is the one that runs in Node; the browser preview (ui/) imports pdfjs-dist itself.
 * - No worker thread: the worker module is imported here and exposed as globalThis.pdfjsWorker, which
 *   pdfjs uses for its in-process "fake worker" (works inside the Next.js server bundle, where a
 *   worker file path cannot be resolved).
 * - @napi-rs/canvas (an optional dependency) is NOT needed for text/annotation extraction; when it is
 *   missing (e.g. on Vercel) pdfjs only warns that rendering polyfills are unavailable.
 * - Use getDocument(pdfjsDocumentParams(bytes)) and destroy the loading task when done.
 *
 * Owner: forms-engine agent (contract-stage implementation, verified in Node and in `next build`).
 */
type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let loading: Promise<PdfjsModule> | null = null;

export function loadPdfjs(): Promise<PdfjsModule> {
  if (!loading) {
    loading = (async () => {
      const g = globalThis as typeof globalThis & { pdfjsWorker?: unknown };
      if (!g.pdfjsWorker) g.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
      return import("pdfjs-dist/legacy/build/pdf.mjs");
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** getDocument() parameters for server-side extraction (no eval, no font loading, errors only). */
export function pdfjsDocumentParams(bytes: Uint8Array) {
  // pdfjs may transfer/detach the buffer it is given, so hand it a copy.
  const data = new Uint8Array(bytes.byteLength);
  data.set(bytes);
  return {
    data,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
  } as const;
}
