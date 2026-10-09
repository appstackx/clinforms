import "server-only";

/**
 * Form files in the clinic's storage (signed-in clinic member, two-step verified). Content-addressed by
 * SHA-256; the host keeps them encrypted in ≤ 512 KiB chunks (docs/production-architecture.md §1, §5).
 *
 * POST /store/files {sha256, size, name, mime}
 *   → {sha256, complete, chunkBytes, chunkCount, present}. complete = the clinic already holds this exact
 *     file (nothing to upload); present = chunks already received (resume after a dropped connection).
 * PUT  /store/files/{sha256}/chunks/{idx}
 *   body: the chunk's raw bytes (application/octet-stream, ?size=<total bytes>) or JSON {size, dataBase64}.
 *   Every chunk is exactly STORE_FILE_CHUNK_BYTES except the last (422 otherwise); idx < chunkCount.
 *   → {idx, received, complete}. A chunk for a file already stored is not written (complete: true).
 * POST /store/files/{sha256}/complete {size, name, mime}
 *   → {sha256, sizeBytes, mimeType, fileName}. Checks that every chunk is present (409 UPLOAD_INCOMPLETE
 *   with `missing`), that the bytes hash to the SHA-256 and have the size (422 UPLOAD_CORRUPT – the upload is
 *   thrown away; start again), and that the file is a Word or PDF form within the limits and of the declared
 *   type (413 / 422 FORM_INVALID, from forms/file.ts – the upload is thrown away). Idempotent.
 *   A file counts as held once every chunk is present: reads always verify size and SHA-256
 *   (src/server/repos/form-files.ts), so a partial or damaged upload is never served.
 * GET  /store/files/{sha256} → the decrypted file (404 when the clinic does not hold it).
 *
 * Total size ≤ MAX_FORM_FILE_BYTES. Uploads and completions are audited (sizes and types only).
 *
 * Owner: store slice (wave 2).
 */
import { MAX_FORM_FILE_BYTES } from "../../config.public";
import { decodeFormFile } from "../../forms/file";
import { CONTENT_TYPES } from "../contract";
import { HttpError, fileResponse, json, logEvent, parseBody, problem, type MedreportHandler } from "../http";
import {
  STORE_FILE_CHUNK_BYTES,
  StoreFileChunkJsonSchema,
  StoreFileCompleteRequestSchema,
  StoreFileInitRequestSchema,
  storeChunkCount,
  storeChunkLength,
  type StoreFileChunkResponse,
  type StoreFileCompleteResponse,
  type StoreFileInitResponse,
} from "../store-contract";
import { assertContentType, auditStore, pathParam, problemWith, requireTenantActor, type TenantActor } from "./store-actor";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const OCTET_STREAM = "application/octet-stream";
/** A JSON chunk: base64 (4/3) plus the envelope. */
const MAX_JSON_CHUNK_BYTES = Math.ceil((STORE_FILE_CHUNK_BYTES * 4) / 3) + 1024;

function chunkIndex(params: Record<string, string>): number {
  const idx = Number(pathParam(params, "idx", /^\d{1,5}$/));
  return idx;
}

function sizeFromQuery(req: Request): number {
  const raw = new URL(req.url).searchParams.get("size") ?? "";
  const size = /^\d{1,9}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(size) || size < 1 || size > MAX_FORM_FILE_BYTES) {
    throw new HttpError(422, "Invalid size", {
      code: "VALIDATION_FAILED",
      issues: [{ path: "size", message: `The total file size in bytes (1–${MAX_FORM_FILE_BYTES}).` }],
    });
  }
  return size;
}

async function readRawChunk(req: Request): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > STORE_FILE_CHUNK_BYTES) throw new HttpError(413, "Chunk too large", { code: "PAYLOAD_TOO_LARGE" });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > STORE_FILE_CHUNK_BYTES) throw new HttpError(413, "Chunk too large", { code: "PAYLOAD_TOO_LARGE" });
  return bytes;
}

/** Verified bytes of a file whose chunks are all held; "damaged" when they do not verify (the caller deletes). */
async function heldFile(t: TenantActor, sha256: string): Promise<Uint8Array | "damaged" | null> {
  try {
    const file = await t.store.getFile(t.tenantId, sha256);
    return file ? file.bytes : null;
  } catch (err) {
    logEvent("store_file_damaged", { error: err instanceof Error ? err.name : typeof err });
    return "damaged";
  }
}

