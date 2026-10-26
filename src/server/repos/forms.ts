/**
 * `forms` – referrer form maps (FormDefinition JSON, encrypted), per tenant, with optimistic concurrency:
 * every update names the revision it was based on; a stale one gets {reason: "conflict", currentRev}.
 * replaceForms (10/2026, admin:load-forms --replace-proposed): old maps out, one new map in, in one atomic batch.
 */
import type { Selectable } from "kysely";
import { runBatch, type BatchQuery } from "../db/batch";
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

/** How a report names the form it completes: template_id "form:<formId>" (core/forms.ts formTemplateId). */
const FORM_TEMPLATE_PREFIX = "form:";

export interface ReplaceFormsInput<P = unknown> {
  /** The forms to remove: each only while it still has exactly this revision and status. */
  replace: { id: string; rev: number; status: string }[];
  /** The new form (created at revision 1, under its own new id). */
  form: FormInput<P>;
  /** Stored files (SHA-256) to delete with their chunks – each only once no form of the clinic refers to it. */
  dropUnusedFiles?: string[];
}

export type ReplaceFormsResult =
  | { ok: true; rev: 1; updatedAt: string; removed: number; filesDeleted: number }
  | { ok: false; reason: "changed" };

/**
 * Replaces forms of the tenant by ONE new form, in one atomic batch (runBatch: one D1 batch, a transaction on
 * Postgres and SQLite; no reads between the statements, so every condition is in the SQL):
 * 1. the old forms are deleted – all of them, and only if every one still has its expected revision and status
 *    and no report of the tenant uses any of them (reports.form_id, or template_id "form:<id>");
 * 2. the new form is inserted;
 * 3. if an old form is still there (step 1 changed nothing), the new form is deleted again;
 * 4. each file in dropUnusedFiles (its chunks, then its record) is deleted when no form of the tenant refers to it.
 * So either the old forms are gone and the new one is stored, or the tenant's forms are exactly as before
 * ({ok: false, reason: "changed"}). Files that are still referred to are never touched. (Old forms deleted
 * meanwhile by someone else leave nothing to replace: the new form is stored, `removed` says how many went.)
 */
export async function replaceForms<P>(ctx: RepoContext, tenantId: string, input: ReplaceFormsInput<P>): Promise<ReplaceFormsResult> {
  assertTenantId(tenantId);
  const fields = validate(input.form);
  if (!Array.isArray(input.replace) || input.replace.length === 0 || input.replace.length > 20) {
    throw new RepoInputError("Name between 1 and 20 forms to replace.");
  }
  const old = input.replace.map((o) => {
    if (!Number.isInteger(o.rev) || o.rev < 1) throw new RepoInputError("The revision of a form to replace must be a positive integer.");
    return { id: assertId(o.id, "Form id"), rev: o.rev, status: assertText(o.status, "Form status", 32) };
  });
  const oldIds = Array.from(new Set(old.map((o) => o.id)));
  if (oldIds.length !== old.length) throw new RepoInputError("A form to replace is named twice.");
  if (oldIds.includes(fields.id)) throw new RepoInputError("The new form needs an id of its own.");
  const files = Array.from(new Set((input.dropUnusedFiles ?? []).map((sha) => assertSha256(sha)))).filter((sha) => sha !== fields.file_sha256);
  const at = nowIso(ctx);
  const unreferenced = (table: "form_files" | "form_file_chunks", sha: string) =>
    ctx.db
      .deleteFrom(table)
      .where("tenant_id", "=", tenantId)
      .where("sha256", "=", sha)
      .where((eb) => eb.not(eb.exists(eb.selectFrom("forms as f").select("f.id").where("f.tenant_id", "=", tenantId).where("f.file_sha256", "=", sha))));
  const queries: BatchQuery[] = [
    ctx.db
      .deleteFrom("forms")
      .where("tenant_id", "=", tenantId)
      .where("id", "in", oldIds)
      .where((eb) =>
        eb(
          eb
            .selectFrom("forms as f")
            .select((c) => c.fn.countAll<number>().as("n"))
            .where("f.tenant_id", "=", tenantId)
            .where((w) => w.or(old.map((o) => w.and([w("f.id", "=", o.id), w("f.rev", "=", o.rev), w("f.status", "=", o.status)])))),
          "=",
          old.length,
        ),
      )
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom("reports")
              .select("reports.id")
              .where("reports.tenant_id", "=", tenantId)
              .where((w) => w.or([w("reports.form_id", "in", oldIds), w("reports.template_id", "in", oldIds.map((id) => `${FORM_TEMPLATE_PREFIX}${id}`))])),
          ),
        ),
      ),
    ctx.db.insertInto("forms").values({
      tenant_id: tenantId,
      ...fields,
      rev: 1,
      payload_enc: encryptPayload(ctx, tenantId, fields.id, input.form.payload),
      created_at: at,
      updated_at: at,
    }),
    ctx.db
      .deleteFrom("forms")
      .where("tenant_id", "=", tenantId)
      .where("id", "=", fields.id)
      .where((eb) => eb.exists(eb.selectFrom("forms as f").select("f.id").where("f.tenant_id", "=", tenantId).where("f.id", "in", oldIds))),
    ...files.flatMap((sha) => [unreferenced("form_file_chunks", sha), unreferenced("form_files", sha)]),
  ];
  const results = await runBatch(ctx.db, queries);
  if (Number(results[2]?.numAffectedRows ?? 0) > 0) return { ok: false, reason: "changed" };
  let filesDeleted = 0;
  for (let i = 0; i < files.length; i++) filesDeleted += Number(results[4 + i * 2]?.numAffectedRows ?? 0) > 0 ? 1 : 0;
  return { ok: true, rev: 1, updatedAt: at, removed: Number(results[0]?.numAffectedRows ?? 0), filesDeleted };
}

export async function deleteForm(ctx: RepoContext, tenantId: string, id: string): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "Form id");
  const result = await ctx.db.deleteFrom("forms").where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return Number(result.numDeletedRows) > 0;
}
