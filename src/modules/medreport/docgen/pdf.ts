import "server-only";

/**
 * PDF output: @react-pdf/renderer@4.9.0 renderToBuffer(<ReportPdf vm/>) in the house layout, with
 * DejaVu Sans registered from the bundled base64 font (pdf/fonts.ts). DRAFT watermark when unsigned;
 * footer with the fingerprint and "Page x of y".
 *
 * @react-pdf/renderer is ESM-only: it is loaded with a dynamic import() and handed to createReportPdf().
 *
 * Owner: forms-engine agent (formerly docgen).
 */
import React from "react";
import { ensurePdfFonts } from "./pdf/fonts";
import { createReportPdf } from "./pdf/ReportPdf";
import type { ReportViewModel } from "./view-model";

export async function renderPdf(vm: ReportViewModel): Promise<Uint8Array> {
  const rp = await import("@react-pdf/renderer");
  ensurePdfFonts(rp.Font);
  const ReportPdf = createReportPdf(rp);
  // renderToBuffer is typed for a <Document> element; ReportPdf renders one (the cast the spike noted).
  const element = React.createElement(ReportPdf, { vm }) as unknown as Parameters<typeof rp.renderToBuffer>[0];
  const buffer = await rp.renderToBuffer(element);
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}
