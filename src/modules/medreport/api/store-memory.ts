import "server-only";

/**
 * An in-memory TenantStore – TESTS ONLY (the store handler and Studio store tests). Same rules as the host's
 * database store (src/server/store/tenant-store.ts): every row keyed by tenant, revisions start at 1 and an
 * update must name the current one, a file is served only when every chunk is held and the bytes verify, a
 * chunk is never written into a file that has all its chunks, the audit log is append-only. Payloads are deep-copied in and out (JSON), like a database.
 */
import { createHash } from "node:crypto";
import type {
  StoreAuditEntry,
  StoreFormRow,
  StoreReportRow,
  StoreSaveResult,
  StoredFileMeta,
  StoredFormMeta,
  StoredReportMeta,
  TenantStore,
} from "./store-port";

interface Row<M> {
  meta: M;
  payload: string;
}

export interface MemoryTenantStore extends TenantStore {
  /** Every audit row, oldest first (tests). */
  readonly auditLog: Array<StoreAuditEntry & { tenantId: string }>;
  /** Raw chunk bytes of (tenant, sha256) – tests that damage an upload. */
  chunks(tenantId: string, sha256: string): Map<number, Uint8Array>;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
/** = src/server/repos/form-files.ts FILE_CHUNK_BYTES (and STORE_FILE_CHUNK_BYTES). */
const CHUNK_BYTES = 512 * 1024;

export function createMemoryTenantStore(opts: { now?: () => Date } = {}): MemoryTenantStore {
  const now = () => (opts.now ? opts.now() : new Date()).toISOString();
  const reports = new Map<string, Row<StoredReportMeta>>();
  const forms = new Map<string, Row<StoredFormMeta>>();
  const files = new Map<string, StoredFileMeta>();
  const chunkSets = new Map<string, Map<number, Uint8Array>>();
  const settings = new Map<string, { referrerLinks: string; updatedAt: string }>();
  const auditLog: Array<StoreAuditEntry & { tenantId: string }> = [];
  const k = (tenantId: string, id: string) => `${tenantId}\u0000${id}`;
  const copy = (payload: unknown) => JSON.parse(JSON.stringify(payload)) as unknown;
  const chunksOf = (tenantId: string, sha256: string) => {
    let set = chunkSets.get(k(tenantId, sha256));
    if (!set) {
      set = new Map();
      chunkSets.set(k(tenantId, sha256), set);
    }
    return set;
  };
  const invalidId = (id: string): StoreSaveResult | null => (ID.test(id) ? null : { ok: false, reason: "invalid", message: "The id is not valid." });

  return {
    auditLog,
    chunks: chunksOf,

    async listReports(tenantId) {
      return Array.from(reports.entries())
        .filter(([key]) => key.startsWith(`${tenantId}\u0000`))
        .map(([, row]) => ({ ...row.meta }))
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    },
    async getReportMeta(tenantId, id) {
      const row = reports.get(k(tenantId, id));
      return row ? { ...row.meta } : null;
    },
    async getReport(tenantId, id) {
      const row = reports.get(k(tenantId, id));
      return row ? { ...row.meta, payload: JSON.parse(row.payload) as unknown } : null;
    },
    async createReport(tenantId, row: StoreReportRow) {
      const bad = invalidId(row.id);
      if (bad) return bad;
      const existing = reports.get(k(tenantId, row.id));
      if (existing) return { ok: false, reason: "exists", currentRev: existing.meta.rev };
      const at = now();
      reports.set(k(tenantId, row.id), {
        meta: { id: row.id, rev: 1, status: row.status, templateId: row.templateId, formId: row.formId, createdAt: at, updatedAt: at },
        payload: JSON.stringify(copy(row.payload)),
      });
      return { ok: true, rev: 1, updatedAt: at };
    },
    async updateReport(tenantId, row, expectedRev) {
      const existing = reports.get(k(tenantId, row.id));
      if (!existing) return { ok: false, reason: "not_found" };
      if (existing.meta.rev !== expectedRev) return { ok: false, reason: "conflict", currentRev: existing.meta.rev };
      const at = now();
      existing.meta = { ...existing.meta, rev: existing.meta.rev + 1, status: row.status, templateId: row.templateId, formId: row.formId, updatedAt: at };
      existing.payload = JSON.stringify(copy(row.payload));
      return { ok: true, rev: existing.meta.rev, updatedAt: at };
    },
    async deleteReport(tenantId, id) {
      return reports.delete(k(tenantId, id));
    },

    async listForms(tenantId) {
      return Array.from(forms.entries())
        .filter(([key]) => key.startsWith(`${tenantId}\u0000`))
        .map(([, row]) => ({ ...row.meta }));
    },
    async getForm(tenantId, id) {
      const row = forms.get(k(tenantId, id));
      return row ? { ...row.meta, payload: JSON.parse(row.payload) as unknown } : null;
    },
    async createForm(tenantId, row: StoreFormRow) {
      const bad = invalidId(row.id);
      if (bad) return bad;
      const existing = forms.get(k(tenantId, row.id));
      if (existing) return { ok: false, reason: "exists", currentRev: existing.meta.rev };
      const at = now();
      const { payload, ...rest } = row;
      forms.set(k(tenantId, row.id), { meta: { ...rest, rev: 1, createdAt: at, updatedAt: at }, payload: JSON.stringify(copy(payload)) });
      return { ok: true, rev: 1, updatedAt: at };
    },
    async updateForm(tenantId, row, expectedRev) {
      const existing = forms.get(k(tenantId, row.id));
      if (!existing) return { ok: false, reason: "not_found" };
      if (existing.meta.rev !== expectedRev) return { ok: false, reason: "conflict", currentRev: existing.meta.rev };
      const at = now();
      const { payload, ...rest } = row;
      existing.meta = { ...existing.meta, ...rest, rev: existing.meta.rev + 1, updatedAt: at };
      existing.payload = JSON.stringify(copy(payload));
      return { ok: true, rev: existing.meta.rev, updatedAt: at };
    },
    async deleteForm(tenantId, id) {
      return forms.delete(k(tenantId, id));
    },

    async getFileMeta(tenantId, sha256) {
      const meta = files.get(k(tenantId, sha256));
      return meta ? { ...meta } : null;
    },
    async getFile(tenantId, sha256) {
      const meta = files.get(k(tenantId, sha256));
      if (!meta) return null;
      const set = chunksOf(tenantId, sha256);
      const parts: Uint8Array[] = [];
      for (let i = 0; i < meta.chunkCount; i++) {
        const part = set.get(i);
        if (!part) return null;
        parts.push(part);
      }
      const bytes = new Uint8Array(Buffer.concat(parts));
      if (bytes.byteLength !== meta.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== sha256) {
        throw new Error("The stored file does not match its record.");
      }
      return { ...meta, bytes };
    },
    async deleteFile(tenantId, sha256) {
      chunkSets.delete(k(tenantId, sha256));
      return files.delete(k(tenantId, sha256));
    },
    async beginUpload(tenantId, input) {
      const chunkCount = Math.ceil(input.sizeBytes / CHUNK_BYTES);
      let meta = files.get(k(tenantId, input.sha256));
      const held = () => Array.from(chunksOf(tenantId, input.sha256).keys()).sort((a, b) => a - b);
      if (meta) {
        const present = held();
        if (present.length === meta.chunkCount) return { held: "all" as const, present, meta: { ...meta } };
        if (meta.sizeBytes === input.sizeBytes) return { held: present.length ? ("partial" as const) : ("none" as const), present, meta: { ...meta } };
        chunkSets.delete(k(tenantId, input.sha256));
      }
      meta = { sha256: input.sha256, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.sizeBytes, chunkCount };
      files.set(k(tenantId, input.sha256), meta);
      return { held: "none" as const, present: [], meta: { ...meta } };
    },
    async chunkIndexes(tenantId, sha256) {
      return Array.from(chunksOf(tenantId, sha256).keys()).sort((a, b) => a - b);
    },
    async putChunk(tenantId, sha256, idx, bytes) {
      const meta = files.get(k(tenantId, sha256));
      if (!meta) return "not_started";
      const expected = Math.min(CHUNK_BYTES, meta.sizeBytes - idx * CHUNK_BYTES);
      if (!Number.isInteger(idx) || idx < 0 || idx >= meta.chunkCount || bytes.byteLength !== expected) return "invalid";
      const set = chunksOf(tenantId, sha256);
      if (set.size === meta.chunkCount) return "complete";
      set.set(idx, new Uint8Array(bytes));
      return "written";
    },

    async getSettings(tenantId) {
      const row = settings.get(tenantId);
      return row ? { referrerLinks: JSON.parse(row.referrerLinks) as unknown, updatedAt: row.updatedAt } : null;
    },
    async putSettings(tenantId, referrerLinks) {
      const updatedAt = now();
      settings.set(tenantId, { referrerLinks: JSON.stringify(referrerLinks), updatedAt });
      return { updatedAt };
    },
    async audit(tenantId, entry) {
      auditLog.push({ ...entry, tenantId });
    },
  };
}
