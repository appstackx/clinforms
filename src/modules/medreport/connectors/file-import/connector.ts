import "server-only";

/**
 * "Notes export upload – available now": maps the patient's notes printed or saved as a PDF from the
 * clinic system (./pdf-notes.ts), an export in OUR documented format (JSON or CSV), or pasted notes to
 * an EpisodeBundle (./format.ts, ./parser.ts).
 * id "file-import", status "available", simulated false, no patient search and no write-back.
 *
 * Wave 3 – ordinary clinic notes: `readNotesUpload` (POST /connectors/file-import/read) tries the documented
 * format first; when an upload is not in it, the general notes reader (./general-notes.ts) reads it – a PDF's
 * text, a Word document (./docx-notes.ts), a text file, a CSV export or pasted text – and returns a NotesReview
 * for staff to check (./review-contract.ts); the bundle is built only when they confirm (./review-bundle.ts).
 * `getEpisodeBundle` (POST /connectors/file-import/bundle) stays the documented format only.
 *
 * Records one TraceEntry for the parse (method "PARSE", transport "in-process") so the Studio's
 * Integration Log shows what was read, plus any warnings (never the content).
 *
 * Owner: integration agent.
 */
import type { EpisodeBundle, ImportPayload } from "../../core/types";
import { ConnectorError, type ClinicSystemConnector, type ConnectorContext } from "../types";
import { docxNotesToBlocks } from "./docx-notes";
import { CSV_REQUIRED_COLUMNS } from "./format";
import { csvToBlocks, readGeneralNotes, textToBlocks, type NotesBlock } from "./general-notes";
import { ImportError, parseImport, type ImportIssue, type ImportResult, type ImportStats } from "./parser";
import { pdfPagesToBlocks, readPrintedNotes } from "./pdf-notes";
import type { NotesReview } from "./review-contract";

export const FILE_IMPORT_NOTE = "Notes export upload – available now";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function parsedNote(stats: ImportStats, warnings: ImportIssue[], pdfPages: number, extra?: string): string {
  const parts = [
    ...(pdfPages ? [`printed notes PDF, ${plural(pdfPages, "page")}`] : []),
    ...(extra ? [extra] : []),
    plural(stats.notes, "note"),
    plural(stats.appointments, "appointment"),
    `${stats.outcomeSeries} outcome series`,
  ];
  if (warnings.length) parts.push(`${plural(warnings.length, "warning")}: ${warnings.map((w) => w.message).join(" ")}`);
  return parts.join(" · ");
}

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
          const read = await readPrintedNotes(payload.content);
          pdfPages = read.pages;
          payload = { format: "text", content: read.text, fileName: payload.fileName ?? "Printed notes (PDF)" };
        } catch (err) {
          ctx.trace.push({ method: "PARSE", url: "file-import/pdf", status: 422, ms: Date.now() - started, transport: "in-process", note: "The PDF could not be read as printed notes" });
          throw err;
        }
      } else if (payload.format === "docx") {
        payload = { format: "text", content: docxNotesToBlocks(payload.content).text, fileName: payload.fileName ?? "Notes (Word)" };
      }
      const result = parseImport(payload, { tenantId: ctx.tenantId });
      const url = pdfPages ? "file-import/pdf" : `file-import/${ref.upload.format}`;
      if (!result.ok) {
        ctx.trace.push({
          method: "PARSE",
          url,
          status: 422,
          ms: Date.now() - started,
          transport: "in-process",
          note: `${plural(result.issues.length, "problem")} found`,
        });
        throw new ImportError(result.issues);
      }
      ctx.trace.push({ method: "PARSE", url, status: 200, ms: Date.now() - started, transport: "in-process", note: parsedNote(result.stats, result.warnings, pdfPages) });
      return result.bundle;
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * Wave 3: documented format first, then ordinary clinic notes for staff to check
 * ----------------------------------------------------------------------------------------------*/

export type NotesUploadOutcome =
  | {
      kind: "bundle";
      /** The upload was in the documented import format. */
      layout: "documented";
      bundle: EpisodeBundle;
      stats: ImportStats;
      warnings: ImportIssue[];
    }
  | { kind: "review"; review: NotesReview };

/** A strict (documented-format) result is used as it is unless a note had no author: then the notes are read generally. */
function strictUsable(result: ImportResult): result is Extract<ImportResult, { ok: true }> {
  return result.ok && !result.bundle.notes.some((n) => n.author.name === "Not recorded");
}

