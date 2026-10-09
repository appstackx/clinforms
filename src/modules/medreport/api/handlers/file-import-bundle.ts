import "server-only";

/**
 * POST /api/reports/v1/connectors/file-import/bundle
 *
 * An actor (auth/actor.ts: a clinic's signed-in member, or a public-demo session not bound to another
 * connector). Body FileImportBundleRequest (ImportPayload {format: json | csv | text | pdf, content,
 * fileName?}) → BundleResponse {bundle, computedFacts, dataChecks, trace}. The trace holds one PARSE entry
 * with counts and warnings. Nothing is stored.
 *
 * Wave 2: the bundle is stamped with the actor's clinic (tenantId) and – for a clinic – carries the
 * clinic's own details from its profile (bundle.clinic, core/clinic.ts), which replace the fictional
 * DEMO_CLINIC in its forms and letters. The public demo's bundles are unchanged.
 *
 * Errors: 401, 403 SESSION_MISMATCH (a launch session for another connector), 413, 422
 * VALIDATION_FAILED (body shape), 422 IMPORT_INVALID with plain-English `issues` ({path: where,
 * message}, e.g. {path: "line 7, column 'time'", message: "\"9.3\" is not a 24-hour time like 09:30."}).
 *
 * Owner: integration agent.
 */
import { demoDraftAvailability } from "../../ai/draft-demo";
import { assertActorConnector, clinicProfileOf, requireActor } from "../../auth/actor";
import { callConnector, requireConnector } from "../../connectors/handler-support";
import { MAX_IMPORT_CHARS } from "../../connectors/file-import/format";
import { clinicDetailsFromProfile } from "../../core/clinic";
import { computeFacts } from "../../core/computed-facts";
import { runDataChecks } from "../../core/validation/data-checks";
import { FileImportBundleRequestSchema, type BundleResponse } from "../contract";
import { json, logEvent, parseBody, type MedreportHandler } from "../http";

export const handleFileImportBundle: MedreportHandler = async (req, _ctx, deps) => {
  const actor = await requireActor(req, deps);
  const connector = requireConnector(deps, "file-import", { tenantId: actor.tenantId });
  assertActorConnector(actor, connector.id);
  const parsed = await parseBody(req, FileImportBundleRequestSchema, { maxBytes: MAX_IMPORT_CHARS * 2 + 10_000 });
  if (!parsed.ok) return parsed.response;

  const started = Date.now();
  const cctx = deps.createConnectorContext(req, connector.id, actor.tenantId);
  const imported = await callConnector(connector.id, () => connector.getEpisodeBundle(cctx, { upload: parsed.data }));
  // A clinic's bundle names the clinic from its own profile (never the fictional demo clinic).
  const profile = await clinicProfileOf(deps, actor);
  const bundle = profile ? { ...imported, tenantId: actor.tenantId, clinic: clinicDetailsFromProfile(profile) } : { ...imported, tenantId: actor.tenantId };
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
