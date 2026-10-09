import "server-only";

/**
 * GET /api/reports/v1/connectors → ConnectorsResponse {connectors: ConnectorInfo[]} for the Studio
 * tiles, in registry order: tm3-sim (connected, simulated), file-import ("TM3 export upload –
 * available now"), tm3 (not configured). No auth: tiles carry no patient data.
 *
 * Owner: integration agent.
 */
import { toConnectorInfo } from "../../connectors/registry";
import type { ConnectorsResponse } from "../contract";
import { json, type MedreportHandler } from "../http";

export const handleConnectorsList: MedreportHandler = async (_req, _ctx, deps) => {
  const body: ConnectorsResponse = { connectors: deps.connectors.list().map(toConnectorInfo) };
  return json(body);
};
