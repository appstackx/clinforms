/**
 * Browser-side record of documents filed to the simulated TM3 record: metadata in localStorage
 * ("tm3sim.documents") and file bytes in IndexedDB ("tm3sim"/"documents"). Labelled
 * "stored in this browser – simulated record". Every storage access is wrapped in try/catch, and
 * every change dispatches the window event "tm3sim:documents-changed" (other tabs see the localStorage
 * "storage" event; `subscribeDocuments` listens to both).
 *
 * Used by the sandbox Documents tab and by the host write-back hook (src/app/reports/medreport-host.tsx).
 *
 * API:
 *   fileDocument({patientId, fileName, mimeType, blob, sha256, receipt, externalDocumentId, …})
 *   listDocuments(patientId)                       – newest first
 *   saveSimulatedDocument(meta, bytes)             – lower-level form used by the host hook
 *   getSimulatedDocumentBlob(externalDocumentId)   – null when the bytes are no longer in this browser
 *   clearSimulatedDocuments()                      – "Reset demo"
 *   subscribeDocuments(callback)                   – returns an unsubscribe function
 *
 * Owner: sandbox agent.
 */
import { SANDBOX_STORAGE } from "./config";

export interface SimStoredDocument {
  externalDocumentId: string;
  patientId: string;
  episodeId: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  /** ISO date-time */
  receivedAt: string;
  reportId: string;
  signedBy: string;
  signerHcpc: string;
  /** ISO date-time */
  signedAt: string;
  contentSha256: string;
}

/** Window event fired after any change to the filed documents. `detail.patientId` is null on clear. */
export const DOCUMENTS_CHANGED_EVENT = "tm3sim:documents-changed" as const;
export type DocumentsChangedDetail = { patientId: string | null };

/** Sign-off receipt as the Studio holds it (structurally compatible with the module's SignReceipt). */
export interface FileDocumentReceipt {
  reportId: string;
  contentSha256: string;
  signer: { name: string; hcpc: string; role?: string };
  signedAt: string;
}

export interface FileDocumentInput {
  patientId: string;
  fileName: string;
  mimeType: string;
  blob: Blob;
  /** SHA-256 (hex) of the file bytes, as returned by the simulated API. */
  sha256: string;
  receipt: FileDocumentReceipt;
  /** ID returned by POST /patients/{id}/documents. */
  externalDocumentId: string;
  /** Optional extras; sensible defaults are used when omitted. */
  episodeId?: string;
  title?: string;
  receivedAt?: string;
}

/* ------------------------------------------------------------------------------------------------
 * localStorage index
 * ----------------------------------------------------------------------------------------------*/

const isBrowser = () => typeof window !== "undefined";

function isStoredDocument(value: unknown): value is SimStoredDocument {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.externalDocumentId === "string" &&
    typeof v.patientId === "string" &&
    typeof v.fileName === "string" &&
    typeof v.mimeType === "string" &&
    typeof v.receivedAt === "string"
  );
}

function readIndex(): SimStoredDocument[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(SANDBOX_STORAGE.documentsKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isStoredDocument) : [];
  } catch {
    return [];
  }
}

function writeIndex(docs: SimStoredDocument[]): boolean {
  if (!isBrowser()) return false;
  try {
    window.localStorage.setItem(SANDBOX_STORAGE.documentsKey, JSON.stringify(docs));
    return true;
  } catch {
    return false;
  }
}

function notify(patientId: string | null): void {
  if (!isBrowser()) return;
  try {
    window.dispatchEvent(
      new CustomEvent<DocumentsChangedDetail>(DOCUMENTS_CHANGED_EVENT, { detail: { patientId } }),
    );
  } catch {
    // CustomEvent unsupported – the Documents tab also refreshes on focus.
  }
}

