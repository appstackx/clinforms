/**
 * A patient's history: the clinic's audit rows about this patient's record – the patient, their cases and
 * authorisations, clinical notes (including who opened them), outcome measures and files – newest first.
 *
 * The audit log is append-only and holds ids and counts only (no patient details). It has no patient column, so
 * the rows are found by the ids of the patient's records, in groups of 90 (D1's parameter limit). Other modules
 * can pass the ids of their own records about the patient (appointments, invoices…) in `extraTargetIds`.
 */
import type { AuditEntry } from "../../audit";
import { assertTenantId, type RepoContext } from "../context";

const GROUP = 90;

async function idsOf(ctx: RepoContext, tenantId: string, patientId: string): Promise<string[]> {
  const db = ctx.db;
  const [cases, auths, notes, outcomes, files] = await Promise.all([
    db.selectFrom("pms_cases").select("id").where("tenant_id", "=", tenantId).where("patient_id", "=", patientId).limit(500).execute(),
    db.selectFrom("pms_authorisations").select("id").where("tenant_id", "=", tenantId).where("patient_id", "=", patientId).limit(500).execute(),
    db.selectFrom("pms_clinical_notes").select("id").where("tenant_id", "=", tenantId).where("patient_id", "=", patientId).limit(500).execute(),
    db.selectFrom("pms_outcome_measures").select("id").where("tenant_id", "=", tenantId).where("patient_id", "=", patientId).limit(500).execute(),
    db.selectFrom("pms_attachments").select("id").where("tenant_id", "=", tenantId).where("patient_id", "=", patientId).limit(500).execute(),
  ]);
  return [patientId, ...[cases, auths, notes, outcomes, files].flatMap((rows) => rows.map((r) => r.id))];
}

export interface PatientHistoryOptions {
  /** Default 200, at most 500. */
  limit?: number;
  /** Ids of other modules' records about this patient. */
  extraTargetIds?: readonly string[];
}

export async function listPatientHistory(ctx: RepoContext, tenantId: string, patientId: string, options: PatientHistoryOptions = {}): Promise<AuditEntry[]> {
  assertTenantId(tenantId);
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 200)), 500);
  const ids = Array.from(new Set([...(await idsOf(ctx, tenantId, patientId)), ...(options.extraTargetIds ?? [])]));
  const found: AuditEntry[] = [];
  for (let i = 0; i < ids.length; i += GROUP) {
    const rows = await ctx.db
      .selectFrom("audit_log")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("target_id", "in", ids.slice(i, i + GROUP))
      .orderBy("id", "desc")
      .limit(limit)
      .execute();
    for (const row of rows) {
      let detail: Record<string, unknown> | null = null;
      try {
        detail = row.detail_json ? (JSON.parse(row.detail_json) as Record<string, unknown>) : null;
      } catch {
        detail = null;
      }
      found.push({
        id: row.id,
        tenantId: row.tenant_id,
        userId: row.user_id,
        sessionId: row.session_id,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        detail,
        at: row.at,
      });
    }
  }
  return found.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)).slice(0, limit);
}
