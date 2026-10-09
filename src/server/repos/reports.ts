/**
 * `reports` – reports (Report JSON, encrypted), per tenant, with optimistic concurrency:
 * `UPDATE … SET rev = rev + 1 … WHERE tenant_id = ? AND id = ? AND rev = ?`; a stale revision returns
 * {reason: "conflict", currentRev} (the API maps it to 409 and the Studio refetches).
 */
import type { Selectable } from "kysely";
import { isUniqueViolation } from "../db/errors";
import type { ReportsTable } from "../db/schema";
import {
  RepoInputError,
  assertId,
  assertIso,
  assertTenantId,
  assertText,
  nowIso,
  toInt,
  type RepoContext,
} from "./context";
import { MAX_PAYLOAD_BYTES, MAX_PAYLOAD_ROWS, type SaveResult } from "./versioned";

const TABLE = "reports";

export interface ReportMeta {
  tenantId: string;
  id: string;
  rev: number;
  status: string;
  formId: string | null;
  templateId: string;
  createdAt: string;
  updatedAt: string;
  deleteAfter: string | null;
}

export interface ReportRecord<P = unknown> extends ReportMeta {
  payload: P;
}

export interface ReportInput<P = unknown> {
  id: string;
  status: string;
  formId?: string | null;
  templateId: string;
  /**
   * An explicit, earlier deletion deadline (ISO) on top of the clinic's retention period (see
   * maintenance.ts). Create: omitted/null = none. Update: OMITTED = leave the stored value unchanged,
   * null = clear it, a timestamp = set it.
   */
  deleteAfter?: string | null;
  payload: P;
}

const META_COLUMNS = [
  "tenant_id",
  "id",
  "rev",
  "status",
  "form_id",
  "template_id",
  "created_at",
  "updated_at",
  "delete_after",
] as const;

type MetaRow = Pick<Selectable<ReportsTable>, (typeof META_COLUMNS)[number]>;

function toMeta(row: MetaRow): ReportMeta {
  return {
    tenantId: row.tenant_id,
    id: row.id,
    rev: toInt(row.rev),
    status: row.status,
    formId: row.form_id,
    templateId: row.template_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deleteAfter: row.delete_after,
  };
}

function validate(input: ReportInput) {
  return {
    id: assertId(input.id, "Report id"),
    status: assertText(input.status, "Report status", 32),
    form_id: input.formId ? assertId(input.formId, "Form id") : null,
    template_id: assertText(input.templateId, "Template id", 160),
    /** undefined = not given (an update leaves the stored value alone). */
    delete_after: input.deleteAfter === undefined ? undefined : input.deleteAfter === null ? null : assertIso(input.deleteAfter, "deleteAfter"),
  };
}

function encryptPayload(ctx: RepoContext, tenantId: string, id: string, payload: unknown): string {
  const json = JSON.stringify(payload);
  if (json === undefined) throw new RepoInputError("Report payload is not JSON-serialisable.");
  if (Buffer.byteLength(json, "utf8") > MAX_PAYLOAD_BYTES) throw new RepoInputError("Report payload is too large.");
  return ctx.cipher.encrypt(json, { tenantId, table: TABLE, rowId: id });
}

function decryptPayload<P>(ctx: RepoContext, tenantId: string, id: string, payloadEnc: string): P {
  return JSON.parse(ctx.cipher.decryptString(payloadEnc, { tenantId, table: TABLE, rowId: id })) as P;
}

/** A deadline `retentionDays` after `fromIso` (e.g. for an explicit deleteAfter). */
export function retentionDeadline(fromIso: string, retentionDays: number): string {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) throw new RepoInputError("retentionDays must be a positive integer.");
  return new Date(Date.parse(fromIso) + retentionDays * 86_400_000).toISOString();
}

async function currentRev(ctx: RepoContext, tenantId: string, id: string): Promise<number | null> {
  const row = await ctx.db
    .selectFrom("reports")
    .select("rev")
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .executeTakeFirst();
  return row ? toInt(row.rev) : null;
}

export async function createReport<P>(ctx: RepoContext, tenantId: string, input: ReportInput<P>): Promise<SaveResult> {
  assertTenantId(tenantId);
  const fields = validate(input);
  const at = nowIso(ctx);
  try {
    await ctx.db
      .insertInto("reports")
      .values({
        tenant_id: tenantId,
        ...fields,
        delete_after: fields.delete_after ?? null,
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

export async function updateReport<P>(
  ctx: RepoContext,
  tenantId: string,
  input: ReportInput<P>,
  expectedRev: number,
): Promise<SaveResult> {
  assertTenantId(tenantId);
  const fields = validate(input);
  if (!Number.isInteger(expectedRev) || expectedRev < 1) throw new RepoInputError("expectedRev must be a positive integer.");
  const at = nowIso(ctx);
  const row = await ctx.db
    .updateTable("reports")
    .set((eb) => ({
      rev: eb("rev", "+", 1),
      status: fields.status,
      form_id: fields.form_id,
      template_id: fields.template_id,
      ...(fields.delete_after === undefined ? {} : { delete_after: fields.delete_after }),
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

export async function getReport<P = unknown>(ctx: RepoContext, tenantId: string, id: string): Promise<ReportRecord<P> | null> {
  assertTenantId(tenantId);
  assertId(id, "Report id");
  const row = await ctx.db
    .selectFrom("reports")
    .select([...META_COLUMNS, "payload_enc"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) return null;
  return { ...toMeta(row), payload: decryptPayload<P>(ctx, tenantId, row.id, row.payload_enc) };
}

/** One report's metadata (no decryption) – e.g. its status before an update. */
export async function getReportMeta(ctx: RepoContext, tenantId: string, id: string): Promise<ReportMeta | null> {
  assertTenantId(tenantId);
  assertId(id, "Report id");
  const row = await ctx.db
    .selectFrom("reports")
    .select([...META_COLUMNS])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .executeTakeFirst();
  return row ? toMeta(row) : null;
}

export interface ListReportsOptions {
  /**
   * Metadata only: default 200, at most 1000. With payloads: default and at most MAX_PAYLOAD_ROWS (20) – on D1
   * every row travels in one gateway response; read further payloads by id (getReport).
   */
  limit?: number;
  /** Include the decrypted payloads (default true). */
  withPayload?: boolean;
}

/** The tenant's reports, most recently updated first. */
export async function listReports<P = unknown>(
  ctx: RepoContext,
  tenantId: string,
  options: ListReportsOptions = {},
): Promise<(ReportMeta & { payload?: P })[]> {
  assertTenantId(tenantId);
  const withPayload = options.withPayload ?? true;
  const max = withPayload ? MAX_PAYLOAD_ROWS : 1000;
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? (withPayload ? MAX_PAYLOAD_ROWS : 200))), max);
  const base = ctx.db
    .selectFrom("reports")
    .where("tenant_id", "=", tenantId)
    .orderBy("updated_at", "desc")
    .orderBy("id")
    .limit(limit);
  if (!withPayload) return (await base.select([...META_COLUMNS]).execute()).map(toMeta);
  const rows = await base.select([...META_COLUMNS, "payload_enc"]).execute();
  return rows.map((row) => ({ ...toMeta(row), payload: decryptPayload<P>(ctx, tenantId, row.id, row.payload_enc) }));
}

export async function deleteReport(ctx: RepoContext, tenantId: string, id: string): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "Report id");
  const result = await ctx.db.deleteFrom("reports").where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return Number(result.numDeletedRows) > 0;
}