/** The CSV header row names every required column of our documented format (then its problems are reported as they are). */
function looksLikeDocumentedCsv(content: string): boolean {
  const header = content
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .find((l) => l.trim() && !l.trim().startsWith("#"));
  if (!header) return false;
  const cols = header.split(",").map((c) => c.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  return CSV_REQUIRED_COLUMNS.every((c) => cols.indexOf(c) >= 0);
}

/**
 * Reads an upload: the documented format (JSON / CSV / text, or a PDF or Word document in that layout) gives
 * the bundle straight away; anything else is read as ordinary clinic notes and returned as a NotesReview.
 * Throws ImportError (plain-English issues) when neither works, e.g. a scanned PDF.
 */
export async function readNotesUpload(ctx: ConnectorContext, upload: ImportPayload, opts: { now?: Date } = {}): Promise<NotesUploadOutcome> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const trace = (status: number, note: string) =>
    ctx.trace.push({ method: "PARSE", url: `file-import/${upload.format}`, status, ms: Date.now() - started, transport: "in-process", note });
  const strict = (format: "json" | "csv" | "text", content: string, fileName?: string) =>
    parseImport({ format, content, ...(fileName ? { fileName } : {}) }, { tenantId: ctx.tenantId, now });

  let blocks: NotesBlock[];
  let pages = 0;
  let strictResult: ImportResult | null = null;
  try {
    switch (upload.format) {
      case "json": {
        strictResult = strict("json", upload.content, upload.fileName);
        if (!strictResult.ok) throw new ImportError(strictResult.issues);
        blocks = [];
        break;
      }
      case "csv": {
        strictResult = strict("csv", upload.content, upload.fileName);
        if (!strictResult.ok && looksLikeDocumentedCsv(upload.content)) throw new ImportError(strictResult.issues);
        blocks = csvToBlocks(upload.content);
        break;
      }
      case "text": {
        strictResult = strict("text", upload.content, upload.fileName);
        blocks = textToBlocks(upload.content);
        break;
      }
      case "pdf": {
        const read = await readPrintedNotes(upload.content);
        pages = read.pages;
        strictResult = strict("text", read.text, upload.fileName ?? "Printed notes (PDF)");
        blocks = pdfPagesToBlocks(read.pageLines);
        break;
      }
      case "docx": {
        const read = docxNotesToBlocks(upload.content);
        // A table of notes (three or more columns) is not the documented layout: read it as clinic notes only.
        const notesTable = read.blocks.some((b) => b.kind === "table" && b.rows.some((r) => r.filter((c) => c.trim()).length >= 3));
        strictResult = notesTable ? null : strict("text", read.text, upload.fileName ?? "Notes (Word)");
        blocks = read.blocks;
        break;
      }
      default:
        throw new ImportError([{ where: "format", message: "Unknown format. Upload a PDF, Word, CSV or text file." }]);
    }
  } catch (err) {
    if (err instanceof ImportError) trace(422, `${plural(err.issues.length, "problem")} found`);
    throw err;
  }

  if (strictResult && (strictUsable(strictResult) || (upload.format === "json" && strictResult.ok))) {
    trace(200, parsedNote(strictResult.stats, strictResult.warnings, pages, "documented layout"));
    return { kind: "bundle", layout: "documented", bundle: strictResult.bundle, stats: strictResult.stats, warnings: strictResult.warnings };
  }

  const general = readGeneralNotes({
    format: upload.format === "json" ? "text" : upload.format,
    blocks,
    ...(upload.fileName ? { fileName: upload.fileName } : {}),
    pages,
    now,
  });
  if (!general.ok) {
    trace(422, "No notes found");
    throw new ImportError([{ where: "file", message: general.message }]);
  }
  const { review } = general;
  const included = review.entries.filter((e) => e.include).length;
  trace(
    200,
    [
      ...(pages ? [`printed notes PDF, ${plural(pages, "page")}`] : []),
      "read as clinic notes – to be checked",
      plural(review.entries.length, "entry", "entries"),
      `${included} dated`,
      plural(review.outcomes.length, "outcome score"),
      `${review.detected.length} patient details found`,
    ].join(" · "),
  );
  return { kind: "review", review };
}
