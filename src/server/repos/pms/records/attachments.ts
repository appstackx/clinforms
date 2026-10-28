/**
 * `pms_attachments` + `pms_attachment_chunks` – files attached to a patient's record (referral letters, scan
 * reports, photos of exercise sheets), stored IN the database, encrypted per clinic:
 *
 * - the file is split into 256 KiB pieces; each piece is stored as base64 inside an AES-GCM ciphertext
 *   (data_enc, AAD "<tenant>:pms_attachment_chunks.data_enc:<attachment id>.<idx>"), so the offboarding export –
 *   which decrypts every _enc column as text – carries the bytes intact;
 * - the file name and description are encrypted too (a file name often holds the patient's name);
 * - the metadata row, the first pieces and the audit row go in one atomic batch, the rest in further batches of
 *   CHUNKS_PER_BATCH (each request ≈ 1.4 MB); a read checks every piece, the size and the SHA-256, so an
 *   unfinished or altered file is never returned;
 * - the type comes from the file's own bytes (src/modules/pms/records/attachments.ts), never from its name;
 * - never deleted: a file is withdrawn (hidden, kept) – attachments are part of the clinical record.
 */
import { createHash } from "node:crypto";
import type { Selectable } from "kysely";
import { ATTACHMENT_TYPES, MAX_ATTACHMENTS_PER_PATIENT, MAX_DESCRIPTION_CHARS, checkAttachment, safeFileName, type AttachmentType } from "../../../../modules/pms/records/attachments";
import { RECORDS_ID_PREFIXES as P } from "../../../../modules/pms/records/ids";
import type { AttachmentDetails, AttachmentMeta } from "../../../../modules/pms/records/types";
import type { PmsActor } from "../../../../modules/pms/core/types";
import { runBatch, type BatchQuery } from "../../../db/batch";
import type { PmsAttachmentsTable } from "../../../db/pms-schema/records";
import { RepoInputError, assertId, assertTenantId, decryptField, encryptField, nowIso, num, pmsAudit, pmsAuditQuery, pmsId, translateDbError, type RepoContext } from "../context";
import { updateWithAudit } from "./write";

const T = "pms_attachments";
const CH = "pms_attachment_chunks";
export const ATTACHMENT_CHUNK_BYTES = 256 * 1024;
export const CHUNKS_PER_BATCH = 3;
const MESSAGES = { foreignKey: "The patient, note or case does not exist in this clinic (they must all be the same patient's)." };

type Row = Selectable<PmsAttachmentsTable>;

const META_COLUMNS = [
  "tenant_id",
  "id",
  "patient_id",
  "note_id",
  "case_id",
  "file_type",
  "mime_type",
  "size_bytes",
  "sha256",
  "chunk_count",
  "status",
  "uploaded_by",
  "created_at",
  "withdrawn_at",
] as const;

function toMeta(r: Pick<Row, (typeof META_COLUMNS)[number]>): AttachmentMeta {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    patientId: r.patient_id,
    noteId: r.note_id,
    caseId: r.case_id,
    type: r.file_type as AttachmentType,
    mimeType: r.mime_type,
    sizeBytes: num(r.size_bytes),
    sha256: r.sha256,
    chunkCount: num(r.chunk_count),
    status: r.status as AttachmentMeta["status"],
    uploadedBy: r.uploaded_by,
    createdAt: r.created_at,
    withdrawnAt: r.withdrawn_at,
  };
}

function toDetails(ctx: RepoContext, r: Row): AttachmentDetails {
  return {
    ...toMeta(r),
    fileName: decryptField(ctx, r.tenant_id, T, "file_name_enc", r.id, r.file_name_enc) ?? `attachment.${ATTACHMENT_TYPES[r.file_type as AttachmentType]?.extension ?? "bin"}`,
    description: decryptField(ctx, r.tenant_id, T, "description_enc", r.id, r.description_enc),
    withdrawnReason: decryptField(ctx, r.tenant_id, T, "withdrawn_reason_enc", r.id, r.withdrawn_reason_enc),
  };
}

const chunkId = (attachmentId: string, idx: number) => `${attachmentId}.${String(idx).padStart(3, "0")}`;

export interface PutAttachmentInput {
  patientId: string;
  noteId?: string | null;
  caseId?: string | null;
  bytes: Uint8Array;
  fileName: string;
  description?: string | null;
}

