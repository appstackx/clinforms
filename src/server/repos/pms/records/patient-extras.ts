/**
 * `pms_patient_extras` (pronouns, one row per patient – id = the patient's id) and `pms_clinical_flags` (clinical
 * flags, K2-PAT-014) – the records module's additions to the shared patient record (migration 0125; rules:
 * src/modules/pms/records/flags.ts).
 *
 * - Every write names tenant_id, is revision-checked where two people may edit, and is audited in the same batch.
 *   Audit details hold ids and counts only – never the pronouns or a flag's words.
 * - A flag's words are encrypted (flag_enc, AAD "<tenant>:pms_clinical_flags.flag_enc:<id>"). The flags of ONE
 *   patient are decrypted when that record is opened (like the shared record's medical alerts) – never in a list of
 *   patients. Flags are ended, never deleted; anonymisation (./anonymise.ts) clears the words.
 * - Who may read or write which is decided by the records service (src/server/pms/records/flags-service.ts).
 */
import { RECORDS_ID_PREFIXES as P } from "../../../../modules/pms/records/ids";
import { ClinicalFlagInputSchema, EMPTY_PATIENT_EXTRAS, MAX_ACTIVE_FLAGS, PronounsSchema, type ClinicalFlag, type ClinicalFlagInput, type PatientExtras } from "../../../../modules/pms/records/flags";
import type { PmsActor, PmsSaveResult } from "../../../../modules/pms/core/types";
import { RepoInputError, assertActor, assertId, assertTenantId, decryptField, encryptField, nowIso, num, parseInput, pmsAuditQuery, pmsId, writeWithAudit, type RepoContext } from "../context";
import { updateWithAudit } from "./write";

const X = "pms_patient_extras";
const F = "pms_clinical_flags";
const MESSAGES = { foreignKey: "The patient does not exist in this clinic.", unique: "conflict" };

/* ------------------------------------------------------------------------------------------------
 * Pronouns
 * ----------------------------------------------------------------------------------------------*/

export async function getPatientExtras(ctx: RepoContext, tenantId: string, patientId: string): Promise<PatientExtras> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(X).select(["pronouns", "rev"]).where("tenant_id", "=", tenantId).where("id", "=", patientId).executeTakeFirst();
  return row ? { pronouns: row.pronouns, rev: num(row.rev) } : { ...EMPTY_PATIENT_EXTRAS };
}

/** Pronouns of several patients (lists: plain column, nothing decrypted). */
export async function getPronounsFor(ctx: RepoContext, tenantId: string, patientIds: readonly string[]): Promise<Map<string, string>> {
  assertTenantId(tenantId);
  const out = new Map<string, string>();
  const unique = Array.from(new Set(patientIds));
  for (let i = 0; i < unique.length; i += 90) {
    const rows = await ctx.db.selectFrom(X).select(["id", "pronouns"]).where("tenant_id", "=", tenantId).where("id", "in", unique.slice(i, i + 90)).execute();
    for (const r of rows) if (r.pronouns) out.set(r.id, r.pronouns);
  }
  return out;
}

/** Saves the patient's pronouns with the revision the form saw (0 = nothing recorded yet). */
export async function savePatientPronouns(ctx: RepoContext, tenantId: string, patientId: string, expectedRev: number, pronouns: string | null, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  assertId(patientId, "patient id");
  const who = assertActor(actor);
  if (!Number.isInteger(expectedRev) || expectedRev < 0) throw new RepoInputError("expectedRev must be a whole number.");
  const value = parseInput(PronounsSchema, pronouns, "Pronouns");
  const at = nowIso(ctx);
  const entry = { action: "pms.patient_extras.update", targetType: "pms_patient_extras", targetId: patientId, detail: { fields: ["pronouns"], rev: expectedRev + 1 } };
  if (expectedRev === 0) {
    try {
      await writeWithAudit(
        ctx,
        [
          ctx.db.insertInto(X).values({ tenant_id: tenantId, id: patientId, rev: 1, pronouns: value, updated_by: who.userId, created_at: at, updated_at: at }),
          pmsAuditQuery(ctx, tenantId, who, entry),
        ],
        MESSAGES,
      );
    } catch (err) {
      if (err instanceof RepoInputError && err.message === "conflict") return { ok: false, reason: "conflict", currentRev: (await getPatientExtras(ctx, tenantId, patientId)).rev };
      throw err;
    }
    return { ok: true, rev: 1, updatedAt: at };
  }
  const changed = await updateWithAudit(
    ctx,
    tenantId,
    who,
    ctx.db.updateTable(X).set({ pronouns: value, rev: expectedRev + 1, updated_by: who.userId, updated_at: at }).where("tenant_id", "=", tenantId).where("id", "=", patientId).where("rev", "=", expectedRev),
    entry,
    ctx.db.selectFrom(X).select("id").where("tenant_id", "=", tenantId).where("id", "=", patientId).where("rev", "=", expectedRev + 1).where("updated_at", "=", at),
  );
  if (changed) return { ok: true, rev: expectedRev + 1, updatedAt: at };
  const now = await getPatientExtras(ctx, tenantId, patientId);
  return now.rev === 0 ? { ok: false, reason: "not_found" } : { ok: false, reason: "conflict", currentRev: now.rev };
}

/* ------------------------------------------------------------------------------------------------
 * Clinical flags
 * ----------------------------------------------------------------------------------------------*/

