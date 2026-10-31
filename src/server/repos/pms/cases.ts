/**
 * `pms_cases` (episodes of care, each with its payer) and `pms_authorisations` (insurer treatment
 * authorisations: code, sessions and/or value, expiry, what is used). Part of the shared patient record.
 *
 * - Referral reasons and notes are encrypted; lists return summaries.
 * - An authorisation always belongs to one case of one patient: the database checks the (patient, case) pair.
 * - Usage is one conditional UPDATE: it never goes over what was authorised, never below zero.
 * - Never deleted by the app (close a case; cancel an authorisation).
 */
import { sql, type Selectable } from "kysely";
import { FOUNDATION_ID_PREFIXES as P } from "../../../modules/pms/core/ids";
import {
  AuthorisationInputSchema,
  AuthorisationPatchSchema,
  AuthorisationUsageSchema,
  CaseInputSchema,
  CasePatchSchema,
  type AuthorisationInput,
  type AuthorisationPatch,
  type AuthorisationUsage,
  type CaseInput,
  type CasePatch,
} from "../../../modules/pms/core/schemas";
import { ukToday } from "../../../modules/pms/core/text";
import type { Authorisation, AuthorisationStatus, Case, CaseStatus, CaseSummary, PayerType, PmsActor, PmsSaveResult } from "../../../modules/pms/core/types";
import { runBatch } from "../../db/batch";
import type { PmsAuthorisationsTable, PmsCasesTable } from "../../db/pms-schema/foundation";
import {
  RepoInputError,
  assertId,
  assertTenantId,
  decryptField,
  encryptField,
  guarded,
  nowIso,
  num,
  numOrNull,
  parseInput,
  patchColumns,
  pmsAudit,
  pmsAuditQuery,
  pmsId,
  translateDbError,
  writeWithAudit,
  type RepoContext,
} from "./context";
import { pmsNow } from "../../../modules/pms/core/clock";

const C = "pms_cases";

/** Ids per statement of an import undo (D1: 100 bound parameters). */
const UNDO_GROUP = 90;

/** Items whose stored revision is still the one given, read 90 at a time; grouped by that revision. */
async function stillAtRevision(ctx: RepoContext, table: "pms_cases", tenantId: string, items: readonly { id: string; rev: number }[]): Promise<Map<number, string[]>> {
  const wanted = new Map(items.map((i) => [i.id, i.rev]));
  const ids = Array.from(wanted.keys());
  const byRev = new Map<number, string[]>();
  for (let i = 0; i < ids.length; i += UNDO_GROUP) {
    const rows = await ctx.db.selectFrom(table).select(["id", "rev"]).where("tenant_id", "=", tenantId).where("id", "in", ids.slice(i, i + UNDO_GROUP)).execute();
    for (const r of rows) {
      const rev = num(r.rev);
      if (wanted.get(r.id) !== rev) continue;
      const list = byRev.get(rev);
      if (list) list.push(r.id);
      else byRev.set(rev, [r.id]);
    }
  }
  return byRev;
}

const A = "pms_authorisations";
const CASE_MESSAGES = {
  unique: "A case with this import reference already exists.",
  foreignKey: "The patient, practitioner, site, payer, price list or referrer does not exist in this clinic.",
};
const AUTH_MESSAGES = {
  unique: "This case already has an authorisation with that code (or the import reference is taken).",
  foreignKey: "The case or the issuer does not exist in this clinic.",
};

type CaseRow = Selectable<PmsCasesTable>;
type AuthRow = Selectable<PmsAuthorisationsTable>;

const CASE_SUMMARY_COLUMNS = ["tenant_id", "id", "patient_id", "title", "status", "opened_on", "closed_on", "practitioner_id", "site_id", "payer_type", "payer_referrer_id", "updated_at"] as const;

function toCaseSummary(r: Pick<CaseRow, (typeof CASE_SUMMARY_COLUMNS)[number]>): CaseSummary {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    patientId: r.patient_id,
    title: r.title,
    status: r.status as CaseStatus,
    openedOn: r.opened_on,
    closedOn: r.closed_on,
    practitionerId: r.practitioner_id,
    siteId: r.site_id,
    payerType: r.payer_type as PayerType,
    payerReferrerId: r.payer_referrer_id,
    updatedAt: r.updated_at,
  };
}

