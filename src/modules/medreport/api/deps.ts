import "server-only";

/**
 * Dependencies the Report API handlers receive from the host app. The module never imports the
 * sandbox or the app; `src/app/api/_medreport-glue.ts` builds these (connector registry with the
 * tm3-sim connector, in-process transport, credentials) and binds them to each route.
 *
 * Shared contract (orchestrator-owned): additive optional members only.
 */
import type { ConnectorContext, ConnectorRegistry } from "../connectors/types";
import type { ConnectorId, TenantId } from "../core/types";

export interface MedreportDeps {
  connectors: ConnectorRegistry;
  /**
   * Build the per-request connector context: credentials (e.g. Bearer TM3_SIM_TOKEN for tm3-sim),
   * base URL (TM3_SIM_BASE_URL or the request origin), transport (HTTP with in-process fallback) and an
   * empty trace array the handler returns to the client.
   */
  createConnectorContext(req: Request, connectorId: ConnectorId, tenantId: TenantId): ConnectorContext;
}
