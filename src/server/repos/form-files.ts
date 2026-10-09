/**
 * `form_files` + `form_file_chunks` – referrer files (Word / PDF) stored IN the database, per tenant,
 * content-addressed by SHA-256, split into ≤ 512 KiB plaintext chunks, each AES-GCM encrypted with AAD
 * "<tenant>:form_file_chunks:<sha256>:<idx>".
 *
 * Writes: the metadata row and the first chunks go in one atomic batch; larger files continue in further
 * batches of CHUNKS_PER_BATCH chunks (each request stays ~1.4 MB, well inside the gateway's limits and a
 * D1 row's 2 MB). A file counts as stored only when every chunk is present; reads verify the size and the
 * SHA-256 of the reassembled bytes, so a partial or tampered file is never returned. Re-putting the same
 * file repairs a partial one (chunks are upserted).
 */
import { createHash } from "node:crypto";
import { runBatch, type BatchQuery } from "../db/batch";
import {
  RepoInputError,
  assertSha256,
  assertTenantId,
  assertText,
  nowIso,
  toInt,
  type RepoContext,
} from "./context";

export const FILE_CHUNK_BYTES = 512 * 1024;
export const CHUNKS_PER_BATCH = 2;
/** Largest file accepted (the app caps referrer files at 3 MB; leave headroom). */
export const MAX_FORM_FILE_BYTES = 10 * 1024 * 1024;

const CHUNK_TABLE = "form_file_chunks";

export interface FormFileMeta {
  tenantId: string;
  sha256: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  chunkCount: number;
  createdAt: string;
}

export interface FormFile extends FormFileMeta {
  bytes: Buffer;
}

export class FileIntegrityError extends Error {
  readonly code = "FILE_INTEGRITY";
  constructor(message: string) {
    super(message);
    this.name = "FileIntegrityError";
  }
}

function chunkAad(tenantId: string, sha256: string, idx: number) {
  return { tenantId, table: CHUNK_TABLE, rowId: `${sha256}:${idx}` };
}

function toMeta(row: {
  tenant_id: string;
  sha256: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  chunk_count: number;
  created_at: string;
}): FormFileMeta {
  return {
    tenantId: row.tenant_id,
    sha256: row.sha256,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: toInt(row.size_bytes),
    chunkCount: toInt(row.chunk_count),
    createdAt: row.created_at,
  };
}

export async function getFormFileMeta(ctx: RepoContext, tenantId: string, sha256: string): Promise<FormFileMeta | null> {
  assertTenantId(tenantId);
  assertSha256(sha256);
  const row = await ctx.db
    .selectFrom("form_files")
    .selectAll()
    .where("tenant_id", "=", tenantId)
    .where("sha256", "=", sha256)
    .executeTakeFirst();
  return row ? toMeta(row) : null;
}

async function storedChunkCount(ctx: RepoContext, tenantId: string, sha256: string): Promise<number> {
  const row = await ctx.db
    .selectFrom("form_file_chunks")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("tenant_id", "=", tenantId)
    .where("sha256", "=", sha256)
    .executeTakeFirst();
  return row ? toInt(row.n) : 0;
}

/** True when the file and every one of its chunks are stored. */
export async function hasFormFile(ctx: RepoContext, tenantId: string, sha256: string): Promise<boolean> {
  const meta = await getFormFileMeta(ctx, tenantId, sha256);
  if (!meta) return false;
  return (await storedChunkCount(ctx, tenantId, sha256)) === meta.chunkCount;
}

export interface PutFormFileInput {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  /** When given, the bytes must hash to it (else RepoInputError). */
  expectedSha256?: string;
}

export interface PutFormFileResult {
  sha256: string;
  sizeBytes: number;
  chunkCount: number;
  /** false when the complete file was already stored (nothing written). */
  written: boolean;
}

