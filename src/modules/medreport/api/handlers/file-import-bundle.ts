import "server-only";

/**
 * POST /api/reports/v1/connectors/file-import/bundle
 *
 * An actor (auth/actor.ts: a clinic's signed-in member, or a public-demo session not bound to another
 * connector). Body FileImportBundleRequest (ImportPayload {format: json | csv | text | pdf | docx, content,
 * fileName?}) → BundleResponse {bundle, computedFacts, dataChecks, trace}. The trace holds one PARSE entry
 * with counts and warnings. Nothing is stored. Our DOCUMENTED import format only – the Studio uses
 * /connectors/file-import/read (wave 3), which also reads ordinary clinic notes for staff to check.
 *
 * Wave 2: the bundle is stamped with the actor's clinic (tenantId) and – for a clinic – carries the
 * clinic's own details from its profile (bundle.clinic, core/clinic.ts), which replace the fictional
 * DEMO_CLINIC in its forms and letters. The public demo's bundles are unchanged.
 * Wave 3: a clinic's import is recorded in its activity ("notes.imported": format and counts only).
 *
 * Errors: 401, 403 SESSION_MISMATCH (a launch session for another connector), 413, 422
 * VALIDATION_FAILED (body shape), 422 IMPORT_INVALID with plain-English `issues` ({path: where,
 * message}, e.g. {path: "line 7, column 'time'", message: "\"9.3\" is not a 24-hour time like 09:30."}).
 *
 * Owner: integration agent.
 */
import { assertActorConnector, requireActor } from "../../auth/actor";
import { callConnector, requireConnector } from "../../connectors/handler-support";
import { MAX_IMPORT_CHARS } from "../../connectors/file-import/format";
import { FileImportBundleRequestSchema } from "../contract";
import { json, logEvent, parseBody, type MedreportHandler } from "../http";
import { auditNotesImported, bundleResponseFor } from "./file-import-response";

export const handleFileImportBundle: MedreportHandler = async (req, _ctx, deps) => {
  const actor = await requireActor(req, deps);
  const connector = requireConnector(deps, "file-import", { tenantId: actor.tenantId });
  assertActorConnector(actor, connector.id);
  const parsed = await parseBody(req, FileImportBundleRequestSchema, { maxBytes: MAX_IMPORT_CHARS * 2 + 10_000 });
  if (!parsed.ok) return parsed.response;

  const started = Date.now();
  const cctx = deps.createConnectorContext(req, connector.id, actor.tenantId);
  const imported = await callConnector(connector.id, () => connector.getEpisodeBundle(cctx, { upload: parsed.data }));
  const body = await bundleResponseFor(deps, actor, imported, cctx.trace);
  await auditNotesImported(deps, actor, body.bundle, { format: parsed.data.format, layout: "documented" });
  logEvent("file_import_parsed", {
    format: parsed.data.format,
    notes: body.bundle.notes.length,
    appointments: body.bundle.appointments.length,
    ms: Date.now() - started,
  });
  return json(body);
};
