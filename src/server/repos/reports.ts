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
import { MAX_PAYLOAD_BYTES, type SaveResult } from "./versioned";

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
  /** ISO timestamp after which the retention job deletes the report (null = keep). */
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
    delete_after: input.deleteAfter ? assertIso(input.deleteAfter, "deleteAfter") : null,
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

/** delete_after = now + retention days (clinic_profile.retention_days). */
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
      delete_after: fields.delete_after,
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

export interface ListReportsOptions {
  /** Default 200, at most 1000. */
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
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 200)), 1000);
  const withPayload = options.withPayload ?? true;
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
