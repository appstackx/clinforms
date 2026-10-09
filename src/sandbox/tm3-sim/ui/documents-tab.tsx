"use client";

/**
 * Documents tab: reports filed back to this simulated record by ClinForms. Read from
 * client-store.ts (localStorage index + IndexedDB bytes) – "stored in this browser – simulated record".
 * Refreshes on "tm3sim:documents-changed", cross-tab storage events and window focus.
 *
 * Owner: sandbox agent.
 */
import { useCallback, useEffect, useState } from "react";
import { Download, FileText, HardDrive, Loader2, ShieldCheck } from "lucide-react";
import { BROWSER_RECORD_LABEL } from "../config";
import {
  getSimulatedDocumentBlob,
  listSimulatedDocuments,
  subscribeDocuments,
  type SimStoredDocument,
} from "../client-store";
import { formatBytes, formatDateTime } from "./format";
import { EmptyState, Panel } from "./ui-bits";

const PDF_MIME = "application/pdf";

/** Shared hook: the patient's filed documents (null until read on the client). */
export function useFiledDocuments(patientId: string): SimStoredDocument[] | null {
  const [docs, setDocs] = useState<SimStoredDocument[] | null>(null);
  useEffect(() => {
    const refresh = () => setDocs(listSimulatedDocuments(patientId));
    refresh();
    return subscribeDocuments(refresh);
  }, [patientId]);
  return docs;
}

function DocumentRow({ doc }: { doc: SimStoredDocument }) {
  const [state, setState] = useState<"idle" | "loading" | "missing">("idle");
  const isPdf = doc.mimeType === PDF_MIME;

  const download = useCallback(async () => {
    setState("loading");
    const blob = await getSimulatedDocumentBlob(doc.externalDocumentId);
    if (!blob) {
      setState("missing");
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = doc.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setState("idle");
  }, [doc.externalDocumentId, doc.fileName]);

  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:px-5">
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
          isPdf ? "bg-rose-50 text-rose-700" : "bg-blue-50 text-blue-700"
        }`}
        aria-hidden
      >
        <FileText className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">{doc.title}</p>
        <p className="mt-0.5 break-all text-xs text-slate-600">
          {doc.fileName} · {isPdf ? "PDF" : "Word"} · {formatBytes(doc.sizeBytes)}
        </p>
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-slate-600 sm:grid-cols-2">
          <div>
            <dt className="inline text-slate-500">Filed: </dt>
            <dd className="inline text-slate-800">{formatDateTime(doc.receivedAt)}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">Signed by: </dt>
            <dd className="inline text-slate-800">
              {doc.signedBy} ({doc.signerHcpc}), {formatDateTime(doc.signedAt)}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="inline text-slate-500">File SHA-256: </dt>
            <dd className="inline break-all font-mono text-[11px] text-slate-700" title={doc.sha256}>
              {doc.sha256.slice(0, 16)}…
            </dd>
            <span className="text-slate-400"> · </span>
            <dt className="inline text-slate-500">Document ID: </dt>
            <dd className="inline font-mono text-[11px] text-slate-700">{doc.externalDocumentId}</dd>
          </div>
        </dl>
        {state === "missing" && (
          <p role="alert" className="mt-2 text-xs font-medium text-rose-700">
            The file is no longer stored in this browser (site data may have been cleared).
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={download}
        disabled={state === "loading"}
        aria-label={`Download ${doc.fileName}`}
        className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 self-start rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-60"
      >
        {state === "loading" ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Download className="h-4 w-4" aria-hidden />
        )}
        Download
      </button>
    </li>
  );
}

export function DocumentsTab({ docs, appName }: { docs: SimStoredDocument[] | null; appName: string }) {
  return (
    <Panel
      headingLevel={3}
      title="Documents"
      description="Reports filed back to this record by connected apps."
      actions={
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-500/20">
          <HardDrive className="h-3.5 w-3.5" aria-hidden />
          {BROWSER_RECORD_LABEL.charAt(0).toUpperCase() + BROWSER_RECORD_LABEL.slice(1)}
        </span>
      }
    >
      {docs === null ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading documents">
          {[0, 1].map((i) => (
            <div key={i} className="flex animate-pulse gap-3">
              <div className="h-10 w-10 rounded-lg bg-slate-100" />
              <div className="flex-1 space-y-2 py-1">
                <div className="h-3 w-1/2 rounded bg-slate-100" />
                <div className="h-3 w-1/3 rounded bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      ) : docs.length === 0 ? (
        <EmptyState icon={FileText} title="No reports filed yet">
          When a clinician signs a report in {appName} and chooses <strong>Save to clinic record</strong>, the
          signed Word or PDF file appears here.
        </EmptyState>
      ) : (
        <>
          <ul className="-mx-4 -my-4 divide-y divide-slate-100 sm:-mx-5">
            {docs.map((d) => (
              <DocumentRow key={d.externalDocumentId} doc={d} />
            ))}
          </ul>
          <p className="mt-6 flex items-start gap-1.5 border-t border-slate-100 pt-3 text-xs text-slate-500">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            The simulated clinic API checked each file&apos;s SHA-256 and sign-off receipt before accepting it. Files are
            kept only in this browser.
          </p>
        </>
      )}
    </Panel>
  );
}
