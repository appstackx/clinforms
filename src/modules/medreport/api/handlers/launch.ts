import "server-only";

/**
 * POST /api/reports/v1/launch  (server-to-server, `x-partner-key`)
 *
 * The clinic system (here: the simulated TM3 sandbox's server action) asks for a launch URL for one
 * patient episode. Body LaunchRequest {connectorId, patientId, episodeId, clinician} →
 * LaunchResponse {launchUrl: <app origin>/reports/new?lt=<launch token>, expiresAt}.
 * The launch token is HMAC-SHA256 (MEDREPORT_LAUNCH_SECRET) and expires after 10 minutes.
 *
 * Wave 2 – whose launch it is comes from the partner key:
 * - the public demo's key (MEDREPORT_PARTNER_KEY, the sandbox's) → tenant "demo", while the public demo
 *   is on (CLINFORMS_PUBLIC_DEMO), with the demo-only connectors;
 * - a clinic's own key (Settings → API keys: partner_keys, stored as SHA-256, via
 *   MedreportDeps.verifyPartnerKey) → that clinic. The simulated TM3 sandbox is refused to a clinic
 *   (403 CONNECTOR_NOT_AVAILABLE); its launch link opens /app (the clinic's Studio), and redeeming it needs
 *   that clinic's signed-in member (POST /launch/verify).
 * launchUrl is built from the app's configured origin (config.server.ts appOrigin: APP_ORIGIN, else
 * BETTER_AUTH_URL, else this deployment), never from a client-supplied Host header.
 *
 * Errors: 401 PARTNER_KEY_INVALID (missing/wrong/revoked key, constant-time compare), 422 VALIDATION_FAILED,
 * 404 unknown connector, 503 CONNECTOR_NOT_CONFIGURED, 422 CONNECTOR_UNSUPPORTED (file-import),
 * 403 CONNECTOR_NOT_AVAILABLE.
 *
 * Owner: integration agent (wave 2: API slice).
 */
import { DEMO_TENANT_ID } from "../../config.public";
import { appOrigin, getSecret, publicDemoEnabled } from "../../config.server";
import { createLaunchToken } from "../../auth/launch-token";
import { requireConnector } from "../../connectors/handler-support";
import type { TenantId } from "../../core/types";
import { WORDING } from "../../core/wording";
import { HEADERS, LaunchRequestSchema, type LaunchResponse } from "../contract";
import type { MedreportDeps } from "../deps";
import { HttpError, json, logEvent, parseBody, timingSafeEqualString, type MedreportHandler } from "../http";

function partnerKeyRefused(): HttpError {
  return new HttpError(401, WORDING.server.access.partnerKeyTitle, {
    code: "PARTNER_KEY_INVALID",
    detail: `POST /launch is called server-to-server by the clinic system with a valid '${HEADERS.partnerKey}' header.`,
  });
}

/** The tenant a presented partner key launches for, or a 401. */
async function launchTenant(given: string | undefined, deps: MedreportDeps): Promise<{ tenantId: TenantId; keyId: string | null }> {
  if (!given) throw partnerKeyRefused();
  let demoKey: string | null = null;
  try {
    demoKey = getSecret("MEDREPORT_PARTNER_KEY");
  } catch {
    demoKey = null; // not configured (live mode): only clinic keys work
  }
  if (demoKey && timingSafeEqualString(given, demoKey)) {
    if (!publicDemoEnabled()) throw partnerKeyRefused();
    return { tenantId: DEMO_TENANT_ID, keyId: null };
  }
  const verified = deps.verifyPartnerKey ? await deps.verifyPartnerKey(given) : null;
  if (!verified || verified.tenantId === DEMO_TENANT_ID) throw partnerKeyRefused();
  return { tenantId: verified.tenantId, keyId: verified.id };
}

/** Where a clinic's launch link opens (the clinic's Studio, tenant shell). The public demo opens /reports/new. */
export const TENANT_LAUNCH_PATH = "/app/studio/new";

export const handleLaunch: MedreportHandler = async (req, _ctx, deps) => {
  const { tenantId, keyId } = await launchTenant(req.headers.get(HEADERS.partnerKey)?.trim(), deps);

  const parsed = await parseBody(req, LaunchRequestSchema, { maxBytes: 16_000 });
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  requireConnector(deps, body.connectorId, { capability: "patients", action: "launching from a clinic system", tenantId });

  const issued = createLaunchToken({
    tenantId,
    connectorId: body.connectorId,
    patientId: body.patientId,
    episodeId: body.episodeId,
    clinician: body.clinician,
  });
  // The public demo opens its own Studio; a clinic's launch opens the clinic's Studio (sign-in required).
  const studioPath = tenantId === DEMO_TENANT_ID ? "/reports/new" : TENANT_LAUNCH_PATH;
  const launchUrl = `${appOrigin(req)}${studioPath}?lt=${encodeURIComponent(issued.token)}`;
  logEvent("launch_issued", { connectorId: body.connectorId, patientId: body.patientId, episodeId: body.episodeId, tenant: tenantId === DEMO_TENANT_ID ? "demo" : "clinic" });
  if (keyId && deps.audit) {
    try {
      await deps.audit(tenantId, { action: "launch.issue", targetType: "partner_key", targetId: keyId, detail: { connectorId: body.connectorId } });
    } catch (err) {
      logEvent("audit_write_failed", { action: "launch.issue", error: err instanceof Error ? err.name : "error" });
    }
  }
  const res: LaunchResponse = { launchUrl, expiresAt: issued.expiresAt };
  return json(res, { status: 201 });
};