function toCase(ctx: RepoContext, r: CaseRow): Case {
  return {
    ...toCaseSummary(r),
    rev: num(r.rev),
    membershipNumber: r.membership_number,
    claimReference: r.claim_reference,
    excessPence: numOrNull(r.excess_pence),
    priceListId: r.price_list_id,
    referrerId: r.referrer_id,
    referralReceivedOn: r.referral_received_on,
    injuryOn: r.injury_on,
    referralReason: decryptField(ctx, r.tenant_id, C, "referral_reason_enc", r.id, r.referral_reason_enc),
    notes: decryptField(ctx, r.tenant_id, C, "notes_enc", r.id, r.notes_enc),
    importRef: r.import_ref,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

function toAuthorisation(ctx: RepoContext, r: AuthRow, withNotes = true): Authorisation {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    rev: num(r.rev),
    caseId: r.case_id,
    patientId: r.patient_id,
    referrerId: r.referrer_id,
    code: r.code,
    sessionsAuthorised: numOrNull(r.sessions_authorised),
    valueAuthorisedPence: numOrNull(r.value_authorised_pence),
    sessionsUsed: num(r.sessions_used),
    valueUsedPence: num(r.value_used_pence),
    validFrom: r.valid_from,
    expiresOn: r.expires_on,
    status: r.status as AuthorisationStatus,
    notes: withNotes ? decryptField(ctx, r.tenant_id, A, "notes_enc", r.id, r.notes_enc) : null,
    importRef: r.import_ref,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

type ParsedCase = ReturnType<(typeof CaseInputSchema)["parse"]>;

function newCaseValues(ctx: RepoContext, tenantId: string, id: string, d: ParsedCase, actor: PmsActor, at: string) {
  const status = d.status ?? "open";
  return {
    tenant_id: tenantId,
    id,
    rev: 1,
    patient_id: d.patientId,
    title: d.title,
    status,
    opened_on: d.openedOn,
    closed_on: d.closedOn ?? (status === "open" ? null : ukToday(ctx.now ? ctx.now() : pmsNow())),
    practitioner_id: d.practitionerId ?? null,
    site_id: d.siteId ?? null,
    payer_type: d.payerType ?? "self_pay",
    payer_referrer_id: d.payerReferrerId ?? null,
    membership_number: d.membershipNumber ?? null,
    claim_reference: d.claimReference ?? null,
    excess_pence: d.excessPence ?? null,
    price_list_id: d.priceListId ?? null,
    referrer_id: d.referrerId ?? null,
    referral_received_on: d.referralReceivedOn ?? null,
    injury_on: d.injuryOn ?? null,
    referral_reason_enc: encryptField(ctx, tenantId, C, "referral_reason_enc", id, d.referralReason),
    notes_enc: encryptField(ctx, tenantId, C, "notes_enc", id, d.notes),
    import_ref: d.importRef ?? null,
    created_by: actor.userId,
    created_at: at,
    updated_at: at,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Cases
 * ----------------------------------------------------------------------------------------------*/

export async function createCase(ctx: RepoContext, tenantId: string, input: CaseInput, actor: PmsActor): Promise<Case> {
  assertTenantId(tenantId);
  const d = parseInput(CaseInputSchema, input, "Case");
  const id = pmsId(P.case, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto(C).values(newCaseValues(ctx, tenantId, id, d, actor, at)),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.case.create", targetType: "pms_case", targetId: id, detail: { patientId: d.patientId, payerType: d.payerType ?? "self_pay" } }),
    ],
    CASE_MESSAGES,
  );
  return (await getCase(ctx, tenantId, id)) as Case;
}

/** Many cases at once (seed, import): batches of 40, one audit row per batch. */
export async function bulkCreateCases(ctx: RepoContext, tenantId: string, inputs: CaseInput[], actor: PmsActor, detail: Record<string, unknown> = {}): Promise<string[]> {
  assertTenantId(tenantId);
  const parsed = inputs.map((input, i) => parseInput(CaseInputSchema, input, `Case ${i + 1}`));
  const at = nowIso(ctx);
  const ids: string[] = [];
  for (let i = 0; i < parsed.length; i += 40) {
    const rows = parsed.slice(i, i + 40).map((d) => {
      const id = pmsId(P.case, ctx);
      ids.push(id);
      return newCaseValues(ctx, tenantId, id, d, actor, at);
    });
    try {
      await runBatch(ctx.db, [
        ...rows.map((row) => ctx.db.insertInto(C).values(row)),
        pmsAuditQuery(ctx, tenantId, actor, { action: "pms.case.bulk_create", targetType: "pms_case", targetId: rows[0].id, detail: { ...detail, count: rows.length } }),
      ]);
    } catch (err) {
      throw translateDbError(err, CASE_MESSAGES);
    }
  }
  return ids;
}

export async function updateCase(ctx: RepoContext, tenantId: string, id: string, expectedRev: number, patch: CasePatch, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  assertId(id, "case id");
  if (!Number.isInteger(expectedRev) || expectedRev < 1) throw new RepoInputError("expectedRev must be a positive whole number.");
  const d = parseInput(CasePatchSchema, patch, "Case");
  const current = await ctx.db.selectFrom(C).select(["rev", "opened_on", "closed_on", "status"]).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!current) return { ok: false, reason: "not_found" };
  if (num(current.rev) !== expectedRev) return { ok: false, reason: "conflict", currentRev: num(current.rev) };
  const set: Record<string, unknown> = {};
  const fields = patchColumns(
    d,
    {
      title: "title",
      status: "status",
      openedOn: "opened_on",
      closedOn: "closed_on",
      practitionerId: "practitioner_id",
      siteId: "site_id",
      payerType: "payer_type",
      payerReferrerId: "payer_referrer_id",
      membershipNumber: "membership_number",
      claimReference: "claim_reference",
      excessPence: "excess_pence",
      priceListId: "price_list_id",
      referrerId: "referrer_id",
      referralReceivedOn: "referral_received_on",
      injuryOn: "injury_on",
      referralReason: ["referral_reason_enc", (v: string | null) => encryptField(ctx, tenantId, C, "referral_reason_enc", id, v)],
      notes: ["notes_enc", (v: string | null) => encryptField(ctx, tenantId, C, "notes_enc", id, v)],
      importRef: "import_ref",
    },
    set,
  );
  // Closing a case without a date closes it today; reopening clears the date.
  const status = (set.status as CaseStatus | undefined) ?? (current.status as CaseStatus);
  if (set.status !== undefined && status === "open" && d.closedOn === undefined) set.closed_on = null;
  if (status !== "open" && d.closedOn === undefined && !current.closed_on) set.closed_on = ukToday(ctx.now ? ctx.now() : pmsNow());
  const opened = (set.opened_on as string | undefined) ?? current.opened_on;
  const closed = set.closed_on === undefined ? current.closed_on : (set.closed_on as string | null);
  if (closed && closed < opened) throw new RepoInputError("Case: closedOn: The case cannot close before it opens");
  if (fields.length === 0) return { ok: true, rev: expectedRev, updatedAt: nowIso(ctx) };
  const at = nowIso(ctx);
  const result = await guarded(
    () =>
      ctx.db
        .updateTable(C)
        .set({ ...set, rev: expectedRev + 1, updated_at: at })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id)
        .where("rev", "=", expectedRev)
        .executeTakeFirst(),
    CASE_MESSAGES,
  );
  if (Number(result.numUpdatedRows) === 0) {
    const now = await ctx.db.selectFrom(C).select("rev").where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
    return now ? { ok: false, reason: "conflict", currentRev: num(now.rev) } : { ok: false, reason: "not_found" };
  }
  await pmsAudit(ctx, tenantId, actor, { action: "pms.case.update", targetType: "pms_case", targetId: id, detail: { fields, rev: expectedRev + 1 } });
  return { ok: true, rev: expectedRev + 1, updatedAt: at };
}

/** One case, referral reason and notes decrypted. */
export async function getCase(ctx: RepoContext, tenantId: string, id: string): Promise<Case | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(C).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return row ? toCase(ctx, row) : null;
}

/** A patient's cases (summaries), newest first. */
export async function listCasesForPatient(ctx: RepoContext, tenantId: string, patientId: string): Promise<CaseSummary[]> {
  assertTenantId(tenantId);
  const rows = await ctx.db
    .selectFrom(C)
    .select(CASE_SUMMARY_COLUMNS)
    .where("tenant_id", "=", tenantId)
    .where("patient_id", "=", patientId)
    .orderBy("opened_on", "desc")
    .orderBy("id", "desc")
    .limit(200)
    .execute();
  return rows.map(toCaseSummary);
}

export async function countCases(ctx: RepoContext, tenantId: string, status: CaseStatus | "any" = "open"): Promise<number> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom(C).select((eb) => eb.fn.countAll<number>().as("n")).where("tenant_id", "=", tenantId);
  if (status !== "any") q = q.where("status", "=", status);
  const row = await q.executeTakeFirst();
  return num(row?.n ?? 0);
}

