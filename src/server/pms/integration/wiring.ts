/**
 * The other modules' adapters for the integration module's ports (./ports.ts). THE ONE PLACE they are connected:
 * when the clinic-system modules are put together, each line below gets its module's adapter, e.g.
 *
 *   import { recordsIntegrationPort } from "../records/integration-port";
 *   records: recordsIntegrationPort,
 *
 * Nothing else in the integration module changes. Until then a port is null (see ports.ts for what that means).
 * Tests swap the ports with setIntegrationPortsForTests().
 */
import "server-only";
import { diaryAdapter, recordsAdapter } from "./adapters";
import type { IntegrationPorts } from "./ports";

const WIRED: IntegrationPorts = {
  records: recordsAdapter,
  diary: diaryAdapter,
  // Invoices: not wired – opening balances are entered in Billing (an invoices file can be checked, not run).
  billing: null,
};

let override: IntegrationPorts | null = null;

export function integrationPorts(): IntegrationPorts {
  return override ?? WIRED;
}

/** TESTS ONLY: use these ports until reset (null). */
export function setIntegrationPortsForTests(
  ports: IntegrationPorts | null,
): void {
  override = ports;
}
