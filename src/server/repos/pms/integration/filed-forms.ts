/**
 * `pms_filed_forms` + `pms_filed_form_parts` – completed, approved referrer forms filed back to the patient's
 * record by ClinForms (the native connector's write-back). Clinical records: never deleted by the app.
 *
 * - The file is stored in parts of FILED_PART_BYTES; each part is the base64 of its bytes, AES-GCM encrypted with
 *   AAD "<tenant>:pms_filed_form_parts.data_enc:<part id>" (base64 inside the envelope so the offboarding export,
 *   which decrypts every _enc column as text, keeps the file exactly).
 * - The metadata row is written first with complete = 0 and the parts follow in batches of two (each request stays
 *   well inside the gateway's limits); the last batch marks it complete with the audit row. Lists show complete files
 *   only, and a read checks the size and the SHA-256 of the reassembled bytes – a partial or altered file is never
 *   returned. Filing the same file for the same approval again returns the record already there (or completes it).
 * - The file name is encrypted (it usually names the patient); the title (form and referrer) is plain for lists.
 */
import { createHash } from "node:crypto";
import type { Selectable } from "kysely";
import { INTEGRATION_ID_PREFIXES as P } from "../../../../modules/pms/integration/ids";
import { FiledFormInputSchema, MAX_FILED_FORM_BYTES, type FiledFormInput } from "../../../../modules/pms/integration/schemas";
import type { PmsActor } from "../../../../modules/pms/core/types";
import { runBatch, type BatchQuery } from "../../../db/batch";
import type { PmsFiledFormsTable } from "../../../db/pms-schema/integration";
import { RepoInputError, assertId, assertTenantId, decryptField, encryptField, isOn, nowIso, num, parseInput, pmsAuditQuery, pmsId, translateDbError, type RepoContext } from "../context";

const T = "pms_filed_forms";
const PT = "pms_filed_form_parts";
export const FILED_PART_BYTES = 384 * 1024;
const PARTS_PER_BATCH = 2;

export class FiledFormIntegrityError extends Error {
  readonly code = "FILE_INTEGRITY";
  constructor(message: string) {
    super(message);
    this.name = "FiledFormIntegrityError";
  }
}

export interface FiledFormSummary {
  tenantId: string;
  id: string;
  patientId: string;
  caseId: string;
  title: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  reportId: string;
  signerName: string | null;
  signerRegistration: string | null;
  signedAt: string | null;
  filedBy: string | null;
  filedAt: string;
}

export interface FiledForm extends FiledFormSummary {
  /** Decrypted. */
  fileName: string;
  partCount: number;
  receipt: Record<string, unknown>;
}

type Row = Selectable<PmsFiledFormsTable>;

function toSummary(r: Row): FiledFormSummary {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    patientId: r.patient_id,
    caseId: r.case_id,
    title: r.title,
    mimeType: r.mime_type,
    sizeBytes: num(r.size_bytes),
    sha256: r.sha256,
    reportId: r.report_id,
    signerName: r.signer_name,
    signerRegistration: r.signer_registration,
    signedAt: r.signed_at,
    filedBy: r.filed_by,
    filedAt: r.filed_at,
  };
}

function toForm(ctx: RepoContext, r: Row): FiledForm {
  let receipt: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(r.receipt_json) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) receipt = parsed as Record<string, unknown>;
  } catch {
    receipt = {};
  }
  return {
    ...toSummary(r),
    fileName: decryptField(ctx, r.tenant_id, T, "file_name_enc", r.id, r.file_name_enc) ?? "form",
    partCount: num(r.part_count),
    receipt,
  };
}