/* ------------------------------------------------------------------------------------------------
 * Authorisations
 * ----------------------------------------------------------------------------------------------*/

type ParsedAuth = ReturnType<(typeof AuthorisationInputSchema)["parse"]>;

function newAuthValues(ctx: RepoContext, tenantId: string, id: string, patientId: string, d: ParsedAuth, at: string, used: { sessions: number; valuePence: number } = { sessions: 0, valuePence: 0 }) {
  return {
    tenant_id: tenantId,
    id,
    rev: 1,
    case_id: d.caseId,
    patient_id: patientId,
    referrer_id: d.referrerId ?? null,
    code: d.code,
    sessions_authorised: d.sessionsAuthorised ?? null,
    value_authorised_pence: d.valueAuthorisedPence ?? null,
    sessions_used: used.sessions,
    value_used_pence: used.valuePence,
    valid_from: d.validFrom ?? null,
    expires_on: d.expiresOn ?? null,
    status: d.status ?? "active",
    notes_enc: encryptField(ctx, tenantId, A, "notes_enc", id, d.notes),
    import_ref: d.importRef ?? null,
    created_at: at,
    updated_at: at,
  };
}

async function patientOfCase(ctx: RepoContext, tenantId: string, caseId: string): Promise<string> {
  const row = await ctx.db.selectFrom(C).select("patient_id").where("tenant_id", "=", tenantId).where("id", "=", caseId).executeTakeFirst();
  if (!row) throw new RepoInputError("That case does not exist in this clinic.");
  return row.patient_id;
}

