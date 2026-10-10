import "server-only";

/**
 * GET /api/reports/v1/connectors/[id]/patients?search=
 *
 * An actor (auth/actor.ts: a clinic's signed-in member, or a public-demo session). Query PatientsQuery →
 * PatientsResponse {patients, trace}: patient summaries (with episode summaries, so the picker needs no
 * second call) and the integration trace. A launch-bound actor only ever sees its own patient. The
 * simulated TM3 sandbox serves the public demo only (403 CONNECTOR_NOT_AVAILABLE for a clinic).
 *
 * Errors: 401, 403 SESSION_MISMATCH (session bound to another connector), 404 unknown connector,
 * 503 CONNECTOR_NOT_CONFIGURED, 422 CONNECTOR_UNSUPPORTED (no patient search, e.g. file import),
 * 502 CONNECTOR_ERROR.
 *
 * Owner: integration agent (wave 2: API slice).
 */
import { assertActorConnector, requireActor } from "../../auth/actor";
import { callConnector, requireConnector } from "../../connectors/handler-support";
import { PatientsQuerySchema, type PatientsResponse } from "../contract";
import { HttpError, json, logEvent, parseQuery, type MedreportHandler } from "../http";

export const handlePatients: MedreportHandler = async (req, ctx, deps) => {
  const actor = await requireActor(req, deps);
  const connector = requireConnector(deps, ctx.params.id, { capability: "patients", action: "patient search", tenantId: actor.tenantId });
  assertActorConnector(actor, connector.id);
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
  const cctx = deps.createConnectorContext(req, connector.id, actor.tenantId);
  const all = await callConnector(connector.id, () => searchPatients.call(connector, cctx, { search: query.data.search }));
  const scope = actor.scope;
  const patients = scope
    ? all.filter((p) => p.id === scope.patientId).map((p) => ({ ...p, episodes: p.episodes.filter((e) => e.id === scope.episodeId) }))
    : all;
  logEvent("patients_listed", { connectorId: connector.id, count: patients.length, calls: cctx.trace.length, ms: Date.now() - started });
  const body: PatientsResponse = { patients, trace: cctx.trace };
  return json(body);
};