/* ------------------------------------------------------------------------------------------------
 * IndexedDB blobs
 * ----------------------------------------------------------------------------------------------*/

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (!isBrowser() || !window.indexedDB) return resolve(null);
      const req = window.indexedDB.open(SANDBOX_STORAGE.idbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SANDBOX_STORAGE.idbStore)) db.createObjectStore(SANDBOX_STORAGE.idbStore);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise<T | null>((resolve) => {
    try {
      const tx = db.transaction(SANDBOX_STORAGE.idbStore, mode);
      const req = run(tx.objectStore(SANDBOX_STORAGE.idbStore));
      let result: T | null = null;
      req.onsuccess = () => {
        result = req.result;
      };
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onerror = () => {
        db.close();
        resolve(null);
      };
      tx.onabort = () => {
        db.close();
        resolve(null);
      };
    } catch {
      try {
        db.close();
      } catch {
        // ignore
      }
      resolve(null);
    }
  });
}

/* ------------------------------------------------------------------------------------------------
 * Public API
 * ----------------------------------------------------------------------------------------------*/

/**
 * Keep a filed document in this browser: bytes in IndexedDB, metadata in localStorage (upsert by
 * externalDocumentId). Metadata is kept even if IndexedDB is unavailable (download then shows as
 * unavailable). Throws only when nothing at all could be stored.
 */
export async function saveSimulatedDocument(meta: SimStoredDocument, bytes: Blob): Promise<void> {
  if (!isBrowser()) return;
  await withStore("readwrite", (store) => store.put(bytes, meta.externalDocumentId));
  const docs = readIndex().filter((d) => d.externalDocumentId !== meta.externalDocumentId);
  docs.push({ ...meta, sizeBytes: meta.sizeBytes || bytes.size });
  if (!writeIndex(docs)) {
    throw new Error("This browser blocked storage, so the filed copy could not be kept.");
  }
  notify(meta.patientId);
}

/** Convenience form of saveSimulatedDocument for callers holding a sign-off receipt. */
export async function fileDocument(input: FileDocumentInput): Promise<SimStoredDocument> {
  const meta: SimStoredDocument = {
    externalDocumentId: input.externalDocumentId,
    patientId: input.patientId,
    episodeId: input.episodeId ?? "",
    title: input.title ?? input.fileName,
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.blob.size,
    sha256: input.sha256,
    receivedAt: input.receivedAt ?? new Date().toISOString(),
    reportId: input.receipt.reportId,
    signedBy: input.receipt.signer.name,
    signerHcpc: input.receipt.signer.hcpc,
    signedAt: input.receipt.signedAt,
    contentSha256: input.receipt.contentSha256,
  };
  await saveSimulatedDocument(meta, input.blob);
  return meta;
}

/** Documents filed to one patient's simulated record in this browser, newest first. */
export function listSimulatedDocuments(patientId: string): SimStoredDocument[] {
  return readIndex()
    .filter((d) => d.patientId === patientId)
    .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0));
}

/** Alias of listSimulatedDocuments. */
export const listDocuments = listSimulatedDocuments;

/** Number of filed documents per patient ID (for the patient list). */
export function countDocumentsByPatient(): Record<string, number> {
  const counts: Record<string, number> = {};
  readIndex().forEach((d) => {
    counts[d.patientId] = (counts[d.patientId] ?? 0) + 1;
  });
  return counts;
}

export async function getSimulatedDocumentBlob(externalDocumentId: string): Promise<Blob | null> {
  const result = await withStore<unknown>("readonly", (store) => store.get(externalDocumentId));
  return result instanceof Blob ? result : null;
}

/** Remove every filed document (metadata and bytes) from this browser. */
export async function clearSimulatedDocuments(): Promise<void> {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(SANDBOX_STORAGE.documentsKey);
  } catch {
    // ignore
  }
  await withStore("readwrite", (store) => store.clear());
  notify(null);
}

/** Call `callback` whenever filed documents change in this tab or another tab. Returns unsubscribe. */
export function subscribeDocuments(callback: () => void): () => void {
  if (!isBrowser()) return () => undefined;
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === SANDBOX_STORAGE.documentsKey) callback();
  };
  const onFocus = () => callback();
  window.addEventListener(DOCUMENTS_CHANGED_EVENT, callback);
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", onFocus);
  return () => {
    window.removeEventListener(DOCUMENTS_CHANGED_EVENT, callback);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", onFocus);
  };
}
