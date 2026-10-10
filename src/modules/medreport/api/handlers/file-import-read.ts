import "server-only";

/**
 * POST /api/reports/v1/connectors/file-import/read (production wave 3)
 *
 * An actor, as for /connectors/file-import/bundle; the same body (ImportPayload {format: json | csv | text |
 * pdf | docx, content, fileName?}). The documented import format is tried first:
 *   - in that format → {result: "bundle", data: BundleResponse} (and, for a clinic, a "notes.imported" row);
 *   - otherwise the upload is read as ordinary clinic notes (connectors/file-import/general-notes.ts) →
 *     {result: "review", review: NotesReview, trace}: the registration details, dated entries and outcome
 *     scores found, for staff to check in the Studio. Nothing is built or stored until they confirm
 *     (POST /connectors/file-import/confirm).
 *
 * Errors: 401, 403, 413, 422 VALIDATION_FAILED, 422 IMPORT_INVALID with plain-English `issues` (a scanned PDF,
 * a file with no dated notes, a documented-format CSV with mistakes).
 *
 * Owner: integration agent.
 */
import { assertActorConnector, requireActor } from "../../auth/actor";
import { readNotesUpload } from "../../connectors/file-import/connector";
import { MAX_IMPORT_CHARS } from "../../connectors/file-import/format";
import { callConnector, requireConnector } from "../../connectors/handler-support";
import { FileImportBundleRequestSchema, type FileImportReadResponse } from "../contract";
import { json, logEvent, parseBody, type MedreportHandler } from "../http";
import { auditNotesImported, bundleResponseFor } from "./file-import-response";

export const handleFileImportRead: MedreportHandler = async (req, _ctx, deps) => {
  const actor = await requireActor(req, deps);
  const connector = requireConnector(deps, "file-import", { tenantId: actor.tenantId });
  assertActorConnector(actor, connector.id);
  const parsed = await parseBody(req, FileImportBundleRequestSchema, { maxBytes: MAX_IMPORT_CHARS * 2 + 10_000 });
  if (!parsed.ok) return parsed.response;

  const started = Date.now();
  const cctx = deps.createConnectorContext(req, connector.id, actor.tenantId);
  const outcome = await callConnector(connector.id, () => readNotesUpload(cctx, parsed.data));
  if (outcome.kind === "review") {
    const { review } = outcome;
    logEvent("notes_read", {
      format: parsed.data.format,
      layout: "general",
      entries: review.entries.length,
      dated: review.entries.filter((e) => e.date).length,
      scores: review.outcomes.length,
      fields: review.detected.length,
      ms: Date.now() - started,
    });
    const body: FileImportReadResponse = { result: "review", review, trace: cctx.trace };
    return json(body);
  }
  const data = await bundleResponseFor(deps, actor, outcome.bundle, cctx.trace);
  await auditNotesImported(deps, actor, data.bundle, { format: parsed.data.format, layout: "documented" });
  logEvent("file_import_parsed", {
    format: parsed.data.format,
    notes: data.bundle.notes.length,
    appointments: data.bundle.appointments.length,
    ms: Date.now() - started,
  });
  const body: FileImportReadResponse = { result: "bundle", data };
  return json(body);
};
