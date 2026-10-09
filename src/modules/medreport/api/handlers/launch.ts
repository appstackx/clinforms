import "server-only";

/**
 * POST /api/reports/v1/launch  (server-to-server, `x-partner-key`)
 *
 * The clinic system (here: the simulated TM3 sandbox's server action) asks for a launch URL for one
 * patient episode. Body LaunchRequest {connectorId, patientId, episodeId, clinician} →
 * LaunchResponse {launchUrl: <origin>/reports/new?lt=<launch token>, expiresAt}.
 * The launch token is HMAC-SHA256 (MEDREPORT_LAUNCH_SECRET) and expires after 10 minutes.
 *
 * Errors: 401 PARTNER_KEY_INVALID (missing/wrong key, constant-time compare), 422 VALIDATION_FAILED,
 * 404 unknown connector, 503 CONNECTOR_NOT_CONFIGURED, 422 CONNECTOR_UNSUPPORTED (file-import).
 *
 * Owner: integration agent.
 */
import { DEMO_TENANT_ID } from "../../config.public";
import { getSecret } from "../../config.server";
import { createLaunchToken } from "../../auth/launch-token";
import { requireConnector } from "../../connectors/handler-support";
import { HEADERS, LaunchRequestSchema, type LaunchResponse } from "../contract";
import { HttpError, json, logEvent, parseBody, requestOrigin, timingSafeEqualString, type MedreportHandler } from "../http";

export const handleLaunch: MedreportHandler = async (req, _ctx, deps) => {
  const given = req.headers.get(HEADERS.partnerKey)?.trim();
  if (!given || !timingSafeEqualString(given, getSecret("MEDREPORT_PARTNER_KEY"))) {
    throw new HttpError(401, "Partner key required", {
      code: "PARTNER_KEY_INVALID",
      detail: `POST /launch is called server-to-server by the clinic system with a valid '${HEADERS.partnerKey}' header.`,
    });
  }

  const parsed = await parseBody(req, LaunchRequestSchema, { maxBytes: 16_000 });
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  requireConnector(deps, body.connectorId, { capability: "patients", action: "launching from a clinic system" });

  const issued = createLaunchToken({
    tenantId: DEMO_TENANT_ID,
    connectorId: body.connectorId,
    patientId: body.patientId,
    episodeId: body.episodeId,
    clinician: body.clinician,
  });
  const launchUrl = `${requestOrigin(req)}/reports/new?lt=${encodeURIComponent(issued.token)}`;
  logEvent("launch_issued", { connectorId: body.connectorId, patientId: body.patientId, episodeId: body.episodeId });
  const res: LaunchResponse = { launchUrl, expiresAt: issued.expiresAt };
  return json(res, { status: 201 });
};
