import "server-only";

/**
 * "Notes export upload – available now": maps the patient's notes printed or saved as a PDF from the
 * clinic system (./pdf-notes.ts), an export in OUR documented format (JSON or CSV), or pasted notes to
 * an EpisodeBundle (./format.ts, ./parser.ts).
 * id "file-import", status "available", simulated false, no patient search and no write-back.
 *
 * Records one TraceEntry for the parse (method "PARSE", transport "in-process") so the Studio's
 * Integration Log shows what was read, plus any warnings (never the content).
 *
 * Owner: integration agent.
 */
import { ConnectorError, type ClinicSystemConnector } from "../types";
import { ImportError, parseImport } from "./parser";
import { printedNotesToText } from "./pdf-notes";

export const FILE_IMPORT_NOTE = "Notes export upload – available now";

export function createFileImportConnector(): ClinicSystemConnector {
  return {
    id: "file-import",
    label: "Upload TM3 export",
    simulated: false,
    status: "available",
    capabilities: {
      patients: false,
      clinicalNotes: true,
      appointments: true,
      outcomeMeasures: true,
      writeBackDocuments: false,
    },
    note: FILE_IMPORT_NOTE,

    async getEpisodeBundle(ctx, ref) {
      if (!("upload" in ref)) {
        throw new ConnectorError(
          "UNSUPPORTED",
          "The file-import connector reads uploaded exports only; it cannot look up patients in a clinic system.",
        );
      }
      let payload = ref.upload;
      const started = Date.now();
      let pdfPages = 0;
      if (payload.format === "pdf") {
        try {
          const read = await printedNotesToText(payload.content);
          pdfPages = read.pages;
          payload = { format: "text", content: read.text, fileName: payload.fileName ?? "Printed notes (PDF)" };
        } catch (err) {
          ctx.trace.push({ method: "PARSE", url: "file-import/pdf", status: 422, ms: Date.now() - started, transport: "in-process", note: "The PDF could not be read as printed notes" });
          throw err;
        }
      }
      const result = parseImport(payload, { tenantId: ctx.tenantId });
      const url = pdfPages ? "file-import/pdf" : `file-import/${payload.format}`;
      if (!result.ok) {
        ctx.trace.push({
          method: "PARSE",
          url,
          status: 422,
          ms: Date.now() - started,
          transport: "in-process",
          note: `${result.issues.length} problem${result.issues.length === 1 ? "" : "s"} found`,
        });
        throw new ImportError(result.issues);
      }
      const { stats, warnings } = result;
      const parts = [
        ...(pdfPages ? [`printed notes PDF, ${pdfPages} page${pdfPages === 1 ? "" : "s"}`] : []),
        `${stats.notes} note${stats.notes === 1 ? "" : "s"}`,
        `${stats.appointments} appointment${stats.appointments === 1 ? "" : "s"}`,
        `${stats.outcomeSeries} outcome series`,
      ];
      if (warnings.length) {
        parts.push(`${warnings.length} warning${warnings.length === 1 ? "" : "s"}: ${warnings.map((w) => w.message).join(" ")}`);
      }
      ctx.trace.push({
        method: "PARSE",
        url,
        status: 200,
        ms: Date.now() - started,
        transport: "in-process",
        note: parts.join(" · "),
      });
      return result.bundle;
    },
  };
}
