/**
 * `forms` – referrer form maps (FormDefinition JSON, encrypted), per tenant, with optimistic concurrency:
 * every update names the revision it was based on; a stale one gets {reason: "conflict", currentRev}.
 */
import type { Selectable } from "kysely";
import { isUniqueViolation } from "../db/errors";
import type { FormsTable } from "../db/schema";
import {
  RepoInputError,
  assertId,
  assertSha256,
  assertTenantId,
  assertText,
  nowIso,
  optionalText,
  toInt,
  type RepoContext,
} from "./context";
import { MAX_PAYLOAD_BYTES, MAX_PAYLOAD_ROWS, type SaveResult } from "./versioned";

const TABLE = "forms";

export interface FormMeta {
  tenantId: string;
  id: string;
  rev: number;
  fileSha256: string;
  status: string;
  title: string;
  referrer: string | null;
  kind: string;
  sampleId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FormRecord<P = unknown> extends FormMeta {
  payload: P;
}

export interface FormInput<P = unknown> {
  id: string;
  fileSha256: string;
  status: string;
  title: string;
  referrer?: string | null;
  kind: string;
  sampleId?: string | null;
  payload: P;
}

const META_COLUMNS = [
  "tenant_id",
  "id",
  "rev",
  "file_sha256",
  "status",
  "title",
  "referrer",
  "kind",
  "sample_id",
  "created_at",
  "updated_at",
] as const;

type MetaRow = Pick<Selectable<FormsTable>, (typeof META_COLUMNS)[number]>;

function toMeta(row: MetaRow): FormMeta {
  return {
    tenantId: row.tenant_id,
    id: row.id,
    rev: toInt(row.rev),
    fileSha256: row.file_sha256,
    status: row.status,
    title: row.title,
    referrer: row.referrer,
    kind: row.kind,
    sampleId: row.sample_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function encryptPayload(ctx: RepoContext, tenantId: string, id: string, payload: unknown): string {
  const json = JSON.stringify(payload);
  if (json === undefined) throw new RepoInputError("Form payload is not JSON-serialisable.");
  if (Buffer.byteLength(json, "utf8") > MAX_PAYLOAD_BYTES) throw new RepoInputError("Form payload is too large.");
  return ctx.cipher.encrypt(json, { tenantId, table: TABLE, rowId: id });
}

function decryptPayload<P>(ctx: RepoContext, tenantId: string, id: string, payloadEnc: string): P {
  return JSON.parse(ctx.cipher.decryptString(payloadEnc, { tenantId, table: TABLE, rowId: id })) as P;
}

function validate(input: FormInput) {
  return {
    id: assertId(input.id, "Form id"),
    file_sha256: assertSha256(input.fileSha256),
    status: assertText(input.status, "Form status", 32),
    title: assertText(input.title, "Form title", 300),
    referrer: optionalText(input.referrer, "Form referrer", 300),
    kind: assertText(input.kind, "Form kind", 32),
    sample_id: optionalText(input.sampleId, "Form sample id", 128),
  };
}

async function currentRev(ctx: RepoContext, tenantId: string, id: string): Promise<number | null> {
  const row = await ctx.db
    .selectFrom("forms")
    .select("rev")
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .executeTakeFirst();
  return row ? toInt(row.rev) : null;
}

export async function createForm<P>(ctx: RepoContext, tenantId: string, input: FormInput<P>): Promise<SaveResult> {
  assertTenantId(tenantId);
  const fields = validate(input);
  const at = nowIso(ctx);
  try {
    await ctx.db
      .insertInto("forms")
      .values({
        tenant_id: tenantId,
        ...fields,
        rev: 1,
        payload_enc: encryptPayload(ctx, tenantId, fields.id, input.payload),
        created_at: at,
        updated_at: at,
      })
      .execute();
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const rev = await currentRev(ctx, tenantId, fields.id);
    return { ok: false, reason: "exists", currentRev: rev ?? 0 };
  }
  return { ok: true, rev: 1, updatedAt: at };
}

export async function updateForm<P>(
  ctx: RepoContext,
  tenantId: string,
  input: FormInput<P>,
  expectedRev: number,
): Promise<SaveResult> {
  assertTenantId(tenantId);
  const fields = validate(input);
  if (!Number.isInteger(expectedRev) || expectedRev < 1) throw new RepoInputError("expectedRev must be a positive integer.");
  const at = nowIso(ctx);
  const row = await ctx.db
    .updateTable("forms")
    .set((eb) => ({
      rev: eb("rev", "+", 1),
      file_sha256: fields.file_sha256,
      status: fields.status,
      title: fields.title,
      referrer: fields.referrer,
      kind: fields.kind,
      sample_id: fields.sample_id,
      payload_enc: encryptPayload(ctx, tenantId, fields.id, input.payload),
      updated_at: at,
    }))
    .where("tenant_id", "=", tenantId)
    .where("id", "=", fields.id)
    .where("rev", "=", expectedRev)
    .returning(["rev"])
    .executeTakeFirst();
  if (row) return { ok: true, rev: toInt(row.rev), updatedAt: at };
  const rev = await currentRev(ctx, tenantId, fields.id);
  return rev === null ? { ok: false, reason: "not_found" } : { ok: false, reason: "conflict", currentRev: rev };
}

export async function getForm<P = unknown>(ctx: RepoContext, tenantId: string, id: string): Promise<FormRecord<P> | null> {
  assertTenantId(tenantId);
  assertId(id, "Form id");
  const row = await ctx.db
    .selectFrom("forms")
    .select([...META_COLUMNS, "payload_enc"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) return null;
  return { ...toMeta(row), payload: decryptPayload<P>(ctx, tenantId, row.id, row.payload_enc) };
}

/**
 * The tenant's most recently updated forms WITH payloads – at most MAX_PAYLOAD_ROWS (default and cap). For the
 * whole library, list the metadata (listFormMeta) and read payloads by id (getForm).
 */
export async function listForms<P = unknown>(ctx: RepoContext, tenantId: string, options: { limit?: number } = {}): Promise<FormRecord<P>[]> {
  assertTenantId(tenantId);
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? MAX_PAYLOAD_ROWS)), MAX_PAYLOAD_ROWS);
  const rows = await ctx.db
    .selectFrom("forms")
    .select([...META_COLUMNS, "payload_enc"])
    .where("tenant_id", "=", tenantId)
    .orderBy("updated_at", "desc")
    .orderBy("id")
    .limit(limit)
    .execute();
  return rows.map((row) => ({ ...toMeta(row), payload: decryptPayload<P>(ctx, tenantId, row.id, row.payload_enc) }));
}

/** Metadata only (no decryption). */
export async function listFormMeta(ctx: RepoContext, tenantId: string): Promise<FormMeta[]> {
  assertTenantId(tenantId);
  const rows = await ctx.db
    .selectFrom("forms")
    .select([...META_COLUMNS])
    .where("tenant_id", "=", tenantId)
    .orderBy("updated_at", "desc")
    .orderBy("id")
    .execute();
  return rows.map(toMeta);
}

export async function deleteForm(ctx: RepoContext, tenantId: string, id: string): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "Form id");
  const result = await ctx.db.deleteFrom("forms").where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return Number(result.numDeletedRows) > 0;
}
