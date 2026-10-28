/**
 * `forms` – referrer form maps (FormDefinition JSON, encrypted), per tenant, with optimistic concurrency:
 * every update names the revision it was based on; a stale one gets {reason: "conflict", currentRev}.
 * replaceForms (10/2026, admin:load-forms --replace-proposed): old maps out, one new map in, in one atomic batch that
 * re-checks every reason to keep an old map.
 */
import { sql, type Selectable } from "kysely";
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
import { auditInsertWhenExists, jsonTextNamesId, type AuditEntry, type AuditEntryInput } from "./audit";
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

/**
 * At most this many forms are replaced by one new form. The guarded insert of replaceForms binds 17 + 8n parameters
 * (97 at 10), and D1 – and the data gateway (workers/data-gateway/src/validate.ts LIMITS.maxParams) – take at most
 * 100 per statement.
 */
export const MAX_REPLACED_FORMS = 10;

export interface ReplaceFormsInput<P = unknown> {
  /** The forms to remove: each only while it still has exactly this revision and status. */
  replace: { id: string; rev: number; status: string }[];
  /**
   * How many audit rows targeted or named any of these forms when the replace was planned (the union of
   * repos/audit.ts listAuditAbout for each id): the replace goes ahead only while that is still the number.
   */
  auditRowsAbout: number;
  /** The new form (created at revision 1, under its own new id). Its file must already be stored. */
  form: FormInput<P>;
  /** Stored files (SHA-256) to delete with their chunks – each only once no form of the clinic refers to it. */
  dropUnusedFiles?: string[];
  /** Audit rows written in the same batch – only when the forms really were replaced. */
  audit?: AuditEntryInput[];
}

export type ReplaceFormsResult =
  | { ok: true; rev: 1; updatedAt: string; removed: number; filesDeleted: number; audit: AuditEntry[] }
  | { ok: false; reason: "changed" };

/**
 * Replaces forms of the tenant by ONE new form, in one atomic batch (runBatch: one D1 batch, a transaction on
 * Postgres and SQLite; no reads between the statements, so every condition is in the SQL):
 * 1. the new form is inserted (INSERT … SELECT … WHERE) only while EVERY old form still has its expected revision and
 *    status, no report of the tenant uses one (reports.form_id, or template_id "form:<id>"), the tenant's referrer
 *    links name none, the audit trail about them still holds exactly `auditRowsAbout` rows (nothing confirmed, used
 *    or changed since the plan), and the new form's file is stored;
 * 2. the old forms are deleted – only when the new form is there, and each only at its expected revision and status;
 * 3. the new form is deleted again if an old form is still there or the audit trail about them grew (cannot happen
 *    when the batch runs as one serial transaction – D1, SQLite; a safety net for a concurrent Postgres transaction);
 * 4. the `audit` rows are inserted when the new form is there;
 * 5. each file in dropUnusedFiles (its chunks, then its record) is deleted when the new form is there and no form of
 *    the tenant refers to the file.
 * So either the old forms are gone, the new one is stored and audited, or nothing at all changed ({ok: false,
 * reason: "changed"} – e.g. a concurrent run replaced the forms first, or the clinic deleted, confirmed or used one
 * meanwhile). Files that are still referred to are never touched.
 */
