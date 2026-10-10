/**
 * The host's TenantStore (src/modules/medreport/api/store-port.ts) over the tenant-scoped repositories:
 * reports and form maps encrypted per tenant (payload_enc), form files encrypted in 512 KiB chunks, settings,
 * and the append-only audit log. The /store/** handlers own every rule; this adapter only maps calls onto the
 * repositories and turns a repository's input refusal (RepoInputError) into {ok: false, reason: "invalid"}.
 *
 * `ctx` is called per operation, so building the store touches neither the database nor the keys (the public
 * demo never configures them; the handlers refuse before any call without a signed-in member).
 */
import "server-only";
import type {
  StoreFormRow,
  StoreReportRow,
  StoreSaveResult,
  StoredFileMeta,
  StoredFormMeta,
  StoredReportMeta,
  TenantStore,
} from "../../modules/medreport/api/store-port";
import { appendAudit } from "../repos/audit";
import { RepoInputError, type RepoContext } from "../repos/context";
import { beginFormFileUpload, formFileChunkIndexes, putFormFileChunk } from "../repos/form-file-uploads";
import { deleteFormFile, getFormFile, getFormFileMeta, type FormFileMeta } from "../repos/form-files";
import { createForm, deleteForm, getForm, listFormMeta, updateForm, type FormMeta } from "../repos/forms";
import { createReport, deleteReport, getReport, getReportMeta, listReports, updateReport, type ReportMeta } from "../repos/reports";
import { getTenantSettings, putTenantSettings } from "../repos/tenant-settings";
import type { SaveResult } from "../repos/versioned";

/** Most reports listed in a snapshot (metadata only; the repository's own cap). */
const SNAPSHOT_REPORT_LIMIT = 1000;

/**
 * The stored payload's size as JSON, estimated from its encrypted text (base64 of the ciphertext: about 4 characters
 * per 3 bytes, plus the nonce, tag and header) – for the clinic's daily new-data allowance (fix wave 3).
 */
export function estimatePlainBytes(storedChars: number): number {
  return Math.max(0, Math.floor((storedChars * 3) / 4) - 64);
}

function reportMeta(m: ReportMeta): StoredReportMeta {
  return {
    id: m.id,
    rev: m.rev,
    status: m.status,
    templateId: m.templateId,
    formId: m.formId,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    ...(m.storedChars !== undefined ? { storedBytes: estimatePlainBytes(m.storedChars) } : {}),
  };
}

function fileMeta(m: FormFileMeta): StoredFileMeta {
  return { sha256: m.sha256, fileName: m.fileName, mimeType: m.mimeType, sizeBytes: m.sizeBytes, chunkCount: m.chunkCount };
}

function formMeta(m: FormMeta): StoredFormMeta {
  return {
    id: m.id,
    rev: m.rev,
    status: m.status,
    title: m.title,
    referrer: m.referrer,
    kind: m.kind,
    fileSha256: m.fileSha256,
    sampleId: m.sampleId,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

async function guarded(run: () => Promise<SaveResult>): Promise<StoreSaveResult> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof RepoInputError) return { ok: false, reason: "invalid", message: err.message };
    throw err;
  }
}

function reportInput(row: StoreReportRow) {
  return { id: row.id, status: row.status, templateId: row.templateId, formId: row.formId, payload: row.payload };
}

function formInput(row: StoreFormRow) {
  return {
    id: row.id,
    fileSha256: row.fileSha256,
    status: row.status,
    title: row.title,
    referrer: row.referrer,
    kind: row.kind,
    sampleId: row.sampleId,
    payload: row.payload,
  };
}

export function createTenantStore(ctx: () => RepoContext): TenantStore {
  return {
    /* Reports */
    async listReports(tenantId) {
      return (await listReports(ctx(), tenantId, { withPayload: false, limit: SNAPSHOT_REPORT_LIMIT })).map(reportMeta);
    },
    async getReportMeta(tenantId, id) {
      const meta = await getReportMeta(ctx(), tenantId, id);
      return meta ? reportMeta(meta) : null;
    },
    async getReport(tenantId, id) {
      const record = await getReport(ctx(), tenantId, id);
      return record ? { ...reportMeta(record), payload: record.payload } : null;
    },
    createReport(tenantId, row) {
      return guarded(() => createReport(ctx(), tenantId, reportInput(row)));
    },
    updateReport(tenantId, row, expectedRev) {
      return guarded(() => updateReport(ctx(), tenantId, reportInput(row), expectedRev));
    },
    deleteReport(tenantId, id) {
      return deleteReport(ctx(), tenantId, id);
    },

    /* Form maps */
    async listForms(tenantId) {
      return (await listFormMeta(ctx(), tenantId)).map(formMeta);
    },
    async getForm(tenantId, id) {
      const record = await getForm(ctx(), tenantId, id);
      return record ? { ...formMeta(record), payload: record.payload } : null;
    },
    createForm(tenantId, row) {
      return guarded(() => createForm(ctx(), tenantId, formInput(row)));
    },
    updateForm(tenantId, row, expectedRev) {
      return guarded(() => updateForm(ctx(), tenantId, formInput(row), expectedRev));
    },
    deleteForm(tenantId, id) {
      return deleteForm(ctx(), tenantId, id);
    },

    /* Form files */
    async getFileMeta(tenantId, sha256) {
      const meta = await getFormFileMeta(ctx(), tenantId, sha256);
      return meta ? fileMeta(meta) : null;
    },
    async getFile(tenantId, sha256) {
      const file = await getFormFile(ctx(), tenantId, sha256);
      if (!file) return null;
      return { ...fileMeta(file), bytes: new Uint8Array(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength) };
    },
    deleteFile(tenantId, sha256) {
      return deleteFormFile(ctx(), tenantId, sha256);
    },
    async beginUpload(tenantId, input) {
      const begun = await beginFormFileUpload(ctx(), tenantId, input);
      return { held: begun.held, present: begun.present, meta: fileMeta(begun.meta) };
    },
    chunkIndexes(tenantId, sha256) {
      return formFileChunkIndexes(ctx(), tenantId, sha256);
    },
    async putChunk(tenantId, sha256, idx, bytes) {
      try {
        return await putFormFileChunk(ctx(), tenantId, sha256, idx, bytes);
      } catch (err) {
        if (err instanceof RepoInputError) return "invalid";
        throw err;
      }
    },

    /* Settings and audit */
    async getSettings(tenantId) {
      const settings = await getTenantSettings(ctx(), tenantId);
      return settings ? { referrerLinks: settings.referrerLinks, updatedAt: settings.updatedAt } : null;
    },
    async putSettings(tenantId, referrerLinks) {
      const saved = await putTenantSettings(ctx(), tenantId, referrerLinks);
      return { updatedAt: saved.updatedAt };
    },
    async audit(tenantId, entry) {
      await appendAudit(ctx(), tenantId, {
        userId: entry.userId,
        sessionId: entry.sessionId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        detail: entry.detail ?? null,
      });
    },
  };
}
