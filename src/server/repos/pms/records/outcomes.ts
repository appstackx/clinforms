/**
 * `pms_outcome_measures` – NDI, ODI, NPRS, PSFS and QuickDASH scores (rules: src/modules/pms/records/outcomes.ts).
 *
 * - The repository scores the answers itself (never trusts a score from a form). The score and its band are plain
 *   columns (charts and the clinic's figures read them without decrypting); the answers – including the PSFS
 *   activities in the patient's words – are encrypted.
 * - Never deleted: a wrong entry is marked "entered in error" with a reason and left out of the charts.
 */
import type { Selectable } from "kysely";
import { RECORDS_ID_PREFIXES as P } from "../../../../modules/pms/records/ids";
import { OutcomeInputSchema, scoreOutcome, type OutcomeAnswers, type OutcomeInput, type OutcomeMeasureId } from "../../../../modules/pms/records/outcomes";
import type { OutcomeRecord, OutcomeSummary } from "../../../../modules/pms/records/types";
import { isIsoDate, ukToday } from "../../../../modules/pms/core/text";
import type { PmsActor } from "../../../../modules/pms/core/types";
import type { PmsOutcomeMeasuresTable } from "../../../db/pms-schema/records";
import { RepoInputError, assertId, assertTenantId, decryptField, encryptField, nowIso, num, parseInput, pmsAuditQuery, pmsId, writeWithAudit, type RepoContext } from "../context";
import { updateWithAudit } from "./write";

const T = "pms_outcome_measures";
const MESSAGES = {
  unique: "An outcome measure with this import reference already exists.",
  foreignKey: "The patient, case or note does not exist in this clinic (they must all be the same patient's).",
};

type Row = Selectable<PmsOutcomeMeasuresTable>;

const SUMMARY_COLUMNS = ["tenant_id", "id", "patient_id", "case_id", "note_id", "measure", "taken_on", "score_tenths", "band", "answered", "status", "recorded_by", "created_at"] as const;

function toSummary(r: Pick<Row, (typeof SUMMARY_COLUMNS)[number]>): OutcomeSummary {
  return {
    tenantId: r.tenant_id,
    id: r.id,
    patientId: r.patient_id,
    caseId: r.case_id,
    noteId: r.note_id,
    measure: r.measure as OutcomeMeasureId,
    takenOn: r.taken_on,
    scoreTenths: num(r.score_tenths),
    band: r.band,
    answered: num(r.answered),
    status: r.status as OutcomeSummary["status"],
    recordedBy: r.recorded_by,
    createdAt: r.created_at,
  };
}

function toRecord(ctx: RepoContext, r: Row): OutcomeRecord {
  const json = decryptField(ctx, r.tenant_id, T, "answers_enc", r.id, r.answers_enc);
  let answers: OutcomeAnswers | null = null;
  if (json) {
    try {
      answers = JSON.parse(json) as OutcomeAnswers;
    } catch {
      answers = null;
    }
  }
  return {
    ...toSummary(r),
    rev: num(r.rev),
    answers,
    errorReason: decryptField(ctx, r.tenant_id, T, "error_reason_enc", r.id, r.error_reason_enc),
  };
}

function scored(input: OutcomeInput, today: string) {
  const d = parseInput(OutcomeInputSchema, input, "Outcome measure");
  if (!isIsoDate(d.takenOn) || d.takenOn > today) throw new RepoInputError("Outcome measure: the date must be a real date, not in the future.");
  const result = scoreOutcome(d.measure, d.answers);
  if (!result.ok) throw new RepoInputError(`Outcome measure: ${result.error}`);
  return { d, result };
}

function rowValues(ctx: RepoContext, tenantId: string, id: string, input: OutcomeInput & { importRef?: string | null }, actor: PmsActor, today: string, at: string) {
  const { d, result } = scored(input, today);
  return {
    tenant_id: tenantId,
    id,
    rev: 1,
    patient_id: d.patientId,
    case_id: d.caseId ?? null,
    note_id: d.noteId ?? null,
    measure: d.measure,
    taken_on: d.takenOn,
    score_tenths: result.scoreTenths,
    band: result.band,
    answered: result.answered,
    answers_enc: encryptField(ctx, tenantId, T, "answers_enc", id, JSON.stringify(d.answers)),
    status: "recorded",
    error_reason_enc: null,
    error_at: null,
    recorded_by: actor.userId,
    anonymised_at: null,
    import_ref: typeof input.importRef === "string" && input.importRef.trim() ? input.importRef.trim().slice(0, 80) : null,
    created_at: at,
    updated_at: at,
  };
}

