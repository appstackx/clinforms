import "server-only";

/**
 * POST /api/reports/v1/sessions/demo
 *
 * Body DemoSessionRequest {purpose: picker | upload | batch, connectorId?} → DemoSessionResponse
 * {session}: a 1-hour session (kind "demo") for the demo tenant, not bound to a patient. Used by the
 * manual patient picker, uploads and batch. Available for the demo tenant whatever the AI mode, so it
 * keeps working during a live-AI demo. Patient data in this build is fictional.
 *
 * When `connectorId` is given the session is limited to that connector (it must be usable: 404
 * unknown, 503 not configured).
 *
 * Owner: integration agent.
 */
import { DEMO_TENANT_ID } from "../../config.public";
import { createSessionToken } from "../../auth/session-token";
import { requireConnector } from "../../connectors/handler-support";
import { DemoSessionRequestSchema, type DemoSessionResponse } from "../contract";
import { json, logEvent, parseBody, type MedreportHandler } from "../http";

export const handleSessionsDemo: MedreportHandler = async (req, _ctx, deps) => {
  const parsed = await parseBody(req, DemoSessionRequestSchema, { maxBytes: 4_000 });
  if (!parsed.ok) return parsed.response;
  const { purpose, connectorId } = parsed.data;
  if (connectorId) requireConnector(deps, connectorId);

  const session = createSessionToken({
    tenantId: DEMO_TENANT_ID,
    kind: "demo",
    ...(connectorId ? { connectorId } : {}),
  });
  logEvent("demo_session_issued", { purpose, connectorId: connectorId ?? null });
  const res: DemoSessionResponse = { session };
  return json(res, { status: 201 });
};
