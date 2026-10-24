/**
 * `pms_referrers` – the clinic's directory of referrers and payer accounts (GPs, consultants, insurers, medico-legal
 * companies, solicitors, employers, case managers). Notes are encrypted. Updates use the row revision (two
 * receptionists editing the same account cannot overwrite each other silently).
 */
import type { Selectable } from "kysely";
import { FOUNDATION_ID_PREFIXES as P } from "../../../modules/pms/core/ids";
import { ReferrerInputSchema, ReferrerPatchSchema, type ReferrerInput, type ReferrerPatch } from "../../../modules/pms/core/schemas";
import { searchKey } from "../../../modules/pms/core/text";
import type { PmsActor, PmsSaveResult, Referrer, ReferrerKind } from "../../../modules/pms/core/types";
import type { PmsReferrersTable } from "../../db/pms-schema/foundation";
import {
  RepoInputError,
  assertId,
  assertTenantId,
  b01,
  decryptField,
  encryptField,
  guarded,
  isOn,
  jsonLines,
  nowIso,
  num,
  parseInput,
  parseLines,
  patchColumns,
  pmsAudit,
  pmsAuditQuery,
  pmsId,
  writeWithAudit,
  type RepoContext,
} from "./context";

const T = "pms_referrers";
const MESSAGES = { unique: "A referrer with this import reference already exists." };

function toReferrer(ctx: RepoContext, r: Selectable<PmsReferrersTable>, withNotes: boolean): Referrer {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    rev: num(r.rev),
    kind: r.kind as ReferrerKind,
    name: r.name,
    contactName: r.contact_name,
    email: r.email,
    phone: r.phone,
    address: parseLines(r.address_json),
    postcode: r.postcode,
    notes: withNotes ? decryptField(ctx, r.tenant_id, T, "notes_enc", r.id, r.notes_enc) : null,
    active: isOn(r.active),
    importRef: r.import_ref,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function createReferrer(ctx: RepoContext, tenantId: string, input: ReferrerInput, actor: PmsActor): Promise<Referrer> {
  assertTenantId(tenantId);
  const d = parseInput(ReferrerInputSchema, input, "Referrer");
  const id = pmsId(P.referrer, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto(T).values({
        tenant_id: tenantId,
        id,
        rev: 1,
        kind: d.kind,
        name: d.name,
        search_name: searchKey(d.name, d.contactName),
        contact_name: d.contactName ?? null,
        email: d.email ?? null,
        phone: d.phone ?? null,
        address_json: jsonLines(d.address),
        postcode: d.postcode ?? null,
        notes_enc: encryptField(ctx, tenantId, T, "notes_enc", id, d.notes),
        active: b01(d.active ?? true),
        import_ref: d.importRef ?? null,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.referrer.create", targetType: "pms_referrer", targetId: id, detail: { kind: d.kind } }),
    ],
    MESSAGES,
  );
  return (await getReferrer(ctx, tenantId, id)) as Referrer;
}

/** Update with the revision the editor saw (expectedRev). */
export async function updateReferrer(ctx: RepoContext, tenantId: string, id: string, expectedRev: number, patch: ReferrerPatch, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  assertId(id, "referrer id");
  if (!Number.isInteger(expectedRev) || expectedRev < 1) throw new RepoInputError("expectedRev must be a positive whole number.");
  const d = parseInput(ReferrerPatchSchema, patch, "Referrer");
  const current = await ctx.db.selectFrom(T).select(["rev", "name", "contact_name"]).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!current) return { ok: false, reason: "not_found" };
  if (num(current.rev) !== expectedRev) return { ok: false, reason: "conflict", currentRev: num(current.rev) };
  const set: Record<string, unknown> = {};
  const fields = patchColumns(
    d,
    {
      kind: "kind",
      name: "name",
      contactName: "contact_name",
      email: "email",
      phone: "phone",
      address: ["address_json", (v: string[] | null) => jsonLines(v)],
      postcode: "postcode",
      notes: ["notes_enc", (v: string | null) => encryptField(ctx, tenantId, T, "notes_enc", id, v)],
      active: ["active", (v: boolean) => b01(v)],
      importRef: "import_ref",
    },
    set,
  );
  if (d.name !== undefined || d.contactName !== undefined) {
    set.search_name = searchKey(d.name ?? current.name, d.contactName === undefined ? current.contact_name : d.contactName);
  }
  const at = nowIso(ctx);
  const result = await guarded(
    () =>
      ctx.db
        .updateTable(T)
        .set({ ...set, rev: expectedRev + 1, updated_at: at })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id)
        .where("rev", "=", expectedRev)
        .executeTakeFirst(),
    MESSAGES,
  );
  if (Number(result.numUpdatedRows) === 0) {
    const now = await ctx.db.selectFrom(T).select("rev").where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
    return now ? { ok: false, reason: "conflict", currentRev: num(now.rev) } : { ok: false, reason: "not_found" };
  }
  await pmsAudit(ctx, tenantId, actor, { action: "pms.referrer.update", targetType: "pms_referrer", targetId: id, detail: { fields, rev: expectedRev + 1 } });
  return { ok: true, rev: expectedRev + 1, updatedAt: at };
}

/** One referrer, notes decrypted. */
export async function getReferrer(ctx: RepoContext, tenantId: string, id: string): Promise<Referrer | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return row ? toReferrer(ctx, row, true) : null;
}

export interface ListReferrersOptions {
  kind?: ReferrerKind | ReferrerKind[];
  /** Words to find in the name or contact name. */
  q?: string;
  includeInactive?: boolean;
  /** Default 100, at most 500. */
  limit?: number;
}

/** Referrers without their notes (lists and pickers), by name. */
export async function listReferrers(ctx: RepoContext, tenantId: string, options: ListReferrersOptions = {}): Promise<Referrer[]> {
  assertTenantId(tenantId);
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 100)), 500);
  let q = ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId);
  if (!options.includeInactive) q = q.where("active", "=", 1);
  if (options.kind) q = q.where("kind", "in", Array.isArray(options.kind) ? options.kind : [options.kind]);
  for (const word of searchKey(options.q).split(" ").filter(Boolean).slice(0, 5)) {
    q = q.where("search_name", "like", `%${word}%`);
  }
  const rows = await q.orderBy("search_name").limit(limit).execute();
  return rows.map((r) => toReferrer(ctx, r, false));
}
