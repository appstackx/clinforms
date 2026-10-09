/**
 * Chunked uploads of referrer files into `form_files` + `form_file_chunks` (the Studio's POST /store/files flow,
 * wave 2), built on form-files.ts's own rule: "a file counts as stored only when every chunk is present; reads
 * verify the size and the SHA-256 of the reassembled bytes, so a partial or tampered file is never returned".
 *
 * - beginFormFileUpload records the file's metadata row (the chunks' foreign key needs it) and reports which
 *   chunks are already held – an upload resumes where it stopped. A partial upload recorded with a different
 *   size is started afresh.
 * - putFormFileChunk writes one chunk, encrypted exactly as putFormFile does (AAD
 *   "<tenant>:form_file_chunks:<sha256>:<idx>"), checked against the recorded size (index range, exact length).
 *   It never writes into a file that already has all its chunks.
 * - Completion is getFormFile (size + SHA-256 verified) plus the caller's type check; a damaged upload is removed
 *   with deleteFormFile.
 * - purgeIncompleteUploads removes uploads that never got all their chunks (for the retention job).
 */
import { RepoInputError, assertSha256, assertTenantId, assertText, nowIso, toInt, type DbContext, type RepoContext } from "./context";
import { FILE_CHUNK_BYTES, MAX_FORM_FILE_BYTES, deleteFormFile, getFormFileMeta, type FormFileMeta } from "./form-files";

const CHUNK_TABLE = "form_file_chunks";

/** Same AAD as form-files.ts (an uploaded file must read back through getFormFile). */
function chunkAad(tenantId: string, sha256: string, idx: number) {
  return { tenantId, table: CHUNK_TABLE, rowId: `${sha256}:${idx}` };
}

export function chunkCountFor(sizeBytes: number): number {
  return Math.ceil(sizeBytes / FILE_CHUNK_BYTES);
}

/** Indexes of the chunks held for (tenant, sha256), ascending. */
export async function formFileChunkIndexes(ctx: DbContext, tenantId: string, sha256: string): Promise<number[]> {
  assertTenantId(tenantId);
  assertSha256(sha256);
  const rows = await ctx.db
    .selectFrom("form_file_chunks")
    .select("idx")
    .where("tenant_id", "=", tenantId)
    .where("sha256", "=", sha256)
    .orderBy("idx")
    .execute();
  return rows.map((r) => toInt(r.idx));
}

export interface BeginUploadInput {
  sha256: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface BeginUploadResult {
  /** "all" = every chunk is held (the caller verifies the file); "partial" / "none" = keep uploading. */
  held: "none" | "partial" | "all";
  /** Chunk indexes already held. */
  present: number[];
  meta: FormFileMeta;
}

export async function beginFormFileUpload(ctx: RepoContext, tenantId: string, input: BeginUploadInput): Promise<BeginUploadResult> {
  assertTenantId(tenantId);
  const sha256 = assertSha256(input.sha256);
  const fileName = assertText(input.fileName, "File name", 255);
  const mimeType = assertText(input.mimeType, "MIME type", 127);
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_FORM_FILE_BYTES) {
    throw new RepoInputError("The file size is out of range.");
  }
  const chunkCount = chunkCountFor(input.sizeBytes);
  let meta = await getFormFileMeta(ctx, tenantId, sha256);
  if (meta) {
    const present = await formFileChunkIndexes(ctx, tenantId, sha256);
    const all = present.length === meta.chunkCount;
    if (all) return { held: "all", present, meta };
    if (meta.sizeBytes === input.sizeBytes) return { held: present.length ? "partial" : "none", present, meta };
    // A partial upload recorded with another size: start again.
    await deleteFormFile(ctx, tenantId, sha256);
  }
  await ctx.db
    .insertInto("form_files")
    .values({ tenant_id: tenantId, sha256, file_name: fileName, mime_type: mimeType, size_bytes: input.sizeBytes, chunk_count: chunkCount, created_at: nowIso(ctx) })
    .onConflict((oc) => oc.columns(["tenant_id", "sha256"]).doNothing())
    .execute();
  meta = await getFormFileMeta(ctx, tenantId, sha256);
  if (!meta) throw new Error("The upload could not be recorded.");
  const present = await formFileChunkIndexes(ctx, tenantId, sha256);
  return { held: present.length === meta.chunkCount ? "all" : present.length ? "partial" : "none", present, meta };
}

export type PutChunkResult = "written" | "complete" | "not_started";

/**
 * Store (or replace) chunk `idx` of an upload in progress. "not_started" without the file's record,
 * "complete" (nothing written) when every chunk is already held. RepoInputError on a bad index or length.
 */
export async function putFormFileChunk(ctx: RepoContext, tenantId: string, sha256: string, idx: number, bytes: Uint8Array): Promise<PutChunkResult> {
  assertTenantId(tenantId);
  assertSha256(sha256);
  const meta = await getFormFileMeta(ctx, tenantId, sha256);
  if (!meta) return "not_started";
  if (!Number.isInteger(idx) || idx < 0 || idx >= meta.chunkCount) throw new RepoInputError("Chunk index out of range.");
  const expected = Math.min(FILE_CHUNK_BYTES, meta.sizeBytes - idx * FILE_CHUNK_BYTES);
  if (bytes.byteLength !== expected) throw new RepoInputError(`Chunk ${idx} must be ${expected} bytes.`);
  if ((await formFileChunkIndexes(ctx, tenantId, sha256)).length === meta.chunkCount) return "complete";
  const data = ctx.cipher.encrypt(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), chunkAad(tenantId, sha256, idx));
  await ctx.db
    .insertInto("form_file_chunks")
    .values({ tenant_id: tenantId, sha256, idx, data_enc: data })
    .onConflict((oc) => oc.columns(["tenant_id", "sha256", "idx"]).doUpdateSet((eb) => ({ data_enc: eb.ref("excluded.data_enc") })))
    .execute();
  return "written";
}

/** Deletes uploads recorded before `beforeIso` that never got all their chunks. Returns how many. */
export async function purgeIncompleteUploads(ctx: DbContext, beforeIso: string): Promise<number> {
  const rows = await ctx.db
    .selectFrom("form_files")
    .leftJoin("form_file_chunks", (join) =>
      join.onRef("form_file_chunks.tenant_id", "=", "form_files.tenant_id").onRef("form_file_chunks.sha256", "=", "form_files.sha256"),
    )
    .select((eb) => [
      "form_files.tenant_id as tenant_id",
      "form_files.sha256 as sha256",
      "form_files.chunk_count as chunk_count",
      eb.fn.count<number>("form_file_chunks.idx").as("held"),
    ])
    .where("form_files.created_at", "<", beforeIso)
    .groupBy(["form_files.tenant_id", "form_files.sha256", "form_files.chunk_count"])
    .execute();
  let purged = 0;
  for (const row of rows) {
    if (toInt(row.held) >= toInt(row.chunk_count)) continue;
    if (await deleteFormFile(ctx, row.tenant_id, row.sha256)) purged += 1;
  }
  return purged;
}