export async function createAuthorisation(ctx: RepoContext, tenantId: string, input: AuthorisationInput, actor: PmsActor): Promise<Authorisation> {
  assertTenantId(tenantId);
  const d = parseInput(AuthorisationInputSchema, input, "Authorisation");
  const patientId = await patientOfCase(ctx, tenantId, d.caseId);
  const id = pmsId(P.authorisation, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto(A).values(newAuthValues(ctx, tenantId, id, patientId, d, at)),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.authorisation.create", targetType: "pms_authorisation", targetId: id, detail: { caseId: d.caseId } }),
    ],
    AUTH_MESSAGES,
  );
  return (await getAuthorisation(ctx, tenantId, id)) as Authorisation;
}

/** An authorisation brought over from an earlier system (or the demo seed), with what was already used. */
export type BulkAuthorisationInput = AuthorisationInput & { patientId: string; sessionsUsed?: number; valueUsedPence?: number };

/**
 * Many authorisations at once (seed, import): each input names its case and patient (the database checks the pair);
 * usage already recorded elsewhere may come along (never above what was authorised). Batches of 40, one audit row
 * each.
 */
export async function bulkCreateAuthorisations(ctx: RepoContext, tenantId: string, inputs: BulkAuthorisationInput[], actor: PmsActor, detail: Record<string, unknown> = {}): Promise<string[]> {
  assertTenantId(tenantId);
  const at = nowIso(ctx);
  const ids: string[] = [];
  const parsed = inputs.map((input, i) => {
    const d = parseInput(AuthorisationInputSchema, input, `Authorisation ${i + 1}`);
    const sessions = input.sessionsUsed ?? 0;
    const valuePence = input.valueUsedPence ?? 0;
    const over = (used: number, limit: number | null | undefined) => !Number.isInteger(used) || used < 0 || (limit !== null && limit !== undefined && used > limit);
    if (over(sessions, d.sessionsAuthorised) || over(valuePence, d.valueAuthorisedPence)) throw new RepoInputError(`Authorisation ${i + 1}: usage is outside what was authorised.`);
    return { patientId: assertId(input.patientId, "patientId"), d, used: { sessions, valuePence } };
  });
  for (let i = 0; i < parsed.length; i += 40) {
    const rows = parsed.slice(i, i + 40).map(({ patientId, d, used }) => {
      const id = pmsId(P.authorisation, ctx);
      ids.push(id);
      return newAuthValues(ctx, tenantId, id, patientId, d, at, used);
    });
    try {
      await runBatch(ctx.db, [
        ...rows.map((row) => ctx.db.insertInto(A).values(row)),
        pmsAuditQuery(ctx, tenantId, actor, { action: "pms.authorisation.bulk_create", targetType: "pms_authorisation", targetId: rows[0].id, detail: { ...detail, count: rows.length } }),
      ]);
    } catch (err) {
      throw translateDbError(err, AUTH_MESSAGES);
    }
  }
  return ids;
}