/** Stores a file on a patient's record. Returns its metadata. */
export async function putAttachment(ctx: RepoContext, tenantId: string, input: PutAttachmentInput, actor: PmsActor): Promise<AttachmentMeta> {
  assertTenantId(tenantId);
  assertId(input.patientId, "patient id");
  const bytes = Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
  const check = checkAttachment(bytes);
  if (!check.ok) throw new RepoInputError(check.error);
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (description.length > MAX_DESCRIPTION_CHARS) throw new RepoInputError(`The description can be at most ${MAX_DESCRIPTION_CHARS} characters.`);
  const existing = await ctx.db
    .selectFrom(T)
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("tenant_id", "=", tenantId)
    .where("patient_id", "=", input.patientId)
    .executeTakeFirst();
  if (num(existing?.n ?? 0) >= MAX_ATTACHMENTS_PER_PATIENT) throw new RepoInputError(`A patient's record can hold at most ${MAX_ATTACHMENTS_PER_PATIENT} files.`);

  const id = pmsId(P.attachment, ctx);
  const at = nowIso(ctx);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const chunkCount = Math.ceil(bytes.length / ATTACHMENT_CHUNK_BYTES);
  const chunkQuery = (idx: number): BatchQuery => {
    const cid = chunkId(id, idx);
    const piece = bytes.subarray(idx * ATTACHMENT_CHUNK_BYTES, Math.min(bytes.length, (idx + 1) * ATTACHMENT_CHUNK_BYTES));
    return ctx.db.insertInto(CH).values({ tenant_id: tenantId, id: cid, attachment_id: id, idx, data_enc: encryptField(ctx, tenantId, CH, "data_enc", cid, piece.toString("base64")), created_at: at });
  };
  const first: BatchQuery[] = [
    ctx.db.insertInto(T).values({
      tenant_id: tenantId,
      id,
      patient_id: input.patientId,
      note_id: input.noteId ?? null,
      case_id: input.caseId ?? null,
      file_type: check.type,
      mime_type: ATTACHMENT_TYPES[check.type].mime,
      size_bytes: bytes.length,
      sha256,
      chunk_count: chunkCount,
      file_name_enc: encryptField(ctx, tenantId, T, "file_name_enc", id, safeFileName(input.fileName, check.type)),
      description_enc: encryptField(ctx, tenantId, T, "description_enc", id, description || null),
      status: "active",
      withdrawn_at: null,
      withdrawn_by: null,
      withdrawn_reason_enc: null,
      uploaded_by: actor.userId,
      anonymised_at: null,
      created_at: at,
      updated_at: at,
    }),
  ];
  for (let idx = 0; idx < Math.min(CHUNKS_PER_BATCH, chunkCount); idx++) first.push(chunkQuery(idx));
  first.push(pmsAuditQuery(ctx, tenantId, actor, { action: "pms.attachment.upload", targetType: "pms_attachment", targetId: id, detail: { patientId: input.patientId, type: check.type, sizeBytes: bytes.length } }));
  try {
    await runBatch(ctx.db, first);
  } catch (err) {
    throw translateDbError(err, MESSAGES);
  }
  try {
    for (let start = CHUNKS_PER_BATCH; start < chunkCount; start += CHUNKS_PER_BATCH) {
      const batch: BatchQuery[] = [];
      for (let idx = start; idx < Math.min(start + CHUNKS_PER_BATCH, chunkCount); idx++) batch.push(chunkQuery(idx));
      await runBatch(ctx.db, batch);
    }
  } catch (err) {
    // The file did not finish: withdraw it so it never shows as usable (reads would refuse it anyway).
    await withdrawAttachment(ctx, tenantId, id, "The upload did not finish.", actor).catch(() => false);
    throw err;
  }
  const row = await ctx.db.selectFrom(T).select(META_COLUMNS).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirstOrThrow();
  return toMeta(row);
}

/** A patient's files (metadata only – nothing decrypted), newest first. */
export async function listAttachmentsForPatient(ctx: RepoContext, tenantId: string, patientId: string, options: { includeWithdrawn?: boolean } = {}): Promise<AttachmentMeta[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom(T).select(META_COLUMNS).where("tenant_id", "=", tenantId).where("patient_id", "=", patientId);
  if (!options.includeWithdrawn) q = q.where("status", "=", "active");
  const rows = await q.orderBy("created_at", "desc").orderBy("id", "desc").limit(MAX_ATTACHMENTS_PER_PATIENT).execute();
  return rows.map(toMeta);
}