export async function replaceForms<P>(ctx: RepoContext, tenantId: string, input: ReplaceFormsInput<P>): Promise<ReplaceFormsResult> {
  assertTenantId(tenantId);
  const fields = validate(input.form);
  if (!Array.isArray(input.replace) || input.replace.length === 0 || input.replace.length > MAX_REPLACED_FORMS) {
    throw new RepoInputError(`Name between 1 and ${MAX_REPLACED_FORMS} forms to replace.`);
  }
  const old = input.replace.map((o) => {
    if (!Number.isInteger(o.rev) || o.rev < 1) throw new RepoInputError("The revision of a form to replace must be a positive integer.");
    return { id: assertId(o.id, "Form id"), rev: o.rev, status: assertText(o.status, "Form status", 32) };
  });
  const oldIds = Array.from(new Set(old.map((o) => o.id)));
  if (oldIds.length !== old.length) throw new RepoInputError("A form to replace is named twice.");
  if (oldIds.includes(fields.id)) throw new RepoInputError("The new form needs an id of its own.");
  if (!Number.isInteger(input.auditRowsAbout) || input.auditRowsAbout < 0) throw new RepoInputError("auditRowsAbout must be a whole number.");
  const files = Array.from(new Set((input.dropUnusedFiles ?? []).map((sha) => assertSha256(sha)))).filter((sha) => sha !== fields.file_sha256);
  const at = nowIso(ctx);
  // Whole numbers checked above go in as literals (sql.lit) to keep the guarded insert inside D1's 100 parameters.
  const expectedAudit = sql.lit(input.auditRowsAbout);
  const auditAbout = () =>
    ctx.db
      .selectFrom("audit_log as a")
      .select((c) => c.fn.countAll<number>().as("n"))
      .where("a.tenant_id", "=", tenantId)
      .where((w) => w.or([w("a.target_id", "in", oldIds), ...oldIds.map((id) => jsonTextNamesId("a.detail_json", id))]));
  const newFormStored = () => ctx.db.selectFrom("forms as nf").select("nf.id").where("nf.tenant_id", "=", tenantId).where("nf.id", "=", fields.id);
  const unreferenced = (table: "form_files" | "form_file_chunks", sha: string) =>
    ctx.db
      .deleteFrom(table)
      .where("tenant_id", "=", tenantId)
      .where("sha256", "=", sha)
      .where((eb) => eb.not(eb.exists(eb.selectFrom("forms as f").select("f.id").where("f.tenant_id", "=", tenantId).where("f.file_sha256", "=", sha))))
      .where((eb) => eb.exists(newFormStored()));

  const insertNew = ctx.db
    .insertInto("forms")
    .columns(["tenant_id", "id", "rev", "file_sha256", "status", "title", "referrer", "kind", "sample_id", "payload_enc", "created_at", "updated_at"])
    .expression(
      ctx.db
        .selectNoFrom((eb) => [
          eb.val(tenantId).as("tenant_id"),
          eb.val(fields.id).as("id"),
          sql.lit(1).as("rev"),
          eb.val(fields.file_sha256).as("file_sha256"),
          eb.val(fields.status).as("status"),
          eb.val(fields.title).as("title"),
          eb.val(fields.referrer).as("referrer"),
          eb.val(fields.kind).as("kind"),
          eb.val(fields.sample_id).as("sample_id"),
          eb.val(encryptPayload(ctx, tenantId, fields.id, input.form.payload)).as("payload_enc"),
          eb.val(at).as("created_at"),
          eb.val(at).as("updated_at"),
        ])
        .where((eb) =>
          eb.and([
            eb(
              ctx.db
                .selectFrom("forms as f")
                .select((c) => c.fn.countAll<number>().as("n"))
                .where("f.tenant_id", "=", tenantId)
                .where((w) => w.or(old.map((o) => w.and([w("f.id", "=", o.id), w("f.rev", "=", o.rev), w("f.status", "=", o.status)])))),
              "=",
              sql.lit(old.length),
            ),
            eb.not(
              eb.exists(
                ctx.db
                  .selectFrom("reports as r")
                  .select("r.id")
                  .where("r.tenant_id", "=", tenantId)
                  .where((w) => w.or([w("r.form_id", "in", oldIds), w("r.template_id", "in", oldIds.map((id) => `${FORM_TEMPLATE_PREFIX}${id}`))])),
              ),
            ),
            eb.not(
              eb.exists(
                ctx.db
                  .selectFrom("tenant_settings as s")
                  .select("s.tenant_id")
                  .where("s.tenant_id", "=", tenantId)
                  .where((w) => w.or(oldIds.map((id) => jsonTextNamesId("s.referrer_links_json", id)))),
              ),
            ),
            eb(auditAbout(), "=", expectedAudit),
            eb.exists(ctx.db.selectFrom("form_files as ff").select("ff.sha256").where("ff.tenant_id", "=", tenantId).where("ff.sha256", "=", fields.file_sha256)),
          ]),
        ),
    );
  const deleteOld = ctx.db
    .deleteFrom("forms")
    .where("tenant_id", "=", tenantId)
    .where((w) => w.or(old.map((o) => w.and([w("id", "=", o.id), w("rev", "=", o.rev), w("status", "=", o.status)]))))
    .where((w) => w.exists(newFormStored()));
  const undoIfIncomplete = ctx.db
    .deleteFrom("forms")
    .where("tenant_id", "=", tenantId)
    .where("id", "=", fields.id)
    .where((w) =>
      w.or([
        w.exists(ctx.db.selectFrom("forms as f").select("f.id").where("f.tenant_id", "=", tenantId).where("f.id", "in", oldIds)),
        w(auditAbout(), "<>", expectedAudit),
      ]),
    );
  const audit = (input.audit ?? []).map((entry) => auditInsertWhenExists(ctx, tenantId, entry, newFormStored()));
  const queries: BatchQuery[] = [
    insertNew,
    deleteOld,
    undoIfIncomplete,
    ...audit.map((a) => a.query),
    ...files.flatMap((sha) => [unreferenced("form_file_chunks", sha), unreferenced("form_files", sha)]),
  ];
  const results = await runBatch(ctx.db, queries);
  const affected = (i: number) => Number(results[i]?.numAffectedRows ?? 0);
  if (affected(0) === 0 || affected(2) > 0) return { ok: false, reason: "changed" };
  // Step 1 saw every old form at its revision and status, and step 2 ran in the same serial batch: all of them went.
  if (affected(1) !== old.length) throw new Error(`replaceForms: ${affected(1)} of ${old.length} forms were removed – the batch did not run as one transaction.`);
  const fileBase = 3 + audit.length;
  let filesDeleted = 0;
  for (let i = 0; i < files.length; i++) filesDeleted += affected(fileBase + i * 2 + 1) > 0 ? 1 : 0;
  return { ok: true, rev: 1, updatedAt: at, removed: old.length, filesDeleted, audit: audit.map((a) => a.entry) };
}

export async function deleteForm(ctx: RepoContext, tenantId: string, id: string): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "Form id");
  const result = await ctx.db.deleteFrom("forms").where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return Number(result.numDeletedRows) > 0;
}
