import "server-only";

/**
 * Shared plumbing for the Report API handlers that talk to connectors (patients, bundle, file-import
 * bundle, documents): look up a connector, and turn ConnectorError into problem+json.
 *
 *   NOT_FOUND → 404 NOT_FOUND                 NOT_CONFIGURED → 503 CONNECTOR_NOT_CONFIGURED
 *   UNSUPPORTED → 422 CONNECTOR_UNSUPPORTED   ImportError → 422 IMPORT_INVALID (+ issues)
 *   UNAUTHORIZED / UPSTREAM_ERROR / INVALID_DATA (from the clinic system) → 502 CONNECTOR_ERROR
 *
 * Owner: integration agent.
 */
import type { MedreportDeps } from "../api/deps";
import { HttpError, logEvent } from "../api/http";
import { DEMO_TENANT_ID } from "../config.public";
import type { ConnectorCapabilities, ConnectorId } from "../core/types";
import { WORDING } from "../core/wording";
import { ImportError } from "./file-import/parser";
import { ConnectorError, type ClinicSystemConnector } from "./types";

/**
 * The registered connector, or 404. Optionally 503 when not configured / 422 when it lacks a capability.
 * With `tenantId` (wave 2: the caller's clinic), a demo-only connector (the simulated TM3 sandbox) is
 * 403 CONNECTOR_NOT_AVAILABLE to anyone but the public demo.
 */
export function requireConnector(
  deps: MedreportDeps,
  id: string | undefined,
  opts: { capability?: keyof ConnectorCapabilities; action?: string; tenantId?: string } = {},
): ClinicSystemConnector & { id: ConnectorId } {
  const connector = id ? deps.connectors.get(id) : undefined;
  if (!connector) {
    throw new HttpError(404, "Unknown connector", {
      code: "NOT_FOUND",
      detail: `There is no connector "${id ?? ""}". Known connectors: ${deps.connectors.list().map((c) => c.id).join(", ")}.`,
    });
  }
  if (connector.demoOnly && opts.tenantId !== undefined && opts.tenantId !== DEMO_TENANT_ID) {
    throw new HttpError(403, WORDING.server.access.demoConnectorTitle, {
      code: "CONNECTOR_NOT_AVAILABLE",
      detail: WORDING.server.access.demoConnectorDetail(connector.label),
    });
  }
  if (connector.status === "not_configured") {
    throw new HttpError(503, "Connector not configured", {
      code: "CONNECTOR_NOT_CONFIGURED",
      detail: `${connector.label} is not configured: ${connector.note}.`,
    });
  }
  if (opts.capability && !connector.capabilities[opts.capability]) {
    throw new HttpError(422, "Not supported by this connector", {
      code: "CONNECTOR_UNSUPPORTED",
      detail: `${connector.label} does not support ${opts.action ?? opts.capability}.`,
    });
  }
  return connector;
}

/** Map anything a connector throws to an HttpError (other errors are rethrown → 500). */
export function toConnectorHttpError(err: unknown, connectorId: string): unknown {
  if (err instanceof HttpError) return err;
  if (err instanceof ImportError) {
    return new HttpError(422, "The import could not be read", {
      code: "IMPORT_INVALID",
      detail: err.issues.length === 1 ? err.issues[0].message : `${err.issues.length} problems were found. Fix them and try again.`,
      issues: err.issues.map((i) => ({ path: i.where, message: i.message })),
    });
  }
  if (!(err instanceof ConnectorError)) return err;
  logEvent("connector_error", { connectorId, code: err.code, upstreamStatus: err.upstreamStatus });
  switch (err.code) {
    case "NOT_FOUND":
      return new HttpError(404, "Not found in the clinic system", { code: "NOT_FOUND", detail: err.message });
    case "NOT_CONFIGURED":
      return new HttpError(503, "Connector not configured", { code: "CONNECTOR_NOT_CONFIGURED", detail: err.message });
    case "UNSUPPORTED":
      return new HttpError(422, "Not supported", { code: "CONNECTOR_UNSUPPORTED", detail: err.message });
    case "UNAUTHORIZED":
      return new HttpError(502, "The clinic system rejected our credentials", { code: "CONNECTOR_ERROR", detail: err.message });
    case "UPSTREAM_ERROR":
      return new HttpError(502, "The clinic system did not respond", { code: "CONNECTOR_ERROR", detail: err.message, retryable: true });
    case "INVALID_DATA":
    default:
      return new HttpError(502, "The clinic system returned unexpected data", { code: "CONNECTOR_ERROR", detail: err.message });
  }
}

/** Run a connector call, converting its errors to problem responses. */
export async function callConnector<T>(connectorId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toConnectorHttpError(err, connectorId);
  }
}