/**
 * ONE patient's files with their names and descriptions decrypted, for that patient's own Files tab (bounded:
 * at most MAX_ATTACHMENTS_PER_PATIENT rows of one record – not a clinic-wide list).
 */
export async function getPatientAttachments(ctx: RepoContext, tenantId: string, patientId: string, options: { includeWithdrawn?: boolean } = {}): Promise<AttachmentDetails[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("patient_id", "=", patientId);
  if (!options.includeWithdrawn) q = q.where("status", "=", "active");
  const rows = await q.orderBy("created_at", "desc").orderBy("id", "desc").limit(MAX_ATTACHMENTS_PER_PATIENT).execute();
  return rows.map((r) => toDetails(ctx, r));
}

export async function getAttachment(ctx: RepoContext, tenantId: string, id: string): Promise<AttachmentDetails | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return row ? toDetails(ctx, row) : null;
}

export class AttachmentIntegrityError extends Error {
  readonly code = "ATTACHMENT_INTEGRITY";
  constructor(message: string) {
    super(message);
    this.name = "AttachmentIntegrityError";
  }
}

/** The file's bytes, verified (every piece, the size and the SHA-256), or null when it is missing or unfinished. */
export async function getAttachmentFile(ctx: RepoContext, tenantId: string, id: string): Promise<{ details: AttachmentDetails; bytes: Buffer } | null> {
  const details = await getAttachment(ctx, tenantId, id);
  if (!details) return null;
  const parts: Buffer[] = [];
  for (let start = 0; start < details.chunkCount; start += CHUNKS_PER_BATCH) {
    const rows = await ctx.db
      .selectFrom(CH)
      .select(["id", "idx", "data_enc"])
      .where("tenant_id", "=", tenantId)
      .where("attachment_id", "=", id)
      .where("idx", ">=", start)
      .where("idx", "<", start + CHUNKS_PER_BATCH)
      .orderBy("idx")
      .execute();
    const expected = Math.min(CHUNKS_PER_BATCH, details.chunkCount - start);
    if (rows.length !== expected) return null;
    for (let i = 0; i < rows.length; i++) {
      if (num(rows[i].idx) !== start + i || !rows[i].data_enc) return null;
      const b64 = decryptField(ctx, tenantId, CH, "data_enc", rows[i].id, rows[i].data_enc);
      const piece = Buffer.from(b64 ?? "", "base64");
      if (piece.length > ATTACHMENT_CHUNK_BYTES) throw new AttachmentIntegrityError("A stored piece of the file is larger than allowed.");
      parts.push(piece);
    }
  }
  const bytes = Buffer.concat(parts);
  if (bytes.length !== details.sizeBytes) throw new AttachmentIntegrityError("The stored file's size does not match its record.");
  if (createHash("sha256").update(bytes).digest("hex") !== details.sha256) throw new AttachmentIntegrityError("The stored file does not match its fingerprint.");
  return { details, bytes };
}

/** Records a download in the patient's history. */
export async function recordAttachmentDownload(ctx: RepoContext, tenantId: string, id: string, actor: PmsActor): Promise<void> {
  await pmsAudit(ctx, tenantId, actor, { action: "pms.attachment.download", targetType: "pms_attachment", targetId: id });
}

/** Withdraws a file (hidden from the record, kept). */
export async function withdrawAttachment(ctx: RepoContext, tenantId: string, id: string, reason: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "attachment id");
  const text = String(reason ?? "").trim();
  if (!text) throw new RepoInputError("Give the reason.");
  if (text.length > 500) throw new RepoInputError("The reason can be at most 500 characters.");
  const at = nowIso(ctx);
  const reasonEnc = encryptField(ctx, tenantId, T, "withdrawn_reason_enc", id, text) as string;
  return updateWithAudit(
    ctx,
    tenantId,
    actor,
    ctx.db
      .updateTable(T)
      .set({ status: "withdrawn", withdrawn_at: at, withdrawn_by: actor.userId, withdrawn_reason_enc: reasonEnc, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("status", "=", "active"),
    { action: "pms.attachment.withdraw", targetType: "pms_attachment", targetId: id },
    ctx.db.selectFrom(T).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("status", "=", "withdrawn").where("withdrawn_reason_enc", "=", reasonEnc),
  );
}