/** The form type read from the bytes (413 / 422 FORM_INVALID via forms/file.ts). */
function formTypeOf(bytes: Uint8Array): StoreFileCompleteResponse["mimeType"] {
  return decodeFormFile(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64")).mimeType;
}

export const handleStoreFileInit: MedreportHandler = async (req, _ctx, deps) => {
  const t = await requireTenantActor(req, deps, { write: true });
  assertContentType(req);
  const parsed = await parseBody(req, StoreFileInitRequestSchema, { maxBytes: 4096 });
  if (!parsed.ok) return parsed.response;
  const { sha256, size, name, mime } = parsed.data;
  const input = { sha256, fileName: name, mimeType: mime, sizeBytes: size };
  let begun = await t.store.beginUpload(t.tenantId, input);
  if (begun.held === "all") {
    // Every chunk is held: the clinic holds this exact file if it verifies and is a form.
    const bytes = await heldFile(t, sha256);
    let ok = bytes instanceof Uint8Array;
    if (bytes instanceof Uint8Array) {
      try {
        ok = formTypeOf(bytes) === begun.meta.mimeType;
      } catch {
        ok = false;
      }
    }
    if (ok) {
      const done: StoreFileInitResponse = { sha256, complete: true, chunkBytes: STORE_FILE_CHUNK_BYTES, chunkCount: begun.meta.chunkCount, present: begun.present };
      return json(done);
    }
    await t.store.deleteFile(t.tenantId, sha256);
    begun = await t.store.beginUpload(t.tenantId, input);
  }
  const body: StoreFileInitResponse = { sha256, complete: false, chunkBytes: STORE_FILE_CHUNK_BYTES, chunkCount: begun.meta.chunkCount, present: begun.present };
  return json(body);
};

export const handleStoreFileChunk: MedreportHandler = async (req, ctx, deps) => {
  const t = await requireTenantActor(req, deps, { write: true });
  const sha256 = pathParam(ctx.params, "sha256", SHA256_PATTERN);
  const idx = chunkIndex(ctx.params);
  const type = assertContentType(req, [OCTET_STREAM, CONTENT_TYPES.json]);
  let size: number;
  let bytes: Uint8Array;
  if (type === OCTET_STREAM) {
    size = sizeFromQuery(req);
    bytes = await readRawChunk(req);
  } else {
    const parsed = await parseBody(req, StoreFileChunkJsonSchema, { maxBytes: MAX_JSON_CHUNK_BYTES });
    if (!parsed.ok) return parsed.response;
    size = parsed.data.size;
    bytes = new Uint8Array(Buffer.from(parsed.data.dataBase64, "base64"));
  }
  const expected = storeChunkLength(size, idx);
  if (expected === 0) {
    return problem(422, "No such chunk", { code: "VALIDATION_FAILED", issues: [{ path: "idx", message: `A ${size}-byte file has ${storeChunkCount(size)} chunks.` }] });
  }
  if (bytes.byteLength !== expected) {
    return problem(422, "Chunk has the wrong length", {
      code: "VALIDATION_FAILED",
      issues: [{ path: "body", message: `Chunk ${idx} of a ${size}-byte file is ${expected} bytes (received ${bytes.byteLength}).` }],
    });
  }
  const meta = await t.store.getFileMeta(t.tenantId, sha256);
  if (meta && meta.sizeBytes !== size) {
    return problem(422, "The size differs from the upload's", { code: "VALIDATION_FAILED", issues: [{ path: "size", message: `This upload is ${meta.sizeBytes} bytes.` }] });
  }
  const result = meta ? await t.store.putChunk(t.tenantId, sha256, idx, bytes) : "not_started";
  if (result === "not_started") {
    return problemWith(409, "The upload has not been started", "UPLOAD_INCOMPLETE", "Start the upload first.", { missing: [] });
  }
  if (result === "invalid") return problem(422, "The chunk does not fit this upload", { code: "VALIDATION_FAILED" });
  // "complete": every chunk is already held – nothing was written (a held file cannot be damaged that way).
  const body: StoreFileChunkResponse = { idx, received: result === "written" ? bytes.byteLength : 0, complete: result === "complete" };
  return json(body);
};

export const handleStoreFileComplete: MedreportHandler = async (req, ctx, deps) => {
  const t = await requireTenantActor(req, deps, { write: true });
  assertContentType(req);
  const sha256 = pathParam(ctx.params, "sha256", SHA256_PATTERN);
  const parsed = await parseBody(req, StoreFileCompleteRequestSchema, { maxBytes: 4096 });
  if (!parsed.ok) return parsed.response;

  const meta = await t.store.getFileMeta(t.tenantId, sha256);
  if (!meta) {
    return problemWith(409, "The upload has not been started", "UPLOAD_INCOMPLETE", "Start the upload first.", { missing: [] });
  }
  const bytes = await heldFile(t, sha256);
  if (bytes === "damaged") {
    await t.store.deleteFile(t.tenantId, sha256);
    return problem(422, "The upload was damaged", { code: "UPLOAD_CORRUPT", detail: "The file that arrived differs from the one sent. Upload it again." });
  }
  if (!bytes) {
    const present = new Set(await t.store.chunkIndexes(t.tenantId, sha256));
    const missing: number[] = [];
    for (let i = 0; i < meta.chunkCount; i++) if (!present.has(i)) missing.push(i);
    return problemWith(409, "The upload is not complete", "UPLOAD_INCOMPLETE", "Some parts of the file have not arrived yet. Send them and try again.", { missing });
  }
  let mimeType: StoreFileCompleteResponse["mimeType"];
  try {
    mimeType = formTypeOf(bytes);
  } catch (err) {
    await t.store.deleteFile(t.tenantId, sha256);
    throw err;
  }
  if (mimeType !== meta.mimeType) {
    await t.store.deleteFile(t.tenantId, sha256);
    return problem(422, "The file type differs from the one declared", {
      code: "FORM_INVALID",
      detail: "Upload the referrer's form again: its type did not match what was declared.",
    });
  }
  await auditStore(t, { action: "file.upload", targetType: "form_file", targetId: sha256, detail: { sizeBytes: meta.sizeBytes, mimeType } });
  const body: StoreFileCompleteResponse = { sha256, sizeBytes: meta.sizeBytes, mimeType, fileName: meta.fileName };
  return json(body);
};

export const handleStoreFileGet: MedreportHandler = async (req, ctx, deps) => {
  const t = await requireTenantActor(req, deps);
  const sha256 = pathParam(ctx.params, "sha256", SHA256_PATTERN);
  const bytes = await heldFile(t, sha256);
  const meta = bytes instanceof Uint8Array ? await t.store.getFileMeta(t.tenantId, sha256) : null;
  if (!(bytes instanceof Uint8Array) || !meta) return problem(404, "File not found", { code: "NOT_FOUND", detail: "The clinic does not hold this form file." });
  return fileResponse(bytes, { contentType: meta.mimeType, fileName: meta.fileName });
};
