/**
 * Plumbing for the clinic-system repositories (src/server/repos/pms/*). The ClinForms rules apply
 * (../context.ts): the tenant is an explicit argument and appears in EVERY WHERE clause and key; timestamps come
 * from ctx.now(). On top of them (docs/clinic-system/contract.md §4):
 *
 * - every write takes the actor (who did it) and writes an audit row – inserts in the SAME atomic batch as the
 *   row (runBatch), updates right after a successful conditional update;
 * - free text is encrypted per field: column "<name>_enc", AAD "<tenantId>:<table>.<column>:<row id>", so a
 *   ciphertext cannot be moved to another column, row, table or clinic;
 * - ids are "<prefix>_<ULID>" (time-ordered);
 * - database constraint errors become RepoInputError with a plain message (forms show it).
 */
import type { BatchQuery } from "../../db/batch";
import { runBatch } from "../../db/batch";
import { classifyDbError } from "../../db/errors";
import { auditInsertQuery, appendAudit, type AuditEntryInput } from "../audit";
import { RepoInputError, assertId, assertTenantId, nowIso, ulid, type DbContext, type RepoContext } from "../context";
import type { PmsActor } from "../../../modules/pms/core/types";

export type { PmsActor } from "../../../modules/pms/core/types";

/** A new record id: "<prefix>_<ULID>". */
export function pmsId(prefix: string, ctx?: DbContext): string {
  const time = ctx?.now ? ctx.now().getTime() : Date.now();
  return `${prefix}_${ulid(time)}`;
}

export function assertActor(actor: PmsActor): PmsActor {
  if (!actor || typeof actor !== "object") throw new RepoInputError("Every clinic-system write needs the actor.");
  return {
    userId: actor.userId === null ? null : assertId(actor.userId, "actor.userId"),
    sessionId: actor.sessionId === null ? null : assertId(actor.sessionId, "actor.sessionId"),
  };
}

export type PmsAuditEntry = Omit<AuditEntryInput, "userId" | "sessionId">;

/** The audit INSERT for a write by `actor` (send it in the write's batch). */
export function pmsAuditQuery(ctx: DbContext, tenantId: string, actor: PmsActor, entry: PmsAuditEntry): BatchQuery {
  const who = assertActor(actor);
  return auditInsertQuery(ctx, tenantId, { ...entry, userId: who.userId, sessionId: who.sessionId }).query;
}

/** Writes the audit row now (after an update that changed something). */
export async function pmsAudit(ctx: DbContext, tenantId: string, actor: PmsActor, entry: PmsAuditEntry): Promise<void> {
  const who = assertActor(actor);
  await appendAudit(ctx, tenantId, { ...entry, userId: who.userId, sessionId: who.sessionId });
}

/** Runs the write(s) and the audit row as one atomic batch, translating constraint errors. */
export async function writeWithAudit(ctx: DbContext, queries: BatchQuery[], messages: ConstraintMessages = {}): Promise<void> {
  try {
    await runBatch(ctx.db, queries);
  } catch (err) {
    throw translateDbError(err, messages);
  }
}

export interface ConstraintMessages {
  unique?: string;
  foreignKey?: string;
  check?: string;
}

/** A database constraint error as a RepoInputError with a plain message; anything else unchanged. */
export function translateDbError(err: unknown, messages: ConstraintMessages = {}): unknown {
  const code = classifyDbError(err);
  if (code === "CONSTRAINT_UNIQUE") return new RepoInputError(messages.unique ?? "A record with these details already exists.");
  if (code === "CONSTRAINT_FOREIGN_KEY") return new RepoInputError(messages.foreignKey ?? "A linked record does not exist in this clinic.");
  if (code === "CONSTRAINT_CHECK") return new RepoInputError(messages.check ?? "A value is outside what is allowed.");
  return err;
}

/** Runs one statement, translating constraint errors. */
export async function guarded<T>(work: () => Promise<T>, messages: ConstraintMessages = {}): Promise<T> {
  try {
    return await work();
  } catch (err) {
    throw translateDbError(err, messages);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Field encryption
 * ----------------------------------------------------------------------------------------------*/

/** AAD table part of an encrypted column: "<table>.<column>". */
export function fieldAadTable(table: string, column: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(table) || !/^[a-z][a-z0-9_]*_enc$/.test(column)) throw new RepoInputError("Encrypted columns end in _enc.");
  return `${table}.${column}`;
}

export function encryptField(ctx: Pick<RepoContext, "cipher">, tenantId: string, table: string, column: string, rowId: string, text: string | null | undefined): string | null {
  if (text === null || text === undefined || text === "") return null;
  return ctx.cipher.encrypt(text, { tenantId: assertTenantId(tenantId), table: fieldAadTable(table, column), rowId });
}

export function decryptField(ctx: Pick<RepoContext, "cipher">, tenantId: string, table: string, column: string, rowId: string, enc: string | null): string | null {
  if (enc === null || enc === undefined || enc === "") return null;
  return ctx.cipher.decryptString(enc, { tenantId, table: fieldAadTable(table, column), rowId });
}

/* ------------------------------------------------------------------------------------------------
 * Small converters
 * ----------------------------------------------------------------------------------------------*/

export const b01 = (value: boolean): 0 | 1 => (value ? 1 : 0);

export function isOn(value: unknown): boolean {
  return value === 1 || value === true || value === "1";
}

export function num(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

export function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : num(value);
}

export function jsonLines(value: string[] | null | undefined): string | null {
  return Array.isArray(value) && value.length > 0 ? JSON.stringify(value) : null;
}

export function parseLines(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((l): l is string => typeof l === "string") : null;
  } catch {
    return null;
  }
}

/**
 * Copies the keys of a parsed patch that are present (not undefined) into a column map: patch key → column,
 * through an optional converter. Returns the changed field names (for the audit detail – names only).
 */
export function patchColumns<P extends Record<string, unknown>>(
  patch: P,
  mapping: { [K in keyof P]?: string | [string, (value: Exclude<P[K], undefined>) => unknown] },
  out: Record<string, unknown>,
): string[] {
  const changed: string[] = [];
  for (const key of Object.keys(mapping) as (keyof P & string)[]) {
    const value = patch[key];
    if (value === undefined) continue;
    const target = mapping[key];
    if (!target) continue;
    if (typeof target === "string") out[target] = value;
    else out[target[0]] = target[1](value as Exclude<P[typeof key], undefined>);
    changed.push(key);
  }
  return changed;
}

export { RepoInputError, assertId, assertTenantId, nowIso };
export type { DbContext, RepoContext };

/** Runs a zod schema and turns its first problems into a RepoInputError. */
export function parseInput<T>(schema: { safeParse(input: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, input: unknown, what: string): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues.slice(0, 3).map((i) => (i.path.length ? `${i.path.map(String).join(".")}: ${i.message}` : i.message));
  throw new RepoInputError(`${what}: ${issues.join("; ")}`);
}
