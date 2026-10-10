import "server-only";

/**
 * Connector contract: what any clinic-system connector (simulated TM3, file import, a future real TM3)
 * implements. Shared contract (orchestrator-owned): additive optional members only.
 *
 * Import with `import type` from anywhere outside connectors/ – this file is server-only.
 */
import type {
  AttachReceipt,
  ConnectorCapabilities,
  ConnectorId,
  ConnectorStatus,
  EpisodeBundle,
  EpisodeSummary,
  ImportPayload,
  PatientSummary,
  SignReceipt,
  TenantId,
  TraceEntry,
} from "../core/types";

export type { TraceEntry } from "../core/types";

/** Response header the in-process transport sets so the trace can record transport "in-process". */
export const TRANSPORT_HEADER = "x-medreport-transport" as const;

export type ConnectorCredentials = { kind: "bearer"; token: string } | { kind: "none" };

/** fetch-compatible transport. The glue supplies real HTTP with an in-process fallback. */
export type ConnectorFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Per-request context, built by MedreportDeps.createConnectorContext(). */
export interface ConnectorContext {
  tenantId: TenantId;
  credentials: ConnectorCredentials;
  /** Origin of the clinic-system API, e.g. "https://reports.example.com" (no trailing slash). */
  baseUrl: string;
  fetch: ConnectorFetch;
  /** Append one entry per upstream call (method, URL path, status, ms, transport). Never note text. */
  trace: TraceEntry[];
}

/** External IDs of an episode in the clinic system. */
export interface ConnectorEpisodeRef {
  patientId: string;
  episodeId: string;
}

export interface AttachDocumentInput {
  patientId: string;
  episodeId: string;
  title: string;
  fileName: string;
  mimeType: string;
  contentBase64: string;
  /** SHA-256 hex of the decoded bytes. */
  sha256: string;
  receipt: SignReceipt;
}

export interface ClinicSystemConnector {
  id: ConnectorId;
  label: string;
  simulated: boolean;
  status: ConnectorStatus;
  capabilities: ConnectorCapabilities;
  /** Tile note, e.g. "TM3 export upload – available now". */
  note: string;
  /**
   * Wave 2: only the public demo (tenant "demo") may use this connector – the simulated TM3 sandbox holds
   * fictional patients and is never a clinic's record system. Handlers refuse it to a clinic's member
   * (403 CONNECTOR_NOT_AVAILABLE, connectors/handler-support.ts requireConnector).
   */
  demoOnly?: boolean;
  searchPatients?(ctx: ConnectorContext, q: { search?: string }): Promise<PatientSummary[]>;
  listEpisodes?(ctx: ConnectorContext, patientId: string): Promise<EpisodeSummary[]>;
  getEpisodeBundle(ctx: ConnectorContext, ref: ConnectorEpisodeRef | { upload: ImportPayload }): Promise<EpisodeBundle>;
  attachDocument?(ctx: ConnectorContext, input: AttachDocumentInput): Promise<AttachReceipt>;
}

export interface ConnectorRegistry {
  /** All connectors in tile order: tm3-sim, file-import, tm3. */
  list(): ClinicSystemConnector[];
  get(id: string): ClinicSystemConnector | undefined;
}

export type ConnectorErrorCode =
  | "NOT_CONFIGURED"
  | "UNSUPPORTED"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "UPSTREAM_ERROR"
  | "INVALID_DATA";

/** Thrown by connectors; handlers map it to problem+json (NOT_FOUND→404, NOT_CONFIGURED→503, …). */
export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;
  readonly upstreamStatus?: number;

  constructor(code: ConnectorErrorCode, message: string, upstreamStatus?: number) {
    super(message);
    this.name = "ConnectorError";
    this.code = code;
    this.upstreamStatus = upstreamStatus;
  }
}