export async function updateAuthorisation(ctx: RepoContext, tenantId: string, id: string, expectedRev: number, patch: AuthorisationPatch, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  assertId(id, "authorisation id");
  if (!Number.isInteger(expectedRev) || expectedRev < 1) throw new RepoInputError("expectedRev must be a positive whole number.");
  const d = parseInput(AuthorisationPatchSchema, patch, "Authorisation");
  const set: Record<string, unknown> = {};
  const fields = patchColumns(
    d,
    {
      referrerId: "referrer_id",
      code: "code",
      sessionsAuthorised: "sessions_authorised",
      valueAuthorisedPence: "value_authorised_pence",
      validFrom: "valid_from",
      expiresOn: "expires_on",
      status: "status",
      notes: ["notes_enc", (v: string | null) => encryptField(ctx, tenantId, A, "notes_enc", id, v)],
      importRef: "import_ref",
    },
    set,
  );
  const at = nowIso(ctx);
  if (fields.length === 0) return { ok: true, rev: expectedRev, updatedAt: at };
  const result = await guarded(
    () =>
      ctx.db
        .updateTable(A)
        .set({ ...set, rev: expectedRev + 1, updated_at: at })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id)
        .where("rev", "=", expectedRev)
        .executeTakeFirst(),
    AUTH_MESSAGES,
  );
  if (Number(result.numUpdatedRows) === 0) {
    const now = await ctx.db.selectFrom(A).select("rev").where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
    return now ? { ok: false, reason: "conflict", currentRev: num(now.rev) } : { ok: false, reason: "not_found" };
  }
  await pmsAudit(ctx, tenantId, actor, { action: "pms.authorisation.update", targetType: "pms_authorisation", targetId: id, detail: { fields, rev: expectedRev + 1 } });
  return { ok: true, rev: expectedRev + 1, updatedAt: at };
}

export type UsageResult = { ok: true; sessionsUsed: number; valueUsedPence: number } | { ok: false; reason: "not_found" | "over_limit" | "not_active" };

/**
 * Records sessions / value used (positive) or given back (negative) – one conditional UPDATE, so two receptionists
 * at once can never take it over the limit or below zero. `reference` (e.g. the invoice or appointment id) goes
 * into the audit row.
 */
export async function recordAuthorisationUsage(ctx: RepoContext, tenantId: string, id: string, usage: AuthorisationUsage, actor: PmsActor, reference?: string): Promise<UsageResult> {
  assertTenantId(tenantId);
  assertId(id, "authorisation id");
  if (reference !== undefined) assertId(reference, "reference");
  const u = parseInput(AuthorisationUsageSchema, usage, "Usage");
  const sessions = u.sessions ?? 0;
  const value = u.valuePence ?? 0;
  const at = nowIso(ctx);
  const result = await ctx.db
    .updateTable(A)
    .set((eb) => ({
      sessions_used: eb("sessions_used", "+", sessions),
      value_used_pence: eb("value_used_pence", "+", value),
      rev: eb("rev", "+", 1),
      updated_at: at,
    }))
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .where("status", "=", "active")
    .where((eb) =>
      eb.and([
        eb(eb("sessions_used", "+", sessions), ">=", 0),
        eb(eb("value_used_pence", "+", value), ">=", 0),
        eb.or([eb("sessions_authorised", "is", null), eb(eb("sessions_used", "+", sessions), "<=", eb.ref("sessions_authorised"))]),
        eb.or([eb("value_authorised_pence", "is", null), eb(eb("value_used_pence", "+", value), "<=", eb.ref("value_authorised_pence"))]),
      ]),
    )
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) {
    const row = await ctx.db.selectFrom(A).select(["status"]).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
    if (!row) return { ok: false, reason: "not_found" };
    return { ok: false, reason: row.status === "active" ? "over_limit" : "not_active" };
  }
  await pmsAudit(ctx, tenantId, actor, {
    action: "pms.authorisation.usage",
    targetType: "pms_authorisation",
    targetId: id,
    detail: { sessions, valuePence: value, ...(reference ? { reference } : {}) },
  });
  const row = await ctx.db.selectFrom(A).select(["sessions_used", "value_used_pence"]).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirstOrThrow();
  return { ok: true, sessionsUsed: num(row.sessions_used), valueUsedPence: num(row.value_used_pence) };
}

