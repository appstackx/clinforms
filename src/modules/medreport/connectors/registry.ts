import "server-only";

/**
 * Connector registry. The app glue (src/app/api/_medreport-glue.ts) creates it with the concrete
 * connectors so the module never imports the sandbox. `createDefaultConnectors()` returns the standard
 * set in tile order: tm3-sim (connected, simulated), file-import (available now), tm3 (not configured).
 *
 * Owner: integration agent.
 */
import type { ConnectorInfo } from "../core/types";
import { createFileImportConnector } from "./file-import/connector";
import { createTm3SimConnector } from "./tm3-sim/connector";
import { createTm3Connector } from "./tm3/connector";
import type { ClinicSystemConnector, ConnectorRegistry } from "./types";

export function createConnectorRegistry(connectors: ClinicSystemConnector[]): ConnectorRegistry {
  const list = connectors.slice();
  const byId = new Map(list.map((c) => [c.id as string, c]));
  return {
    list: () => list.slice(),
    get: (id) => byId.get(id),
  };
}

/** The standard connectors, in tile order. */
export function createDefaultConnectors(): ClinicSystemConnector[] {
  return [createTm3SimConnector(), createFileImportConnector(), createTm3Connector()];
}

/** Tile data for GET /connectors (no functions, safe to serialise). */
export function toConnectorInfo(c: ClinicSystemConnector): ConnectorInfo {
  return {
    id: c.id,
    label: c.label,
    simulated: c.simulated,
    status: c.status,
    capabilities: { ...c.capabilities },
    note: c.note,
  };
}