/** Records a measure (scored here). */
export async function recordOutcome(ctx: RepoContext, tenantId: string, input: OutcomeInput, actor: PmsActor): Promise<OutcomeRecord> {
  assertTenantId(tenantId);
  const id = pmsId(P.outcome, ctx);
  const at = nowIso(ctx);
  const values = rowValues(ctx, tenantId, id, input, actor, ukToday(ctx.now ? ctx.now() : new Date()), at);
  await writeWithAudit(
    ctx,
    [
      ctx.db.insertInto(T).values(values),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.outcome.record", targetType: "pms_outcome", targetId: id, detail: { patientId: values.patient_id, measure: values.measure } }),
    ],
    MESSAGES,
  );
  return (await getOutcome(ctx, tenantId, id)) as OutcomeRecord;
}

/** Many measures at once (demo seed, imports): batches of 40, one audit row per batch. */
export async function bulkRecordOutcomes(ctx: RepoContext, tenantId: string, inputs: (OutcomeInput & { importRef?: string | null })[], actor: PmsActor, detail: Record<string, unknown> = {}): Promise<string[]> {
  assertTenantId(tenantId);
  const today = ukToday(ctx.now ? ctx.now() : new Date());
  const at = nowIso(ctx);
  const ids: string[] = [];
  for (let i = 0; i < inputs.length; i += 40) {
    const rows = inputs.slice(i, i + 40).map((input) => {
      const id = pmsId(P.outcome, ctx);
      ids.push(id);
      return rowValues(ctx, tenantId, id, input, actor, today, at);
    });
    await writeWithAudit(
      ctx,
      [
        ...rows.map((r) => ctx.db.insertInto(T).values(r)),
        pmsAuditQuery(ctx, tenantId, actor, { action: "pms.outcome.bulk_create", targetType: "pms_outcome", targetId: rows[0].id, detail: { ...detail, count: rows.length } }),
      ],
      MESSAGES,
    );
  }
  return ids;
}

export async function getOutcome(ctx: RepoContext, tenantId: string, id: string): Promise<OutcomeRecord | null> {
  assertTenantId(tenantId);
  const row = await ctx.db.selectFrom(T).selectAll().where("tenant_id", "=", tenantId).where("id", "=", id).executeTakeFirst();
  return row ? toRecord(ctx, row) : null;
}

/** A patient's measures, oldest first per measure (scores only – nothing decrypted). */
export async function listOutcomesForPatient(ctx: RepoContext, tenantId: string, patientId: string, options: { includeErrors?: boolean } = {}): Promise<OutcomeSummary[]> {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom(T).select(SUMMARY_COLUMNS).where("tenant_id", "=", tenantId).where("patient_id", "=", patientId);
  if (!options.includeErrors) q = q.where("status", "=", "recorded");
  const rows = await q.orderBy("measure").orderBy("taken_on").orderBy("id").limit(500).execute();
  return rows.map(toSummary);
}

/** Marks a measure as entered in error (kept, left out of charts). */
export async function markOutcomeInError(ctx: RepoContext, tenantId: string, id: string, reason: string, actor: PmsActor): Promise<boolean> {
  assertTenantId(tenantId);
  assertId(id, "outcome id");
  const text = String(reason ?? "").trim();
  if (!text) throw new RepoInputError("Give the reason.");
  if (text.length > 500) throw new RepoInputError("The reason can be at most 500 characters.");
  const at = nowIso(ctx);
  const reasonEnc = encryptField(ctx, tenantId, T, "error_reason_enc", id, text) as string;
  return updateWithAudit(
    ctx,
    tenantId,
    actor,
    ctx.db
      .updateTable(T)
      .set((eb) => ({ status: "entered_in_error", error_at: at, error_reason_enc: reasonEnc, rev: eb("rev", "+", 1), updated_at: at }))
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .where("status", "=", "recorded"),
    { action: "pms.outcome.error", targetType: "pms_outcome", targetId: id },
    ctx.db.selectFrom(T).select("id").where("tenant_id", "=", tenantId).where("id", "=", id).where("status", "=", "entered_in_error").where("error_reason_enc", "=", reasonEnc),
  );
}