export async function putFormFile(ctx: RepoContext, tenantId: string, input: PutFormFileInput): Promise<PutFormFileResult> {
  assertTenantId(tenantId);
  const bytes = Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
  if (bytes.length > MAX_FORM_FILE_BYTES) throw new RepoInputError("The file is too large to store.");
  const fileName = assertText(input.fileName, "File name", 255);
  const mimeType = assertText(input.mimeType, "MIME type", 127);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (input.expectedSha256 !== undefined && assertSha256(input.expectedSha256) !== sha256) {
    throw new RepoInputError("The file does not match its expected SHA-256.");
  }
  const chunkCount = Math.ceil(bytes.length / FILE_CHUNK_BYTES);

  const existing = await getFormFileMeta(ctx, tenantId, sha256);
  if (existing && existing.chunkCount === chunkCount && existing.sizeBytes === bytes.length) {
    if ((await storedChunkCount(ctx, tenantId, sha256)) === chunkCount) {
      return { sha256, sizeBytes: bytes.length, chunkCount, written: false };
    }
  }

  const chunkQuery = (idx: number): BatchQuery => {
    const plain = bytes.subarray(idx * FILE_CHUNK_BYTES, Math.min(bytes.length, (idx + 1) * FILE_CHUNK_BYTES));
    return ctx.db
      .insertInto("form_file_chunks")
      .values({ tenant_id: tenantId, sha256, idx, data_enc: ctx.cipher.encrypt(plain, chunkAad(tenantId, sha256, idx)) })
      .onConflict((oc) => oc.columns(["tenant_id", "sha256", "idx"]).doUpdateSet((eb) => ({ data_enc: eb.ref("excluded.data_enc") })));
  };

  const first: BatchQuery[] = [
    ctx.db
      .insertInto("form_files")
      .values({
        tenant_id: tenantId,
        sha256,
        file_name: fileName,
        mime_type: mimeType,
        size_bytes: bytes.length,
        chunk_count: chunkCount,
        created_at: nowIso(ctx),
      })
      .onConflict((oc) => oc.columns(["tenant_id", "sha256"]).doNothing()),
  ];
  for (let idx = 0; idx < Math.min(CHUNKS_PER_BATCH, chunkCount); idx++) first.push(chunkQuery(idx));
  await runBatch(ctx.db, first);
  for (let start = CHUNKS_PER_BATCH; start < chunkCount; start += CHUNKS_PER_BATCH) {
    const batch: BatchQuery[] = [];
    for (let idx = start; idx < Math.min(start + CHUNKS_PER_BATCH, chunkCount); idx++) batch.push(chunkQuery(idx));
    await runBatch(ctx.db, batch);
  }
  return { sha256, sizeBytes: bytes.length, chunkCount, written: true };
}

/** The file's bytes, verified (size + SHA-256), or null when it is missing or incomplete. */
export async function getFormFile(ctx: RepoContext, tenantId: string, sha256: string): Promise<FormFile | null> {
  const meta = await getFormFileMeta(ctx, tenantId, sha256);
  if (!meta) return null;
  const parts: Buffer[] = [];
  for (let start = 0; start < meta.chunkCount; start += CHUNKS_PER_BATCH) {
    const rows = await ctx.db
      .selectFrom("form_file_chunks")
      .select(["idx", "data_enc"])
      .where("tenant_id", "=", tenantId)
      .where("sha256", "=", sha256)
      .where("idx", ">=", start)
      .where("idx", "<", start + CHUNKS_PER_BATCH)
      .orderBy("idx")
      .execute();
    const expected = Math.min(CHUNKS_PER_BATCH, meta.chunkCount - start);
    if (rows.length !== expected) return null; // incomplete upload: not stored yet
    for (let i = 0; i < rows.length; i++) {
      const idx = toInt(rows[i].idx);
      if (idx !== start + i) return null;
      const plain = ctx.cipher.decryptBytes(rows[i].data_enc, chunkAad(tenantId, sha256, idx));
      if (plain.length > FILE_CHUNK_BYTES) throw new FileIntegrityError("A stored file chunk is larger than allowed.");
      parts.push(plain);
    }
  }
  const bytes = Buffer.concat(parts);
  if (bytes.length !== meta.sizeBytes) throw new FileIntegrityError("The stored file's size does not match its record.");
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) {
    throw new FileIntegrityError("The stored file's SHA-256 does not match its record.");
  }
  return { ...meta, bytes };
}

export async function listFormFiles(ctx: RepoContext, tenantId: string): Promise<FormFileMeta[]> {
  assertTenantId(tenantId);
  const rows = await ctx.db
    .selectFrom("form_files")
    .selectAll()
    .where("tenant_id", "=", tenantId)
    .orderBy("created_at", "desc")
    .orderBy("sha256")
    .execute();
  return rows.map(toMeta);
}

/** Deletes the file and its chunks (one atomic batch). */
export async function deleteFormFile(ctx: RepoContext, tenantId: string, sha256: string): Promise<boolean> {
  assertTenantId(tenantId);
  assertSha256(sha256);
  const [, files] = await runBatch(ctx.db, [
    ctx.db.deleteFrom("form_file_chunks").where("tenant_id", "=", tenantId).where("sha256", "=", sha256),
    ctx.db.deleteFrom("form_files").where("tenant_id", "=", tenantId).where("sha256", "=", sha256),
  ]);
  return Number(files.numAffectedRows ?? 0) > 0;
}
