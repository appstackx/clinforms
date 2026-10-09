"use client";

/**
 * Host integration points. The module never imports the host app or the sandbox; instead the host
 * (src/app/reports/medreport-host.tsx) provides these callbacks through <HostHooksProvider>.
 *
 * Example: after a successful POST /connectors/{id}/documents, the review screen calls
 * `onDocumentFiled` so the host can keep the signed file in the simulated TM3 record held in this
 * browser ("stored in this browser – simulated record").
 *
 * Shared contract (orchestrator-owned): additive optional hooks only.
 */
import { createContext, useContext, type ReactNode } from "react";
import type { AttachReceipt, ConnectorId, SignReceipt } from "../core/types";

export interface FiledDocument {
  connectorId: ConnectorId;
  /** External IDs in the clinic system. */
  patientId: string;
  episodeId: string;
  reportId: string;
  title: string;
  fileName: string;
  mimeType: string;
  bytes: Blob;
  /** Receipt from the clinic system (externalDocumentId, receivedAt, sha256). */
  attachReceipt: AttachReceipt;
  signReceipt: SignReceipt;
}

export interface HostHooks {
  /** A signed document was written back; keep a browser copy for the (simulated) clinic record. */
  onDocumentFiled?(doc: FiledDocument): Promise<void> | void;
  /** "Reset demo" was pressed; clear any host-side demo state too. */
  onResetDemo?(): Promise<void> | void;
  /** URL of the clinic-system record to link back to, if the host knows one. */
  clinicRecordUrl?(ref: { connectorId: ConnectorId; patientId: string }): string | null;
}

const HostHooksContext = createContext<HostHooks>({});

export function HostHooksProvider({ hooks, children }: { hooks: HostHooks; children: ReactNode }) {
  return <HostHooksContext.Provider value={hooks}>{children}</HostHooksContext.Provider>;
}

export function useHostHooks(): HostHooks {
  return useContext(HostHooksContext);
}
