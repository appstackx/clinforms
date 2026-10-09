/** pdfjs-dist ships no types for its worker entry; forms/pdfjs.ts only hands it to pdfjs as globalThis.pdfjsWorker. */
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