/** One authorisation, notes decrypted. */
export async function getAuthorisation(ctx: RepoContext, tenantId: string, id: string): Promise<Authorisation | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(A).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return row ? toAuthorisation(ctx, row) : null;
}

/** A case's (or a patient's) authorisations without notes, by expiry. */
export async function listAuthorisations(ctx: RepoContext, tenantId: string, by: { caseId: string } | { patientId: string }): Promise<Authorisation[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom(A).selectAll().where("tenant_id", "=", tenantId);
  q = "caseId" in by ? q.where("case_id", "=", by.caseId) : q.where("patient_id", "=", by.patientId);
  const rows = await q.orderBy("expires_on").orderBy("id").limit(200).execute();
  return rows.map((r) => toAuthorisation(ctx, r, false));
}

/**
 * Active authorisations whose expiry date falls between `from` and `until` ("YYYY-MM-DD", both included), soonest
 * first (dashboards, reminders). Without `from`, ones that have already expired are included.
 */
export async function listExpiringAuthorisations(ctx: RepoContext, tenantId: string, range: { from?: string; until: string; limit?: number }): Promise<Authorisation[]> {
  assertTenantId(tenantId);
  let q = ctx.db
    .selectFrom(A)
    .selectAll()
    .where("tenant_id", "=", tenantId)
    .where("status", "=", "active")
    .where("expires_on", "is not", null)
    .where("expires_on", "<=", range.until);
  if (range.from) q = q.where("expires_on", ">=", range.from);
  const rows = await q
    .orderBy("expires_on")
    .limit(Math.min(Math.max(1, range.limit ?? 50), 500))
    .execute();
  return rows.map((r) => toAuthorisation(ctx, r, false));
}

/**
 * Undo of an import (integration): each case still exactly as imported is closed (closed today unless it already
 * had a date, never before it opened) and its import reference released; then the authorisations the import added
 * to those cases are cancelled when nobody changed them (revision 1). One UPDATE per group of up to 90 with the same
 * revision and one audit row per group, in batches. Returns the case ids changed.
 */
export async function closeImportedCases(
  ctx: RepoContext,
  tenantId: string,
  items: readonly { id: string; rev: number; authorisationId?: string | null }[],
  actor: PmsActor,
): Promise<Set<string>> {
  assertTenantId(tenantId);
  for (const i of items) assertId(i.id, "case id");
  const at = nowIso(ctx);
  const today = ukToday(ctx.now ? ctx.now() : pmsNow());
  const done = new Set<string>();
  const queries = [];
  for (const [rev, ids] of Array.from((await stillAtRevision(ctx, C, tenantId, items)).entries())) {
    for (let i = 0; i < ids.length; i += UNDO_GROUP) {
      const group = ids.slice(i, i + UNDO_GROUP);
      queries.push(
        ctx.db
          .updateTable(C)
          .set((eb) => ({
            status: "closed",
            import_ref: null,
            closed_on: eb.fn.coalesce("closed_on", sql<string>`case when opened_on > ${today} then opened_on else ${today} end`),
            rev: eb("rev", "+", 1),
            updated_at: at,
          }))
          .where("tenant_id", "=", tenantId)
          .where("id", "in", group)
          .where("rev", "=", rev)
          .returning("id"),
        pmsAuditQuery(ctx, tenantId, actor, { action: "pms.case.import_undo", targetType: "pms_case", targetId: group[0], detail: { count: group.length } }),
      );
    }
  }
  for (let i = 0; i < queries.length; i += 90) {
    for (const r of await runBatch(ctx.db, queries.slice(i, i + 90))) for (const row of r.rows) if (typeof row.id === "string") done.add(row.id);
  }
  const auths = items.filter((i) => done.has(i.id) && i.authorisationId).map((i) => i.authorisationId as string);
  const authQueries = [];
  for (let i = 0; i < auths.length; i += UNDO_GROUP) {
    const group = auths.slice(i, i + UNDO_GROUP);
    authQueries.push(
      ctx.db
        .updateTable(A)
        .set((eb) => ({ status: "cancelled", import_ref: null, rev: eb("rev", "+", 1), updated_at: at }))
        .where("tenant_id", "=", tenantId)
        .where("id", "in", group)
        .where("rev", "=", 1),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.authorisation.import_undo", targetType: "pms_authorisation", targetId: group[0], detail: { count: group.length } }),
    );
  }
  for (let i = 0; i < authQueries.length; i += 90) await runBatch(ctx.db, authQueries.slice(i, i + 90));
  return done;
}
