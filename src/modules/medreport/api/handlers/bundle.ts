import "server-only";

/**
 * GET /api/reports/v1/connectors/[id]/patients/[pid]/episodes/[eid]/bundle
 *
 * Bearer session token; a "launch" session's claims must match the path (403 SESSION_MISMATCH); a
 * "demo" session may read any demo-tenant episode (of its connector, if it has one).
 * → BundleResponse {bundle, computedFacts, dataChecks, trace}. Computed facts use today's date
 * (Europe/London) as the report date; the browser recomputes them for the report's own date.
 *
 * Errors: 401, 403, 404 (connector or episode), 503 CONNECTOR_NOT_CONFIGURED, 422
 * CONNECTOR_UNSUPPORTED (e.g. a self-referred episode), 502 CONNECTOR_ERROR.
 *
 * Owner: integration agent.
 */
import { demoDraftAvailability } from "../../ai/draft-demo";
import { assertSessionConnector, assertSessionEpisode, requireSession } from "../../auth/session-token";
import { callConnector, requireConnector } from "../../connectors/handler-support";
import { computeFacts } from "../../core/computed-facts";
import { EpisodeBundleSchema } from "../../core/schemas";
import { runDataChecks } from "../../core/validation/data-checks";
import type { BundleResponse } from "../contract";
import { HttpError, json, logEvent, type MedreportHandler } from "../http";

export const handleBundle: MedreportHandler = async (req, ctx, deps) => {
  const claims = requireSession(req);
  const connector = requireConnector(deps, ctx.params.id, { capability: "clinicalNotes", action: "reading episodes" });
  assertSessionConnector(claims, connector.id);
  const patientId = ctx.params.pid ?? "";
  const episodeId = ctx.params.eid ?? "";
  if (!patientId || !episodeId) throw new HttpError(400, "Patient and episode are required", { code: "BAD_REQUEST" });
  assertSessionEpisode(claims, { tenantId: claims.tenantId, connectorId: connector.id, patientId, episodeId });

  const started = Date.now();
  const cctx = deps.createConnectorContext(req, connector.id, claims.tenantId);
  const raw = await callConnector(connector.id, () => connector.getEpisodeBundle(cctx, { patientId, episodeId }));
  const checked = EpisodeBundleSchema.safeParse(raw);
  if (!checked.success) {
    logEvent("bundle_invalid", { connectorId: connector.id, patientId, episodeId, issues: checked.error.issues.length });
    throw new HttpError(502, "The clinic system returned unexpected data", {
      code: "CONNECTOR_ERROR",
      detail: "The episode could not be mapped to a report bundle.",
    });
  }
  const bundle = checked.data;
  const body: BundleResponse = {
    bundle,
    computedFacts: computeFacts(bundle),
    dataChecks: runDataChecks(bundle),
    trace: cctx.trace,
    demoDrafts: demoDraftAvailability(bundle),
  };
  logEvent("bundle_fetched", {
    connectorId: connector.id,
    patientId,
    episodeId,
    notes: bundle.notes.length,
    appointments: bundle.appointments.length,
    calls: cctx.trace.length,
    transport: cctx.trace.some((t) => t.transport === "in-process") ? "in-process" : "http",
    ms: Date.now() - started,
  });
  return json(body);
};
