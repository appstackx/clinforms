import "server-only";

/**
 * TenantStore – the storage the host gives the tenant-storage handlers (api/handlers/store-*.ts) through
 * MedreportDeps.tenantStore. The host builds it from its database repositories (src/server/store/tenant-store.ts:
 * Kysely on D1 / Postgres / SQLite, patient payloads AES-GCM encrypted per tenant); tests use
 * api/store-memory.ts.
 *
 * Every method takes the tenant explicitly and must never read or write another tenant's rows. The handlers
 * own every rule (who may write, schemas, revisions, receipts, attestations, audit); the store only stores.
 * Payloads are opaque JSON values here: the handlers validate them before writing and after reading.
 */

/** Result of a create / update on a revisioned record. */
export type StoreSaveResult =
  | { ok: true; rev: number; updatedAt: string }
  | { ok: false; reason: "conflict" | "exists"; currentRev: number }
  | { ok: false; reason: "not_found" }
  /** The store refused the input (an id, size or text limit). */
  | { ok: false; reason: "invalid"; message: string };

export interface StoredReportMeta {
  id: string;
  rev: number;
  status: string;
  templateId: string;
  formId: string | null;
  createdAt: string;
  /** When the server last stored it. */
  updatedAt: string;
  /**
   * getReportMeta (fix wave 3): the stored report's size as JSON in bytes (may be estimated from its encrypted form) –
   * an update that makes a report larger counts the growth against the clinic's daily new-data allowance.
   */
  storedBytes?: number;
}

export interface StoredFormMeta {
  id: string;
  rev: number;
  status: string;
  title: string;
  referrer: string | null;
  kind: string;
  fileSha256: string;
  sampleId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredFileMeta {
  sha256: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  chunkCount: number;
}

export interface StoreReportRow {
  id: string;
  status: string;
  templateId: string;
  formId: string | null;
  /** The Report (JSON-serialisable); encrypted at rest by the host. */
  payload: unknown;
}

export interface StoreFormRow {
  id: string;
  status: string;
  title: string;
  referrer: string | null;
  kind: string;
  fileSha256: string;
  sampleId: string | null;
  /** The FormDefinition (JSON-serialisable); encrypted at rest by the host. */
  payload: unknown;
}

/** One audit row. Ids, actions and counts only – never patient data. */
export interface StoreAuditEntry {
  userId: string;
  sessionId: string;
  /** e.g. "report.save" – [a-z0-9_.:-], ≤ 64. */
  action: string;
  targetType: string;
  targetId: string;
  detail?: Record<string, string | number | boolean | null>;
}

export interface TenantStore {
  /* Reports ------------------------------------------------------------------------------------- */
  /** The tenant's reports (metadata only), most recently stored first. */
  listReports(tenantId: string): Promise<StoredReportMeta[]>;
  getReportMeta(tenantId: string, id: string): Promise<StoredReportMeta | null>;
  getReport(tenantId: string, id: string): Promise<(StoredReportMeta & { payload: unknown }) | null>;
  createReport(tenantId: string, row: StoreReportRow): Promise<StoreSaveResult>;
  updateReport(tenantId: string, row: StoreReportRow, expectedRev: number): Promise<StoreSaveResult>;
  deleteReport(tenantId: string, id: string): Promise<boolean>;

  /* Form maps ----------------------------------------------------------------------------------- */
  listForms(tenantId: string): Promise<StoredFormMeta[]>;
  getForm(tenantId: string, id: string): Promise<(StoredFormMeta & { payload: unknown }) | null>;
  createForm(tenantId: string, row: StoreFormRow): Promise<StoreSaveResult>;
  updateForm(tenantId: string, row: StoreFormRow, expectedRev: number): Promise<StoreSaveResult>;
  deleteForm(tenantId: string, id: string): Promise<boolean>;

  /* Form files (content-addressed, chunked) ------------------------------------------------------ */
  /** The file's record – a complete file or an upload in progress – or null. */
  getFileMeta(tenantId: string, sha256: string): Promise<StoredFileMeta | null>;
  /**
   * The verified bytes (size and SHA-256 checked) of a file whose chunks are all held; null when it is missing or
   * still incomplete. THROWS when the held bytes are damaged (they do not decrypt or do not hash to sha256).
   */
  getFile(tenantId: string, sha256: string): Promise<(StoredFileMeta & { bytes: Uint8Array }) | null>;
  /** Deletes the file (or upload in progress) and its chunks. */
  deleteFile(tenantId: string, sha256: string): Promise<boolean>;
  /**
   * Start or resume an upload: records the file (chunk count from the size) unless it is recorded already, and
   * says which chunks are held. A partial upload recorded with a different size is started afresh.
   */
  beginUpload(
    tenantId: string,
    input: { sha256: string; fileName: string; mimeType: string; sizeBytes: number },
  ): Promise<{ held: "none" | "partial" | "all"; present: number[]; meta: StoredFileMeta }>;
  /** Indexes of the chunks held for the file. */
  chunkIndexes(tenantId: string, sha256: string): Promise<number[]>;
  /**
   * Store chunk `idx` (checked against the recorded size: index range and exact length → "invalid").
   * "not_started" without a record; "complete" (nothing written) when every chunk is already held.
   */
  putChunk(tenantId: string, sha256: string, idx: number, bytes: Uint8Array): Promise<"written" | "complete" | "not_started" | "invalid">;

  /* Settings and audit --------------------------------------------------------------------------- */
  getSettings(tenantId: string): Promise<{ referrerLinks: unknown; updatedAt: string } | null>;
  putSettings(tenantId: string, referrerLinks: Record<string, string>): Promise<{ updatedAt: string }>;
  audit(tenantId: string, entry: StoreAuditEntry): Promise<void>;
}
