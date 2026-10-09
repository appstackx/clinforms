import "server-only";

/**
 * GET /api/reports/v1/connectors/[id]/patients?search=
 *
 * Bearer session token. Query PatientsQuery → PatientsResponse {patients, trace}: patient summaries
 * (with episode summaries, so the picker needs no second call) and the integration trace.
 * A "launch" session only ever sees its own patient.
 *
 * Errors: 401 (session), 403 SESSION_MISMATCH (session bound to another connector), 404 unknown
 * connector, 503 CONNECTOR_NOT_CONFIGURED, 422 CONNECTOR_UNSUPPORTED (no patient search, e.g. file
 * import), 502 CONNECTOR_ERROR.
 *
 * Owner: integration agent.
 */
import { assertSessionConnector, requireSession } from "../../auth/session-token";
import { callConnector, requireConnector } from "../../connectors/handler-support";
import { PatientsQuerySchema, type PatientsResponse } from "../contract";
import { HttpError, json, logEvent, parseQuery, type MedreportHandler } from "../http";

export const handlePatients: MedreportHandler = async (req, ctx, deps) => {
  const claims = requireSession(req);
  const connector = requireConnector(deps, ctx.params.id, { capability: "patients", action: "patient search" });
  assertSessionConnector(claims, connector.id);
  const query = parseQuery(req, PatientsQuerySchema);
  if (!query.ok) return query.response;
  const searchPatients = connector.searchPatients;
  if (!searchPatients) {
    throw new HttpError(422, "Not supported by this connector", {
      code: "CONNECTOR_UNSUPPORTED",
      detail: `${connector.label} does not support patient search.`,
    });
  }

  const started = Date.now();
  const cctx = deps.createConnectorContext(req, connector.id, claims.tenantId);
  const all = await callConnector(connector.id, () => searchPatients.call(connector, cctx, { search: query.data.search }));
  const patients =
    claims.kind === "launch"
      ? all
          .filter((p) => p.id === claims.patientId)
          .map((p) => ({ ...p, episodes: p.episodes.filter((e) => e.id === claims.episodeId) }))
      : all;
  logEvent("patients_listed", { connectorId: connector.id, count: patients.length, calls: cctx.trace.length, ms: Date.now() - started });
  const body: PatientsResponse = { patients, trace: cctx.trace };
  return json(body);
};
