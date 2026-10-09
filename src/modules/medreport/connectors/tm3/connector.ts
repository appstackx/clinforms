import "server-only";

/**
 * Placeholder for a REAL TM3 connector. Status "not_configured": every call throws
 * ConnectorError("NOT_CONFIGURED") and the handlers answer 503 CONNECTOR_NOT_CONFIGURED.
 *
 * Why it is not built: it needs TM3 partner access (credentials issued by the vendor) and written
 * confirmation that partners may read clinical notes and outcome measures, not just appointments.
 * Nothing in this product implies a partnership with TM3 or its vendor.
 *
 * How it would be built: implement the same ClinicSystemConnector interface as the simulated
 * connector (connectors/tm3-sim) – an authenticated, paged client that records a TraceEntry per call,
 * and a mapper from TM3's payloads to the EpisodeBundle contract (citable note IDs N-001… in
 * date/time order, appointments with status codes, outcome series linked to notes). The rest of the
 * product (facts, data checks, drafting, validators, sign-off, rendering, write-back) is unchanged.
 *
 * TM3_REQUIREMENTS (./requirements.ts, browser-safe) lists what TM3 must expose; the Studio shows it
 * on the connector tile.
 *
 * Owner: integration agent.
 */
import { ConnectorError, type ClinicSystemConnector } from "../types";

export { TM3_REQUIREMENTS, type ConnectorRequirement } from "./requirements";

export const TM3_CONNECTOR_NOTE = "Not configured – needs TM3 partner access & confirmed notes access";

export function createTm3Connector(): ClinicSystemConnector {
  const notConfigured = (): never => {
    throw new ConnectorError(
      "NOT_CONFIGURED",
      "The TM3 live connector is not configured. It needs TM3 partner access and confirmed read access to clinical notes. Use the simulated TM3 sandbox or upload a TM3 export instead.",
    );
  };
  return {
    id: "tm3",
    label: "TM3 (live)",
    simulated: false,
    status: "not_configured",
    capabilities: {
      patients: false,
      clinicalNotes: false,
      appointments: false,
      outcomeMeasures: false,
      writeBackDocuments: false,
    },
    note: TM3_CONNECTOR_NOTE,
    async searchPatients() {
      return notConfigured();
    },
    async listEpisodes() {
      return notConfigured();
    },
    async getEpisodeBundle() {
      return notConfigured();
    },
    async attachDocument() {
      return notConfigured();
    },
  };
}
