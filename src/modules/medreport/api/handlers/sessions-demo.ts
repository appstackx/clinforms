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
 * Wave 2: these sessions are the ONLY way to act as the public demo (auth/actor.ts); they act for the demo
 * tenant only, never for a clinic. 404 while the public demo is switched off (CLINFORMS_PUBLIC_DEMO=0).
 *
 * Owner: integration agent.
 */
import { DEMO_TENANT_ID } from "../../config.public";
import { publicDemoEnabled } from "../../config.server";
import { createSessionToken } from "../../auth/session-token";
import { requireConnector } from "../../connectors/handler-support";
import { DemoSessionRequestSchema, type DemoSessionResponse } from "../contract";
import { json, logEvent, parseBody, problem, type MedreportHandler } from "../http";

export const handleSessionsDemo: MedreportHandler = async (req, _ctx, deps) => {
  if (!publicDemoEnabled()) return problem(404, "Not found", { code: "NOT_FOUND", detail: "The public demo is not available on this site." });
  const parsed = await parseBody(req, DemoSessionRequestSchema, { maxBytes: 4_000 });
  if (!parsed.ok) return parsed.response;
  const { purpose, connectorId } = parsed.data;
  if (connectorId) requireConnector(deps, connectorId, { tenantId: DEMO_TENANT_ID });

  const session = createSessionToken({
    tenantId: DEMO_TENANT_ID,
    kind: "demo",
    ...(connectorId ? { connectorId } : {}),
  });
  logEvent("demo_session_issued", { purpose, connectorId: connectorId ?? null });
  const res: DemoSessionResponse = { session };
  return json(res, { status: 201 });
};