function looksLike(mimeType: string, bytes: Uint8Array): boolean {
  if (mimeType === "application/pdf") return bytes.length > 5 && Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function partValues(ctx: RepoContext, tenantId: string, formId: string, bytes: Uint8Array, at: string) {
  const parts: { tenant_id: string; id: string; filed_form_id: string; idx: number; data_enc: string; created_at: string }[] = [];
  for (let idx = 0, offset = 0; offset < bytes.length; idx++, offset += FILED_PART_BYTES) {
    const id = pmsId(P.filedFormPart, ctx);
    const chunk = Buffer.from(bytes.subarray(offset, Math.min(bytes.length, offset + FILED_PART_BYTES))).toString("base64");
    parts.push({ tenant_id: tenantId, id, filed_form_id: formId, idx, data_enc: encryptField(ctx, tenantId, PT, "data_enc", id, chunk) as string, created_at: at });
  }
  return parts;
}

/**
 * Files a completed form to a patient's case. `bytes` must match `input.sha256` and be a real PDF or Word file.
 * Returns the record and whether it was new (false: this approval's file was already filed).
 */
export async function fileReferrerForm(ctx: RepoContext, tenantId: string, input: FiledFormInput, bytes: Uint8Array, actor: PmsActor): Promise<{ form: FiledForm; created: boolean }> {
  assertTenantId(tenantId);
  const d = parseInput(FiledFormInputSchema, input, "Filed form");
  if (bytes.length === 0 || bytes.length > MAX_FILED_FORM_BYTES) throw new RepoInputError("The file is empty or larger than 10 MB.");
  if (createHash("sha256").update(bytes).digest("hex") !== d.sha256) throw new RepoInputError("The file does not match its checksum.");
  if (!looksLike(d.mimeType, bytes)) throw new RepoInputError("The file is not the type it says it is.");
  const existing = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("report_id", "=", d.reportId).where("sha256", "=", d.sha256).executeTakeFirst();
  if (existing && (existing.patient_id !== d.patientId || existing.case_id !== d.caseId)) throw new RepoInputError("This approved form is already filed to another record.");
  if (existing && isOn(existing.complete)) return { form: toForm(ctx, existing), created: false };
  const at = nowIso(ctx);
  const id = existing?.id ?? pmsId(P.filedForm, ctx);
  const parts = partValues(ctx, tenantId, id, bytes, at);
  const queries: BatchQuery[][] = [];
  for (let i = 0; i < parts.length; i += PARTS_PER_BATCH) {
    // Re-filing an incomplete record replaces any part already there (same form, same index).
    queries.push(
      parts.slice(i, i + PARTS_PER_BATCH).map((p) =>
        ctx.db
          .insertInto(PT)
          .values(p)
          .onConflict((oc) => oc.columns(["tenant_id", "filed_form_id", "idx"]).doUpdateSet({ id: p.id, data_enc: p.data_enc, created_at: p.created_at })),
      ),
    );
  }
  if (!existing) {
    const meta = ctx.db.insertInto(T).values({
      tenant_id: tenantId,
      id,
      patient_id: d.patientId,
      case_id: d.caseId,
      title: d.title,
      file_name_enc: encryptField(ctx, tenantId, T, "file_name_enc", id, d.fileName) as string,
      mime_type: d.mimeType,
      size_bytes: bytes.length,
      sha256: d.sha256,
      part_count: parts.length,
      complete: 0,
      report_id: d.reportId,
      receipt_json: JSON.stringify(d.receipt),
      signer_name: d.signerName ?? null,
      signer_registration: d.signerRegistration ?? null,
      signed_at: d.signedAt ?? null,
      filed_by: actor.userId,
      filed_at: at,
      created_at: at,
      updated_at: at,
    });
    queries[0] = [meta, ...queries[0]];
  }
  const finish: BatchQuery[] = [
    ctx.db.updateTable(T).set({ complete: 1, part_count: parts.length, updated_at: at }).where("tenant_id", "=", tenantId).where("id", "=", id),
    pmsAuditQuery(ctx, tenantId, actor, {
      action: "pms.filed_form.create",
      targetType: "pms_filed_form",
      targetId: id,
      detail: { caseId: d.caseId, reportId: d.reportId, mimeType: d.mimeType, bytes: bytes.length, parts: parts.length },
    }),
  ];
  queries[queries.length - 1] = [...queries[queries.length - 1], ...finish];
  try {
    for (const q of queries) await runBatch(ctx.db, q);
  } catch (err) {
    throw translateDbError(err, { unique: "This approved form is already filed.", foreignKey: "The case does not exist in this clinic (or it is another patient's)." });
  }
  const row = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirstOrThrow();
  return { form: toForm(ctx, row), created: !existing };
}

/** A patient's (or one case's) filed forms, newest first – complete ones only, nothing decrypted. */
export async function listFiledForms(ctx: RepoContext, tenantId: string, by: { patientId: string } | { caseId: string }, limit = 200): Promise<FiledFormSummary[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("complete", "=", 1);
  q = "patientId" in by ? q.where("patient_id", "=", by.patientId) : q.where("case_id", "=", by.caseId);
  const rows = await q.orderBy("filed_at", "desc").orderBy("id", "desc").limit(Math.min(Math.max(1, limit), 500)).execute();
  return rows.map(toSummary);
}

export async function getFiledForm(ctx: RepoContext, tenantId: string, id: string): Promise<FiledForm | null> {
  assertTenantId(tenantId);
  assertId(id, "filed form id");
  const row = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).where("complete", "=", 1).executeTakeFirst();
  return row ? toForm(ctx, row) : null;
}

/** The filed file, reassembled and checked (size and SHA-256), or null when there is no such complete record. */
export async function readFiledFormFile(ctx: RepoContext, tenantId: string, id: string): Promise<{ form: FiledForm; bytes: Buffer } | null> {
  const form = await getFiledForm(ctx, tenantId, id);
  if (!form) return null;
  const parts = await ctx.db
    .selectFrom(PT)
    .select(["id", "idx", "data_enc"])
    .where("tenant_id", "=", tenantId)
    .where("filed_form_id", "=", id)
    .orderBy("idx")
    .limit(form.partCount + 1)
    .execute();
  if (parts.length !== form.partCount || parts.some((p, i) => num(p.idx) !== i)) throw new FiledFormIntegrityError("The filed form is incomplete.");
  const bytes = Buffer.concat(parts.map((p) => Buffer.from(decryptField(ctx, tenantId, PT, "data_enc", p.id, p.data_enc) ?? "", "base64")));
  if (bytes.length !== form.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== form.sha256) throw new FiledFormIntegrityError("The filed form does not match its checksum.");
  return { form, bytes };
}
