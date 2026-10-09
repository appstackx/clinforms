"use client";

/**
 * Client-side host glue for /reports: provides the module's HostHooks. The module never imports the
 * sandbox; this file (in src/app) is allowed to touch both.
 *
 * - onDocumentFiled: keeps the signed file in the simulated TM3 record held in this browser.
 * - onResetDemo: also clears the sandbox's filed documents.
 * - clinicRecordUrl: links back to the simulated TM3 record.
 *
 * Owner: integration agent. (Baseline implementation by the foundation.)
 */
import type { ReactNode } from "react";
import { HostHooksProvider, type HostHooks } from "@/modules/medreport/ui/host-hooks";
import { clearSimulatedDocuments, saveSimulatedDocument } from "@/sandbox/tm3-sim/client-store";

const hooks: HostHooks = {
  async onDocumentFiled(doc) {
    if (doc.connectorId !== "tm3-sim") return;
    await saveSimulatedDocument(
      {
        externalDocumentId: doc.attachReceipt.externalDocumentId,
        patientId: doc.patientId,
        episodeId: doc.episodeId,
        title: doc.title,
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        sizeBytes: doc.bytes.size,
        sha256: doc.attachReceipt.sha256,
        receivedAt: doc.attachReceipt.receivedAt,
        reportId: doc.reportId,
        signedBy: doc.signReceipt.signer.name,
        signerHcpc: doc.signReceipt.signer.hcpc,
        signedAt: doc.signReceipt.signedAt,
        contentSha256: doc.signReceipt.contentSha256,
      },
      doc.bytes,
    );
  },
  async onResetDemo() {
    await clearSimulatedDocuments();
  },
  clinicRecordUrl({ connectorId, patientId }) {
    return connectorId === "tm3-sim" ? `/pms-sandbox/patients/${encodeURIComponent(patientId)}` : null;
  },
};

export function MedreportHost({ children }: { children: ReactNode }) {
  return <HostHooksProvider hooks={hooks}>{children}</HostHooksProvider>;
}
