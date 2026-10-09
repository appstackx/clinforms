import "server-only";

/**
 * POST /api/reports/v1/connectors/file-import/bundle
 *
 * Bearer session token (a "demo" session, or one issued for file-import). Body
 * FileImportBundleRequest (ImportPayload {format: json | csv | text, content, fileName?}) →
 * BundleResponse {bundle, computedFacts, dataChecks, trace}. The trace holds one PARSE entry with
 * counts and warnings. Nothing is stored.
 *
 * Errors: 401, 403 SESSION_MISMATCH (a launch session for another connector), 413, 422
 * VALIDATION_FAILED (body shape), 422 IMPORT_INVALID with plain-English `issues` ({path: where,
 * message}, e.g. {path: "line 7, column 'time'", message: "\"9.3\" is not a 24-hour time like 09:30."}).
 *
 * Owner: integration agent.
 */
import { demoDraftAvailability } from "../../ai/draft-demo";
import { assertSessionConnector, requireSession } from "../../auth/session-token";
import { callConnector, requireConnector } from "../../connectors/handler-support";
import { MAX_IMPORT_CHARS } from "../../connectors/file-import/format";
import { computeFacts } from "../../core/computed-facts";
import { runDataChecks } from "../../core/validation/data-checks";
import { FileImportBundleRequestSchema, type BundleResponse } from "../contract";
import { json, logEvent, parseBody, type MedreportHandler } from "../http";

export const handleFileImportBundle: MedreportHandler = async (req, _ctx, deps) => {
  const claims = requireSession(req);
  const connector = requireConnector(deps, "file-import");
  assertSessionConnector(claims, connector.id);
  const parsed = await parseBody(req, FileImportBundleRequestSchema, { maxBytes: MAX_IMPORT_CHARS * 2 + 10_000 });
  if (!parsed.ok) return parsed.response;

  const started = Date.now();
  const cctx = deps.createConnectorContext(req, connector.id, claims.tenantId);
  const bundle = await callConnector(connector.id, () => connector.getEpisodeBundle(cctx, { upload: parsed.data }));
  const body: BundleResponse = {
    bundle,
    computedFacts: computeFacts(bundle),
    dataChecks: runDataChecks(bundle),
    trace: cctx.trace,
    demoDrafts: demoDraftAvailability(bundle),
  };
  logEvent("file_import_parsed", {
    format: parsed.data.format,
    notes: bundle.notes.length,
    appointments: bundle.appointments.length,
    ms: Date.now() - started,
  });
  return json(body);
};