type FlagRow = { tenant_id: string; id: string; rev: number; patient_id: string; flag_enc: string | null; status: string; created_by: string | null; created_at: string; ended_at: string | null };

function toFlag(ctx: RepoContext, r: FlagRow): ClinicalFlag {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    rev: num(r.rev),
    patientId: r.patient_id,
    text: decryptField(ctx, r.tenant_id, F, "flag_enc", r.id, r.flag_enc),
    status: r.status === "ended" ? "ended" : "active",
    createdBy: r.created_by,
    createdAt: r.created_at,
    endedAt: r.ended_at,
  };
}

const FLAG_COLUMNS = ["tenant_id", "id", "rev", "patient_id", "flag_enc", "status", "created_by", "created_at", "ended_at"] as const;

/** One patient's clinical flags, decrypted (the record's header) – active first, then ended, oldest first. */
export async function listClinicalFlags(ctx: RepoContext, tenantId: string, patientId: string, options: { includeEnded?: boolean } = {}): Promise<ClinicalFlag[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom(F).select(FLAG_COLUMNS).where("tenant_id", "=", tenantId).where("patient_id", "=", patientId);
  if (!options.includeEnded) q = q.where("status", "=", "active");
  const rows = await q.orderBy("status").orderBy("id").limit(100).execute();
  return rows.map((r) => toFlag(ctx, r as FlagRow));
}

export async function getClinicalFlag(ctx: RepoContext, tenantId: string, id: string): Promise<ClinicalFlag | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(F).select(FLAG_COLUMNS).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return row ? toFlag(ctx, row as FlagRow) : null;
}

/** Adds a clinical flag to the patient (encrypted; at most MAX_ACTIVE_FLAGS active at once). */
export async function addClinicalFlag(ctx: RepoContext, tenantId: string, patientId: string, input: ClinicalFlagInput, actor: PmsActor): Promise<ClinicalFlag> {
  assertTenantId(tenantId);
  assertId(patientId, "patient id");
  const who = assertActor(actor);
  const d = parseInput(ClinicalFlagInputSchema, input, "Clinical flag");
  const active = await ctx.db
    .selectFrom(F)
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("tenant_id", "=", tenantId)
    .where("patient_id", "=", patientId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (num(active?.n ?? 0) >= MAX_ACTIVE_FLAGS) throw new RepoInputError(`At most ${MAX_ACTIVE_FLAGS} clinical flags at once: end one that no longer applies first.`);
  const anonymised = await ctx.db.selectFrom("pms_patient_anonymisations").select("status").where("tenant_id", "=", tenantId).where("patient_id", "=", patientId).executeTakeFirst();
  if (anonymised) throw new RepoInputError("This record has been anonymised. Nothing can be added.");
  const id = pmsId(P.clinicalFlag, ctx);
  const at = nowIso(ctx);
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto(F).values({
        tenant_id: tenantId,
        id,
        rev: 1,
        patient_id: patientId,
        flag_enc: encryptField(ctx, tenantId, F, "flag_enc", id, d.text),
        status: "active",
        created_by: who.userId,
        ended_at: null,
        ended_by: null,
        anonymised_at: null,
        created_at: at,
        updated_at: at,
      }),
      pmsAuditQuery(ctx, tenantId, who, { action: "pms.clinical_flag.add", targetType: "pms_clinical_flag", targetId: id, detail: { patientId } }),
    ],
    MESSAGES,
  );
  return (await getClinicalFlag(ctx, tenantId, id)) as ClinicalFlag;
}

/** Ends a flag that no longer applies (kept, with when and by whom). */
export async function endClinicalFlag(ctx: RepoContext, tenantId: string, id: string, expectedRev: number, actor: PmsActor): Promise<PmsSaveResult> {
  assertTenantId(tenantId);
  assertId(id, "flag id");
  const who = assertActor(actor);
  if (!Number.isInteger(expectedRev) || expectedRev < 1) throw new RepoInputError("expectedRev must be a positive whole number.");
  const at = nowIso(ctx);
  const changed = await updateWithAudit(
    ctx,
    tenantId,
    who,
    ctx.db
      .updateTable(F)
      .set({ status: "ended", ended_at: at, ended_by: who.userId, rev: expectedRev + 1, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("rev", "=", expectedRev)
      .where("status", "=", "active"),
    { action: "pms.clinical_flag.end", targetType: "pms_clinical_flag", targetId: id, detail: { rev: expectedRev + 1 } },
    ctx.db.selectFrom(F).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("rev", "=", expectedRev + 1).where("updated_at", "=", at),
  );
  if (changed) return { ok: true, rev: expectedRev + 1, updatedAt: at };
  const now = await ctx.db.selectFrom(F).select(["rev", "status"]).where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  if (!now) return { ok: false, reason: "not_found" };
  if (now.status === "ended") throw new RepoInputError("This flag has already ended.");
  return { ok: false, reason: "conflict", currentRev: num(now.rev) };
}

/** Number of active clinical flags per patient (no words – for counts only). */
export async function countActiveFlags(ctx: RepoContext, tenantId: string, patientId: string): Promise<number> {
  assertTenantId(tenantId);
  const row = await ctx.db
    .selectFrom(F)
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("tenant_id", "=", tenantId)
    .where("patient_id", "=", patientId)
    .where("status", "=", "active")
    .executeTakeFirst();
  return num(row?.n ?? 0);
}
